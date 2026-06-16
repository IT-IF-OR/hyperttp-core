import type { HttpClientOptions, HyperTransport } from "@hyperttp/types";

/**
 * @ru Поддерживаемые среды выполнения для автоматического выбора транспорта.
 * @en Supported runtime environments for automatic transport selection.
 */
export type Runtime = "bun" | "node" | "deno" | "browser";

/**
 * @ru Конструктор транспорта, принимающий конфигурацию клиента.
 * @en Transport constructor accepting client configuration.
 */
type TransportCtor = new (config: HttpClientOptions) => HyperTransport;

/**
 * @ru Описание транспорта: имя, поддерживаемые среды, пакет, экспорт и приоритет.
 * @en Transport descriptor: name, supported runtimes, package, export, and priority.
 */
type TransportDef = {
  /** @ru Имя транспорта для логирования. @en Transport name for logging. */
  readonly name: string;
  /** @ru Список сред, в которых транспорт может работать. @en List of runtimes where the transport can operate. */
  readonly runtime: readonly Runtime[];
  /** @ru Имя пакета npm или относительный путь для встроенных транспортов. @en npm package name or relative path for built-in transports. */
  readonly pkg: string;
  /** @ru Имя экспортируемого класса транспорта. @en Exported transport class name. */
  readonly export: string;
  /** @ru Приоритет выбора (выше значение = раньше попытка загрузки). @en Selection priority (higher value = earlier load attempt). */
  readonly priority: number;
};

/**
 * @ru Определяет текущую среду выполнения при загрузке модуля.
 * Порядок проверки: Bun → Deno → Node.js → Browser.
 * @en Detects the current runtime at module load time.
 * Detection order: Bun → Deno → Node.js → Browser.
 */
export const CURRENT_RUNTIME: Runtime = (() => {
  if (typeof Bun !== "undefined") return "bun";
  if (typeof Deno !== "undefined") return "deno";
  if (typeof process !== "undefined" && process.versions?.node) return "node";
  return "browser";
})();

/**
 * @ru Внутренний реестр всех доступных транспортов с приоритетами.
 * Заморожен для предотвращения модификаций в runtime.
 * @en Internal registry of all available transports with priorities.
 * Frozen to prevent runtime modifications.
 */
const INTERNAL_TRANSPORTS: readonly TransportDef[] = [
  {
    name: "Bun",
    runtime: ["bun"],
    pkg: "@hyperttp/transport-bun",
    export: "BunTransport",
    priority: 100,
  },
  {
    name: "Deno",
    runtime: ["deno"],
    pkg: "@hyperttp/transport-deno",
    export: "DenoTransport",
    priority: 95,
  },
  {
    name: "Undici",
    runtime: ["node"],
    pkg: "@hyperttp/transport-undici",
    export: "UndiciTransport",
    priority: 90,
  },
  {
    name: "Browser",
    runtime: ["browser"],
    pkg: "./browser.js",
    export: "BrowserTransport",
    priority: 80,
  },
  {
    name: "Node",
    runtime: ["node", "bun", "deno"],
    pkg: "./node.js",
    export: "NodeTransport",
    priority: 10,
  },
];

INTERNAL_TRANSPORTS.forEach(Object.freeze);
Object.freeze(INTERNAL_TRANSPORTS);

/**
 * @ru Белый список разрешённых пакетов для защиты от несанкционированного импорта.
 * @en Whitelist of allowed packages to protect against unauthorized imports.
 */
const ALLOWED_PACKAGES = new Set<string>(INTERNAL_TRANSPORTS.map((t) => t.pkg));

/**
 * @ru Отфильтрованный и отсортированный список транспортов для текущей среды.
 * Вычисляется один раз при загрузке модуля.
 * @en Filtered and sorted list of transports for the current runtime.
 * Computed once at module load time.
 */
const CANDIDATES = INTERNAL_TRANSPORTS.filter((t) => t.runtime.includes(CURRENT_RUNTIME)).sort(
  (a, b) => b.priority - a.priority,
);

/**
 * @ru Кэш разрешённого конструктора транспорта для избежания повторного разрешения.
 * @en Cached resolved transport constructor to avoid repeated resolution.
 */
let RESOLVED_RUNTIME_CTOR: TransportCtor | null = null;

/**
 * @ru Проверяет, является ли ошибкой отсутствия модуля.
 * Поддерживает коды ERR_MODULE_NOT_FOUND и MODULE_NOT_FOUND,
 * а также сообщения об ошибках (для совместимости с Bun и Deno).
 * @en Checks if the error is a module-not-found error.
 * Supports ERR_MODULE_NOT_FOUND and MODULE_NOT_FOUND codes,
 * as well as error messages (for Bun and Deno compatibility).
 * @param err - The error to check.
 * @returns True if the error indicates a missing module.
 */
function isModuleNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  const e = err as Record<string, unknown>;
  const code = e.code as string | undefined;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") return true;

  const msg = err instanceof Error ? err.message : String(e.message ?? "");
  return (
    msg.includes("Cannot find module") ||
    msg.includes("Failed to resolve") ||
    msg.includes("Failed to load")
  );
}

/**
 * @ru Логирует информацию о неудачной попытке загрузки транспорта.
 * Активируется в режиме DEBUG=1 или при ошибке нативного транспорта в dev-окружении.
 * @en Logs information about failed transport load attempts.
 * Activated in DEBUG=1 mode or when native transport fails in dev environment.
 * @param pkg - Package name that failed to load.
 * @param err - The error that occurred.
 * @param config - Optional client configuration for custom logger.
 */
function logDebugFallback(pkg: string, err: unknown, config?: HttpClientOptions): void {
  const isDev = typeof process !== "undefined" && process.env?.NODE_ENV === "development";
  const isDebug = typeof process !== "undefined" && process.env?.DEBUG === "1";
  const isNativeTransport = pkg.includes(CURRENT_RUNTIME);

  if (isDebug || (isDev && isNativeTransport)) {
    const primaryMessage = `Failed to load preferred transport "${pkg}"`;
    const fallbackMessage = `Falling back to alternative transport...`;

    if (config?.logger) {
      config.logger("warn", `[Hyperttp Debug] ${primaryMessage}`, err);
      config.logger("warn", `[Hyperttp Debug] ${fallbackMessage}`);
    } else {
      console.warn(`\n⚠️ [Hyperttp Debug] ${primaryMessage}:`);
      console.error(err);
      console.warn(`${fallbackMessage}\n`);
    }
  }
}

/**
 * @ru Загружает конструктор транспорта из пакета или относительного пути.
 * Для браузерной среды использует статический импорт для совместимости с бандлерами.
 * @en Loads a transport constructor from a package or relative path.
 * For browser runtime, uses static import for bundler compatibility.
 * @param pkg - Package name or relative path.
 * @param exportName - Name of the exported transport class.
 * @param config - Optional client configuration for debug logging.
 * @returns Transport constructor or null if not found.
 * @throws Error if the package is not in the whitelist.
 */
async function loadCtor(
  pkg: string,
  exportName: string,
  config?: HttpClientOptions,
): Promise<TransportCtor | null> {
  if (!ALLOWED_PACKAGES.has(pkg)) {
    throw new Error(`[Hyperttp Security] Blocked untrusted transport import attempt: ${pkg}`);
  }

  if (CURRENT_RUNTIME === "browser") {
    if (pkg !== "./browser.js") return null;
    const mod = (await import("./browser.js")) as Record<string, unknown>;
    const candidate = mod[exportName] ?? mod.default;
    return typeof candidate === "function" ? (candidate as TransportCtor) : null;
  }

  let specifier = pkg;
  try {
    if (typeof import.meta.resolve === "function") {
      specifier = import.meta.resolve(pkg, import.meta.url);
    }
  } catch (err) {
    if (isModuleNotFoundError(err)) {
      logDebugFallback(pkg, err, config);
      return null;
    }
  }

  try {
    const mod = (await import(specifier)) as Record<string, unknown>;
    const candidate = mod[exportName] ?? mod.default;
    return typeof candidate === "function" ? (candidate as TransportCtor) : null;
  } catch (err) {
    if (isModuleNotFoundError(err)) {
      logDebugFallback(pkg, err, config);
      return null;
    }
    throw err;
  }
}

/**
 * @ru Разрешает и создаёт оптимальный транспорт для текущей среды.
 * Перебирает кандидатов по приоритету, кэширует первый успешный результат.
 * @en Resolves and creates the optimal transport for the current runtime.
 * Iterates candidates by priority, caches the first successful result.
 * @param config - Client configuration options.
 * @returns Promise resolving to the instantiated transport.
 * @throws Error if no compatible transport is found.
 */
export async function resolveTransport(config: HttpClientOptions): Promise<HyperTransport> {
  if (config.customTransport) return config.customTransport;
  if (RESOLVED_RUNTIME_CTOR) return new RESOLVED_RUNTIME_CTOR(config);

  const failures: string[] = [];

  for (let i = 0; i < CANDIDATES.length; i++) {
    const t = CANDIDATES[i]!;
    try {
      const ctor = await loadCtor(t.pkg, t.export, config);
      if (!ctor) {
        failures.push(`${t.pkg} (missing export or not installed)`);
        continue;
      }

      RESOLVED_RUNTIME_CTOR = ctor;
      return new ctor(config);
    } catch (err) {
      if (isModuleNotFoundError(err)) {
        failures.push(`${t.pkg} (not installed)`);
        continue;
      }
      throw new Error(`[Hyperttp] transport crash in ${t.pkg}: ${(err as Error)?.message}`, {
        cause: err,
      });
    }
  }

  throw new Error(
    `No compatible transport for runtime="${CURRENT_RUNTIME}".\nFailures:\n- ${failures.join("\n- ")}`,
  );
}

/**
 * @ru Менеджер транспорта с ленивой инициализацией и кэшированием.
 * Поддерживает синхронный доступ, отложенную инициализацию и корректное завершение.
 * @en Transport manager with lazy initialization and caching.
 * Supports synchronous access, deferred initialization, and graceful shutdown.
 */
export class TransportManager {
  /**
   * @ru Текущий экземпляр транспорта (null до инициализации).
   * @en Current transport instance (null before initialization).
   */
  public transport: HyperTransport | null = null;

  /**
   * @ru Промис отложенной инициализации транспорта.
   * @en Deferred transport initialization promise.
   */
  private promise: Promise<HyperTransport> | null = null;

  /**
   * @ru Конфигурация клиента для создания транспорта.
   * @en Client configuration for transport creation.
   */
  private config: HttpClientOptions;

  /**
   * @ru Создаёт менеджер транспорта с опциональным пользовательским транспортом.
   * @en Creates a transport manager with an optional custom transport.
   * @param config - Client configuration options.
   * @param custom - Optional custom transport instance.
   */
  constructor(config: HttpClientOptions, custom?: HyperTransport) {
    this.config = config;

    if (custom) {
      this.transport = custom;
    } else if (config.customTransport) {
      this.transport = config.customTransport;
    } else if (RESOLVED_RUNTIME_CTOR) {
      this.transport = new RESOLVED_RUNTIME_CTOR(config);
    }
  }

  /**
   * @ru Синхронно возвращает текущий транспорт или null, если не инициализирован.
   * @en Synchronously returns the current transport or null if not initialized.
   * @returns The transport instance or null.
   */
  public getSync(): HyperTransport | null {
    return this.transport;
  }

  /**
   * @ru Гарантирует наличие транспорта, инициализируя его при необходимости.
   * Повторные вызовы возвращают один и тот же промис.
   * @en Ensures a transport exists, initializing it if necessary.
   * Repeated calls return the same promise.
   * @returns Promise resolving to the transport instance.
   */
  public ensure(): Promise<HyperTransport> {
    if (this.transport !== null) {
      return this.promise || (this.promise = Promise.resolve(this.transport));
    }
    if (this.promise !== null) return this.promise;

    return (this.promise = resolveTransport(this.config).then((t) => {
      this.transport = t;
      return t;
    }));
  }

  /**
   * @ru Возвращает транспорт синхронно или промис, если требуется инициализация.
   * @en Returns the transport synchronously or a promise if initialization is needed.
   * @returns The transport instance or a promise resolving to it.
   */
  public get(): HyperTransport | Promise<HyperTransport> {
    return this.transport ?? this.ensure();
  }

  /**
   * @ru Обновляет конфигурацию транспорта, если он поддерживает setConfig.
   * @en Updates the transport configuration if it supports setConfig.
   * @param config - New client configuration options.
   */
  public setConfig(config: HttpClientOptions): void {
    this.config = config;

    if (this.transport && "setConfig" in this.transport) {
      const dynamicTarget = this.transport as {
        setConfig: (config: HttpClientOptions) => void;
      };
      if (typeof dynamicTarget.setConfig === "function") {
        dynamicTarget.setConfig(config);
      }
    }
  }

  /**
   * @ru Завершает работу транспорта и освобождает ресурсы.
   * В graceful-режиме вызывает close(), иначе — destroy().
   * @en Shuts down the transport and releases resources.
   * In graceful mode calls close(), otherwise calls destroy().
   * @param graceful - If true, waits for active requests to complete.
   * @returns Promise that resolves when shutdown is complete.
   */
  public async destroy(graceful = true): Promise<void> {
    const t = this.transport;
    if (!t) return;

    try {
      if (graceful && "close" in t) {
        const closable = t as { close: () => Promise<void> | void };
        if (typeof closable.close === "function") {
          await closable.close();
          return;
        }
      }
      if ("destroy" in t) {
        const destroyable = t as { destroy: () => Promise<void> | void };
        if (typeof destroyable.destroy === "function") {
          await destroyable.destroy();
        }
      }
    } finally {
      this.transport = null;
      this.promise = null;
    }
  }
}
