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

const GLOBAL_TRANSPORT_CLASS_CACHE: Partial<Record<Runtime, TransportCtor>> =
  Object.create(null);

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

export class TransportManager {
  private transport: HyperTransport | null = null;

  private transportPromise: Promise<HyperTransport> | null = null;

  private config: HttpClientOptions;

  constructor(config: HttpClientOptions, customTransport?: HyperTransport) {
    this.config = config;
    if (customTransport) {
      this.transport = customTransport;
      this.transportPromise = Promise.resolve(customTransport);
      this.syncConfig();
    }
  }

  public setConfig(config: HttpClientOptions): void {
    this.config = config;
    this.syncConfig();
  }

  public get instance(): HyperTransport | null {
    return this.transport;
  }

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

  private syncConfig(): void {
    if (this.transport && "config" in this.transport) {
      (this.transport as { config?: HttpClientOptions }).config = this.config;
    }
  }

  public async execute<T = unknown>(
    req: Parameters<HyperTransport["execute"]>[0],
  ): Promise<HttpResponse<T>> {
    const transport = this.transport || (await this.get());
    const rawResponse = await transport.execute(req);
    return mapResponseFast(rawResponse) as unknown as HttpResponse<T>;
  }

  public async executeStream<T = unknown>(
    req: Parameters<HyperTransport["execute"]>[0],
  ): Promise<StreamResponse<T>> {
    const transport = this.transport || (await this.get());
    const rawResponse = await transport.execute(req);
    return mapStreamFast(rawResponse) as StreamResponse<T>;
  }

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
