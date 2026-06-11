import type { HttpClientOptions, HyperTransport } from "@hyperttp/types";

export type Runtime = "bun" | "node" | "deno" | "browser";
type TransportCtor = new (config: HttpClientOptions) => HyperTransport;

type TransportDef = {
  name: string;
  runtime: Runtime[];
  pkg: string;
  export: string;
  priority: number;
};

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
    pkg: "../transports/browser.js",
    export: "BrowserTransport",
    priority: 80,
  },
  {
    name: "Node",
    runtime: ["node", "bun", "deno"],
    pkg: "../transports/node.js",
    export: "NodeTransport",
    priority: 10,
  },
];

const CANDIDATES = TRANSPORTS.filter((t) => t.runtime.includes(CURRENT_RUNTIME)).sort(
  (a, b) => b.priority - a.priority,
);

let RESOLVED_RUNTIME_CTOR: TransportCtor | null = null;
let NODE_RESOLVE_TOOLS: [any, any] | null = null;
let ATTEMPTED_TOOLS_LOAD = false;

export const runtimeImport = Function("s", "return import(s)") as <T = any>(
  specifier: string,
) => Promise<T>;

function isModuleNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as any).code;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") return true;
  const msg = err instanceof Error ? err.message : "";
  return (
    msg.includes("Cannot find module") ||
    msg.includes("Failed to resolve") ||
    msg.includes("Failed to load")
  );
}

async function resolveExternalModule(pkg: string): Promise<string | null> {
  try {
    if (typeof import.meta.resolve === "function") {
      return import.meta.resolve(pkg, import.meta.url);
    }
  } catch {
    //
  }

  if (CURRENT_RUNTIME !== "browser") {
    try {
      if (!NODE_RESOLVE_TOOLS && !ATTEMPTED_TOOLS_LOAD) {
        ATTEMPTED_TOOLS_LOAD = true;
        NODE_RESOLVE_TOOLS = await Promise.all([
          runtimeImport("resolve-from").catch(() => null),
          runtimeImport("node:url").catch(() => null),
        ]);
      }

      if (!NODE_RESOLVE_TOOLS || !NODE_RESOLVE_TOOLS[0] || !NODE_RESOLVE_TOOLS[1]) return null;

      const resolveFrom = NODE_RESOLVE_TOOLS[0].default ?? NODE_RESOLVE_TOOLS[0];
      const url = NODE_RESOLVE_TOOLS[1].default ?? NODE_RESOLVE_TOOLS[1];

      let cwd = ".";
      try {
        cwd = process.cwd();
      } catch {
        //
      }

      const physicalPath = resolveFrom.silent?.(cwd, pkg) ?? resolveFrom(cwd, pkg);
      if (physicalPath) {
        return url.pathToFileURL(physicalPath).href;
      }
    } catch {
      //
    }
  }
  return null;
}

async function loadCtor(pkg: string, exportName: string): Promise<TransportCtor | null> {
  if (CURRENT_RUNTIME === "browser") {
    if (pkg !== "../transports/browser.js") return null;
    const mod = (await import("../transports/browser.js")) as any;
    const candidate = mod[exportName] ?? mod.default;
    return typeof candidate === "function" ? candidate : null;
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
    if (isModuleNotFoundError(err)) return null;
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
    if (this.transport && typeof (this.transport as any).setConfig === "function") {
      (this.transport as any).setConfig(config);
    }
  }

  public async destroy(graceful = true): Promise<void> {
    const t = this.transport;
    if (!t) return;

    try {
      if (graceful && typeof t.close === "function") {
        await t.close();
        return;
      }
      if (typeof t.destroy === "function") {
        await t.destroy();
      }
    } finally {
      this.transport = null;
      this.promise = null;
    }
  }
}
