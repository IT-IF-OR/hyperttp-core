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
  name: string;
  /** @ru Список сред, в которых транспорт может работать. @en List of runtimes where the transport can operate. */
  runtime: Runtime[];
  /** @ru Имя пакета npm или относительный путь для встроенных транспортов. @en npm package name or relative path for built-in transports. */
  pkg: string;
  /** @ru Имя экспортируемого класса транспорта. @en Exported transport class name. */
  export: string;
  /** @ru Приоритет выбора (выше значение = раньше попытка загрузки). @en Selection priority (higher value = earlier load attempt). */
  priority: number;
};

interface ResolveFromModule {
  (fromDirectory: string, moduleId: string): string;
  silent?: (fromDirectory: string, moduleId: string) => string | undefined;
}

interface NodeUrlModule {
  pathToFileURL: (path: string) => { href: string };
  fileURLToPath: (url: string) => string;
}

export const CURRENT_RUNTIME: Runtime = (() => {
  if (typeof Bun !== "undefined") return "bun";
  if (typeof Deno !== "undefined") return "deno";
  if (typeof process !== "undefined" && process.versions?.node) return "node";
  return "browser";
})();

export const TRANSPORTS: TransportDef[] = [
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

const CANDIDATES = TRANSPORTS.filter((t) => t.runtime.includes(CURRENT_RUNTIME)).sort(
  (a, b) => b.priority - a.priority,
);

let RESOLVED_RUNTIME_CTOR: TransportCtor | null = null;

let NODE_RESOLVE_TOOLS: [ResolveFromModule, NodeUrlModule] | null = null;
let ATTEMPTED_TOOLS_LOAD = false;

export const runtimeImport = Function("s", "return import(s)") as <T = unknown>(
  specifier: string,
) => Promise<T>;

async function getResolveTools(): Promise<[ResolveFromModule, NodeUrlModule] | null> {
  if (NODE_RESOLVE_TOOLS || ATTEMPTED_TOOLS_LOAD) return NODE_RESOLVE_TOOLS;
  ATTEMPTED_TOOLS_LOAD = true;

  try {
    const [rf, url] = await Promise.all([
      runtimeImport<{ default?: ResolveFromModule } & ResolveFromModule>("resolve-from").catch(
        () => null,
      ),
      runtimeImport<{ default?: NodeUrlModule } & NodeUrlModule>("node:url").catch(() => null),
    ]);

    if (rf && url) {
      NODE_RESOLVE_TOOLS = [rf.default ?? rf, url.default ?? url];
    }
  } catch {
    //
  }
  return NODE_RESOLVE_TOOLS;
}

function getCurrentModuleDir(): string {
  try {
    const url = import.meta.url;
    if (url.startsWith("file://")) {
      const path = url.slice(7);
      return path.substring(0, path.lastIndexOf("/"));
    }
  } catch {
    //
  }
  return ".";
}

async function resolveExternalModule(pkg: string): Promise<string | null> {
  if (CURRENT_RUNTIME === "browser") return null;

  const tools = await getResolveTools();

  if (tools) {
    const [resolveFrom, urlModule] = tools;

    try {
      let cwd = ".";
      try {
        cwd = process.cwd();
      } catch {}

      const physicalPath = resolveFrom.silent?.(cwd, pkg) ?? resolveFrom(cwd, pkg);
      if (physicalPath) {
        return urlModule.pathToFileURL(physicalPath).href;
      }
    } catch {
      //
    }

    try {
      const coreDir = getCurrentModuleDir();
      const physicalPath = resolveFrom.silent?.(coreDir, pkg) ?? resolveFrom(coreDir, pkg);
      if (physicalPath) {
        return urlModule.pathToFileURL(physicalPath).href;
      }
    } catch {
      //
    }
  }

  try {
    if (typeof import.meta.resolve === "function") {
      return import.meta.resolve(pkg, import.meta.url);
    }
  } catch {
    //
  }

  return null;
}

function isModuleNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? (err as Record<string, unknown>).code : undefined;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") return true;

  const msg = err instanceof Error ? err.message : "";
  return (
    msg.includes("Cannot find module") ||
    msg.includes("Failed to resolve") ||
    msg.includes("Failed to load")
  );
}

async function loadCtor(pkg: string, exportName: string): Promise<TransportCtor | null> {
  if (CURRENT_RUNTIME === "browser") {
    if (pkg !== "./browser.js") return null;
    const mod = (await import("./browser.js")) as Record<string, unknown>;
    const candidate = mod[exportName] ?? mod.default;
    return typeof candidate === "function" ? (candidate as TransportCtor) : null;
  }

  let specifier = pkg;

  if (pkg[0] === "." || pkg[0] === "/") {
    try {
      specifier = import.meta.resolve(pkg, import.meta.url);
    } catch {
      //
    }
  } else {
    const resolved = await resolveExternalModule(pkg);
    if (resolved) specifier = resolved;
  }

  try {
    const mod = await runtimeImport<Record<string, unknown>>(specifier);
    const candidate = mod[exportName] ?? mod.default;
    return typeof candidate === "function" ? (candidate as TransportCtor) : null;
  } catch (err) {
    if (isModuleNotFoundError(err)) {
      const isNativeTransport = pkg.includes(CURRENT_RUNTIME);
      const isDebugEnabled = typeof process !== "undefined" && process.env?.HYPERTTP_DEBUG;

      if (isNativeTransport || isDebugEnabled) {
        console.warn(`\n⚠️ [Hyperttp Debug] Failed to load preferred transport "${pkg}":`);
        console.error(err);
        console.warn(`Falling back to alternative transport...\n`);
      }
      return null;
    }
    throw err;
  }
}

export async function resolveTransport(config: HttpClientOptions): Promise<HyperTransport> {
  if (config.customTransport) return config.customTransport;
  if (RESOLVED_RUNTIME_CTOR) return new RESOLVED_RUNTIME_CTOR(config);

  const failures: string[] = [];

  for (let i = 0; i < CANDIDATES.length; i++) {
    const t = CANDIDATES[i]!;
    try {
      const ctor = await loadCtor(t.pkg, t.export);
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

export class TransportManager {
  public transport: HyperTransport | null = null;
  private promise: Promise<HyperTransport> | null = null;
  private config: HttpClientOptions;

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

  public getSync(): HyperTransport | null {
    return this.transport;
  }

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

  public get(): HyperTransport | Promise<HyperTransport> {
    return this.transport ?? this.ensure();
  }

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
