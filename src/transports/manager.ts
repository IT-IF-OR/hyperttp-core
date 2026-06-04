import { pathToFileURL } from "node:url";

import resolveFrom from "resolve-from";

import type {
  HttpClientOptions,
  HyperTransport,
  HttpResponse,
  StreamResponse,
  HyperttpError,
} from "@hyperttp/types";

import { mapResponseFast, mapStreamFast } from "../utils/response.js";

/**
 * @ru Тип среды выполнения: Bun или Node.js.
 * @en Runtime environment: Bun or Node.js.
 */
export type Runtime = "bun" | "node";

/**
 * @ru Конструктор транспорта, принимающий конфигурацию клиента.
 * @en Transport constructor accepting client configuration.
 */
type TransportCtor = new (config: HttpClientOptions) => HyperTransport;

/**
 * @ru Описание доступного транспорта: имя, поддерживаемые рантаймы, пакет, экспортируемое имя, приоритет.
 * @en Transport definition: name, supported runtimes, package, export name, priority.
 */
type TransportDef = {
  name: string;
  runtime: Runtime[];
  pkg: string;
  export: string;
  priority: number;
};

/**
 * @ru Определение текущей среды выполнения (Bun или Node) на основе глобальных объектов.
 * @en Detects the current runtime (Bun or Node) based on global objects.
 */
export const CURRENT_RUNTIME: Runtime =
  typeof Bun !== "undefined" ? "bun" : "node";

/**
 * @ru Возвращает текущую среду выполнения.
 * @en Returns the current runtime.
 * @returns The current runtime ('bun' or 'node').
 */
export function getRuntime(): Runtime {
  return CURRENT_RUNTIME;
}

/**
 * @ru Список доступных транспортов с приоритетами. Высший приоритет — предпочтительный транспорт для рантайма.
 * @en List of available transports with priorities. Higher priority means preferred transport for the runtime.
 */
export const TRANSPORTS: TransportDef[] = [
  {
    name: "Bun",
    runtime: ["bun"],
    pkg: "@hyperttp/transport-bun",
    export: "BunTransport",
    priority: 100,
  },

  {
    name: "Undici",
    runtime: ["node"],
    pkg: "@hyperttp/transport-undici",
    export: "UndiciTransport",
    priority: 90,
  },

  {
    name: "Node",
    runtime: ["node", "bun"],
    pkg: "../transports/node.js",
    export: "NodeTransport",
    priority: 10,
  },
];

/**
 * @ru Кэш кандидатов транспорта для каждого рантайма, отсортированных по убыванию приоритета.
 * @en Cache of transport candidates per runtime, sorted by descending priority.
 */
const CANDIDATES_MAP: Record<Runtime, TransportDef[]> = {
  node: TRANSPORTS.filter((t) => t.runtime.includes("node")).sort(
    (a, b) => b.priority - a.priority,
  ),

  bun: TRANSPORTS.filter((t) => t.runtime.includes("bun")).sort(
    (a, b) => b.priority - a.priority,
  ),
};

/**
 * @ru Глобальный кэш загруженных классов транспорта для каждого рантайма (избегаем повторной загрузки).
 * @en Global cache of loaded transport classes per runtime (avoids re-loading).
 */
const GLOBAL_TRANSPORT_CLASS_CACHE: Partial<Record<Runtime, TransportCtor>> =
  Object.create(null);

/**
 * @ru Логирует ошибку в зависимости от конфигурации (verbose, logger).
 * @en Logs an error according to configuration (verbose, logger).
 * @param config - Client configuration.
 * @param message - Log message.
 * @param err - Error object.
 */
function logError(
  config: HttpClientOptions,

  message: string,

  err: unknown,
): void {
  if (config.verbose) {
    console.error(message, err);
  }

  const logger = config.logger;

  if (logger) {
    if (typeof logger === "function") {
      (logger as (msg: string, e: unknown) => void)(message, err);
      return;
    }

    const candidate = logger as Record<string, unknown>;

    if (typeof candidate.error === "function") {
      (candidate.error as (msg: string, e: unknown) => void)(message, err);
      return;
    }
  }

  if (!config.verbose) {
    console.error(message, err);
  }
}

/**
 * @ru Проверяет, является ли ошибка "модуль не найден" (пропускаем такие транспорты).
 * @en Checks if the error indicates a missing module (skip such transports).
 * @param err - Error to check.
 * @returns True if module not found.
 */
function isModuleNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as HyperttpError).code;
  const message = err instanceof Error ? err.message : "";

  return (
    code === "ERR_MODULE_NOT_FOUND" ||
    message.includes("Cannot find module") ||
    message.includes("Failed to resolve")
  );
}

/**
 * @ru Разрешает путь к модулю транспорта: для относительных путей использует import.meta.resolve, для пакетов — resolve-from + import.meta.resolve.
 * @en Resolves the module path for a transport: for relative paths uses import.meta.resolve, for packages uses resolve-from + import.meta.resolve.
 * @param pkg - Package name or relative path.
 * @returns Resolved URL string or null if not found.
 */
async function resolveTransportModulePath(pkg: string): Promise<string | null> {
  if (pkg.startsWith(".")) {
    try {
      return import.meta.resolve(pkg, import.meta.url);
    } catch {
      return null;
    }
  }

  const physicalPath = resolveFrom.silent(process.cwd(), pkg);

  if (physicalPath) {
    return pathToFileURL(physicalPath).href;
  }

  try {
    return import.meta.resolve(pkg, import.meta.url);
  } catch {
    return null;
  }
}

/**
 * @ru Загружает конструктор транспорта из указанного пакета и экспорта.
 * @en Loads a transport constructor from the given package and export.
 * @param pkg - Package name or path.
 * @param exportName - Export name.
 * @returns Transport constructor or null.
 */
async function loadTransportCtor(
  pkg: string,
  exportName: string,
): Promise<TransportCtor | null> {
  const path = await resolveTransportModulePath(pkg);
  if (!path) return null;
  const mod = (await import(path)) as Record<string, unknown>;

  const candidate =
    mod[exportName] ??
    (mod.default as Record<string, unknown> | undefined)?.[exportName] ??
    mod.default;

  if (typeof candidate !== "function") return null;

  return candidate as TransportCtor;
}

/**
 * @ru Разрешает и создаёт экземпляр транспорта на основе конфигурации и текущей среды выполнения. Использует кэш классов.
 * @en Resolves and creates a transport instance based on configuration and the current runtime. Uses class cache.
 * @param config - Client configuration.
 * @returns Promise resolving to a transport instance.
 * @throws If no compatible transport is available.
 */
export async function resolveTransport(
  config: HttpClientOptions,
): Promise<HyperTransport> {
  if (config.customTransport) {
    config.logger?.(
      `info`,
      "[Hyperttp] Using custom user-provided transport.",
      config,
    );

    return config.customTransport;
  }

  const runtime = CURRENT_RUNTIME;
  const cachedCtor = GLOBAL_TRANSPORT_CLASS_CACHE[runtime];

  if (cachedCtor) {
    config.logger?.(
      `info`,
      `[Hyperttp] Using cached transport class for runtime: ${runtime}`,
      config,
    );

    return new cachedCtor(config);
  }

  const candidates = CANDIDATES_MAP[runtime];

  for (const t of candidates) {
    try {
      config.logger?.(
        `debug`,
        `[Hyperttp] Attempting to load transport: ${t.name} (${t.pkg})...`,
        config,
      );

      const Transport = await loadTransportCtor(t.pkg, t.export);

      if (!Transport) {
        config.logger?.(
          `debug`,
          `[Hyperttp] Export '${t.export}' not found in ${t.pkg}. Skipping...`,
          config,
        );

        continue;
      }

      config.logger?.(
        `debug`,
        `[Hyperttp] Successfully loaded transport: ${t.name}`,
        config,
      );

      GLOBAL_TRANSPORT_CLASS_CACHE[runtime] = Transport;

      return new Transport(config);
    } catch (err: unknown) {
      if (isModuleNotFoundError(err)) {
        config.logger?.(
          `info`,
          `[Hyperttp] Transport package '${t.pkg}' is not available. Skipping...`,
          config,
        );

        continue;
      }

      logError(
        config,
        `[Hyperttp] Critical error while loading transport ${t.pkg}:`,
        err,
      );

      throw err;
    }
  }

  throw new Error(
    `No compatible transport implementation available for runtime: ${runtime}. Make sure one of ${candidates
      .map((c) => c.pkg)
      .join(", ")} is installed.`,
  );
}

/**
 * @ru Менеджер транспорта: ленивая загрузка, кэширование, синхронизация конфигурации, выполнение запросов, уничтожение.
 * @en Transport manager: lazy loading, caching, config synchronization, request execution, destruction.
 */
export class TransportManager {
  private transport: HyperTransport | null = null;
  private transportPromise: Promise<HyperTransport> | null = null;
  private config: HttpClientOptions;

  /**
   * @ru Создаёт менеджер транспорта.
   * @en Creates a transport manager.
   * @param config - Client configuration.
   * @param customTransport - Optional pre-created transport instance.
   */
  constructor(config: HttpClientOptions, customTransport?: HyperTransport) {
    this.config = config;
    if (customTransport) {
      this.transport = customTransport;
      this.transportPromise = Promise.resolve(customTransport);
      this.syncConfig();
    }
  }

  /**
   * @ru Обновляет конфигурацию клиента и синхронизирует её с активным транспортом (если есть).
   * @en Updates the client configuration and syncs it with the active transport (if any).
   * @param config - New configuration.
   */
  public setConfig(config: HttpClientOptions): void {
    this.config = config;
    this.syncConfig();
  }

  /**
   * @ru Возвращает текущий экземпляр транспорта (если уже загружен).
   * @en Returns the current transport instance (if already loaded).
   */
  public get instance(): HyperTransport | null {
    return this.transport;
  }

  /**
   * @ru Асинхронно получает транспорт (ленивая загрузка).
   * @en Asynchronously gets the transport (lazy loading).
   * @returns Promise resolving to transport instance.
   */
  public async get(): Promise<HyperTransport> {
    if (this.transport) return this.transport;
    if (this.transportPromise) return this.transportPromise;

    this.transportPromise = resolveTransport(this.config).then((t) => {
      this.transport = t;
      this.syncConfig();
      return t;
    });

    return this.transportPromise;
  }

  /**
   * @ru Синхронизирует конфигурацию с транспортом, если транспорт имеет свойство config.
   * @en Syncs configuration with the transport if the transport has a config property.
   */
  private syncConfig(): void {
    if (this.transport && "config" in this.transport) {
      (this.transport as { config?: HttpClientOptions }).config = this.config;
    }
  }

  /**
   * @ru Выполняет запрос и возвращает стандартный HttpResponse (не поток).
   * @en Executes a request and returns a standard HttpResponse (non-stream).
   * @param req - Request parameters for transport.
   * @returns Promise with HTTP response.
   */
  public async execute<T = unknown>(
    req: Parameters<HyperTransport["execute"]>[0],
  ): Promise<HttpResponse<T>> {
    const transport = this.transport || (await this.get());
    const rawResponse = await transport.execute(req);
    return mapResponseFast(rawResponse) as unknown as HttpResponse<T>;
  }

  /**
   * @ru Выполняет запрос и возвращает потоковый ответ (StreamResponse).
   * @en Executes a request and returns a stream response (StreamResponse).
   * @param req - Request parameters for transport.
   * @returns Promise with stream response.
   */
  public async executeStream<T = unknown>(
    req: Parameters<HyperTransport["execute"]>[0],
  ): Promise<StreamResponse<T>> {
    const transport = this.transport || (await this.get());
    const rawResponse = await transport.execute(req);
    return mapStreamFast(rawResponse) as StreamResponse<T>;
  }

  /**
   * @ru Уничтожает транспорт: закрывает соединения (graceful) или принудительно разрушает.
   * @en Destroys the transport: closes connections (graceful) or forces destruction.
   * @param graceful - If true, attempts graceful shutdown via close(). Otherwise destroys.
   * @returns Promise that resolves when destruction is complete.
   */
  public async destroy(graceful = true): Promise<void> {
    const transport = this.transport;
    if (!transport) return;
    if (graceful && typeof transport.close === "function") {
      await transport.close();
      return;
    }

    if (typeof transport.destroy === "function") {
      await transport.destroy();
    }
  }
}
