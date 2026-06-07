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

export type Runtime = "bun" | "node";
type TransportCtor = new (config: HttpClientOptions) => HyperTransport;

type TransportDef = {
  name: string;
  runtime: Runtime[];
  pkg: string;
  export: string;
  priority: number;
};

export const CURRENT_RUNTIME: Runtime =
  typeof Bun !== "undefined" ? "bun" : "node";

export function getRuntime(): Runtime {
  return CURRENT_RUNTIME;
}

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

const CANDIDATES_MAP: Record<Runtime, TransportDef[]> = {
  node: TRANSPORTS.filter((t) => t.runtime.includes("node")).sort(
    (a, b) => b.priority - a.priority,
  ),
  bun: TRANSPORTS.filter((t) => t.runtime.includes("bun")).sort(
    (a, b) => b.priority - a.priority,
  ),
};

const CACHE: Map<string, TransportCtor> = new Map();

const DEBUG = false;
const trace = (...args: unknown[]) => {
  if (DEBUG) console.log("[hyperttp]", ...args);
};

function isModuleNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  const e = err as HyperttpError;
  const msg = err instanceof Error ? err.message : "";

  return (
    e.code === "ERR_MODULE_NOT_FOUND" ||
    msg.includes("Cannot find module") ||
    msg.includes("Failed to resolve")
  );
}

async function resolveModule(pkg: string): Promise<string | null> {
  if (pkg.startsWith(".")) {
    try {
      return import.meta.resolve(pkg, import.meta.url);
    } catch {
      return null;
    }
  }

  try {
    return import.meta.resolve(pkg, import.meta.url);
  } catch {
    //
  }

  const physical = resolveFrom.silent(process.cwd(), pkg);
  if (physical) return pathToFileURL(physical).href;

  return null;
}

async function loadCtor(
  pkg: string,
  exportName: string,
): Promise<TransportCtor | null> {
  const resolved = await resolveModule(pkg);

  if (!resolved) {
    trace("resolve failed:", pkg);
    return null;
  }

  const mod = (await import(resolved)) as Record<string, unknown>;

  const candidate = mod[exportName] ?? mod.default;

  if (typeof candidate !== "function") {
    trace("invalid export:", pkg, exportName);
    return null;
  }

  return candidate as TransportCtor;
}

/**
 * @ru Главный резолвер транспорта (диагностический и детерминированный).
 * @en Main transport resolver (diagnostic and deterministic).
 * @param config - Client configuration (may contain customTransport).
 * @returns Promise resolving to a HyperTransport instance.
 * @throws If no compatible transport can be loaded.
 */
export async function resolveTransport(
  config: HttpClientOptions,
): Promise<HyperTransport> {
  if (config.customTransport) return config.customTransport;

  const runtime = CURRENT_RUNTIME;
  const candidates = CANDIDATES_MAP[runtime];

  const failures: string[] = [];

  for (const t of candidates) {
    trace("trying:", t.pkg);

    try {
      const cached = CACHE.get(t.pkg);
      if (cached) {
        trace("cache hit:", t.pkg);
        return new cached(config);
      }

      const ctor = await loadCtor(t.pkg, t.export);

      if (!ctor) {
        failures.push(`${t.pkg} (no export: ${t.export})`);
        continue;
      }

      CACHE.set(t.pkg, ctor);
      trace("selected:", t.pkg);

      return new ctor(config);
    } catch (err) {
      if (isModuleNotFoundError(err)) {
        failures.push(`${t.pkg} (not installed)`);
        continue;
      }

      throw new Error(
        `[Hyperttp] transport crash in ${t.pkg}: ${(err as Error)?.message}`,
        { cause: err },
      );
    }
  }

  throw new Error(
    `No compatible transport for runtime="${runtime}".\n` +
      `Failures:\n- ${failures.join("\n- ")}`,
  );
}

export interface TransportDebugInfo {
  name: string;
  pkg: string;
  runtime: Runtime;
}

/**
 * @ru Управляет жизненным циклом транспортного слоя: ленивая инициализация, кеширование, синхронизация конфигурации.
 * @en Manages the transport layer lifecycle: lazy initialization, caching, configuration synchronization.
 */
export class TransportManager {
  private transport: HyperTransport | null = null;
  private promise: Promise<HyperTransport> | null = null;
  private config: HttpClientOptions;

  /**
   * @ru Создаёт менеджер транспорта.
   * @en Creates a transport manager.
   * @param config - Client configuration.
   * @param custom - Optional externally provided transport instance.
   */
  constructor(config: HttpClientOptions, custom?: HyperTransport) {
    this.config = config;

    if (custom) {
      this.transport = custom;
      this.promise = Promise.resolve(custom);
    }
  }

  /**
   * @ru Обновляет конфигурацию клиента.
   * @en Updates the client configuration.
   * @param config - New configuration.
   */
  setConfig(config: HttpClientOptions) {
    this.config = config;
  }

  /**
   * @ru Возвращает текущий экземпляр транспорта (если уже инициализирован).
   * @en Returns the current transport instance (if already initialised).
   */
  get instance() {
    return this.transport;
  }

  /**
   * @ru Асинхронно получает экземпляр транспорта (инициализирует при необходимости).
   * @en Asynchronously obtains a transport instance (initialises if needed).
   * @returns Promise resolving to a HyperTransport.
   */
  async get(): Promise<HyperTransport> {
    if (this.transport) return this.transport;
    if (this.promise) return this.promise;

    this.promise = resolveTransport(this.config).then((t) => {
      this.transport = t;
      return t;
    });

    return this.promise;
  }

  /**
   * @ru Выполняет запрос через транспорт и возвращает обычный (не стриминговый) ответ.
   * @en Executes a request through the transport and returns a regular (non‑streaming) response.
   * @param req - Request parameters.
   * @returns Promise resolving to HttpResponse.
   */
  async execute<T = unknown>(
    req: Parameters<HyperTransport["execute"]>[0],
  ): Promise<HttpResponse<T>> {
    const t = this.transport || (await this.get());
    return mapResponseFast(await t.execute(req)) as HttpResponse<T>;
  }

  /**
   * @ru Выполняет запрос через транспорт и возвращает стриминговый ответ.
   * @en Executes a request through the transport and returns a streaming response.
   * @param req - Request parameters.
   * @returns Promise resolving to StreamResponse.
   */
  async executeStream<T = unknown>(
    req: Parameters<HyperTransport["execute"]>[0],
  ): Promise<StreamResponse<T>> {
    const t = this.transport || (await this.get());
    return mapStreamFast(await t.execute(req)) as StreamResponse<T>;
  }

  /**
   * @ru Возвращает отладочную информацию о текущем транспорте.
   * @en Returns debug information about the current transport.
   */
  public get debug(): TransportDebugInfo | null {
    const t = this.transport as any;
    if (!t) return null;

    return {
      name: t.__name ?? t.constructor?.name,
      pkg: t.__pkg ?? "unknown",
      runtime: getRuntime(),
    };
  }

  /**
   * @ru Завершает работу транспорта (закрывает соединения при graceful shutdown, иначе принудительно уничтожает).
   * @en Shuts down the transport (gracefully closes connections or forcefully destroys).
   * @param graceful - If true, attempt graceful close; otherwise call destroy.
   * @returns Promise that resolves when shutdown is complete.
   */
  async destroy(graceful = true): Promise<void> {
    const t = this.transport;
    if (!t) return;

    if (graceful && typeof t.close === "function") {
      await t.close();
      return;
    }

    if (typeof t.destroy === "function") {
      await t.destroy();
    }
  }
}
