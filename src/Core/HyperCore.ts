import type {
  IHyperCore,
  HyperTransport,
  HttpClientOptions,
  PluginContext,
  HyperPlugin,
  InternalRequest,
  HttpResponse,
  HyperttpError,
  RequestInterface,
  StreamResponse,
  RequestBodyData,
  Method,
} from "@hyperttp/types";
import { defaultConfig } from "../defaultConfig.js";
import {
  mapResponseFast,
  mapStreamFast,
  mergeHeadersFast,
} from "../utils/response.js";
import { createRequire } from "node:module";
import {
  createPipelines,
  executeErrorPipeline,
  executeRequestPipeline,
  executeResponsePipeline,
  insertHookSorted,
} from "../utils/pipeline.js";

type TransportArgs = Parameters<HyperTransport["execute"]>[0];

export type Runtime = "bun" | "node";

export function getRuntime(): Runtime {
  if (typeof Bun !== "undefined") return "bun";
  return "node";
}

type TransportDef = {
  name: string;
  runtime: Runtime[];
  pkg: string;
  export: string;
  priority: number;
};

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

export async function resolveTransport(
  config: HttpClientOptions,
): Promise<HyperTransport> {
  if (config.customTransport) {
    config.logger?.("debug", "Using user-provided custom transport.");
    return config.customTransport;
  }

  const runtime = getRuntime();
  const candidates = TRANSPORTS.filter((t) => t.runtime.includes(runtime)).sort(
    (a, b) => b.priority - a.priority,
  );

  const localRequire = createRequire(process.cwd() + "/package.json");

  for (const t of candidates) {
    config.logger?.("debug", `Loading transport: ${t.name}`);
    try {
      const path = t.pkg.startsWith(".")
        ? new URL(t.pkg, import.meta.url).href
        : localRequire.resolve(t.pkg);

      const mod = await import(path);
      const Transport = mod[t.export] || mod.default?.[t.export] || mod.default;

      if (!Transport) continue;

      config.logger?.("info", `Selected transport: ${t.name}`);
      return new Transport(config);
    } catch (e) {
      config.logger?.("debug", `Skip ${t.name}: ${e}`);
    }
  }

  throw new Error(
    `No compatible transport implementation available for runtime: ${runtime}`,
  );
}

export class HyperCore implements IHyperCore {
  public config: HttpClientOptions;
  private transport: HyperTransport | null = null;
  private transportPromise: Promise<HyperTransport> | null = null;
  private readonly defaultHeaders: Record<string, string | string[]>;
  private readonly pluginCtx: PluginContext;
  private readonly pipelines = createPipelines();

  constructor(config: HttpClientOptions, transport?: HyperTransport) {
    this.config = {
      ...defaultConfig,
      ...config,
      network: { ...defaultConfig.network, ...config.network },
    };

    if (transport) {
      this.transport = transport;
      this.transportPromise = Promise.resolve(transport);
      if ("config" in transport) {
        (transport as { config?: HttpClientOptions }).config = this.config;
      }
    }

    this.defaultHeaders = {
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br",
      "User-Agent": this.config.network?.userAgent ?? "Hyperttp/2.0",
      ...this.config.network?.headers,
    };

    this.pluginCtx = { config: this.config, core: this };
  }

  private async createTransport(): Promise<HyperTransport> {
    return resolveTransport(this.config);
  }

  private ensureTransport(): Promise<HyperTransport> {
    return (
      this.transportPromise ||
      (this.transportPromise = this.createTransport().then((t) => {
        this.transport = t;
        return t;
      }))
    );
  }

  public async dispatch<T = unknown>(
    req: InternalRequest,
  ): Promise<HttpResponse<T>> {
    try {
      const shortCircuit = await executeRequestPipeline(
        this.pipelines.request,
        req,
        this.pluginCtx,
      );
      if (shortCircuit) {
        await executeResponsePipeline(
          this.pipelines.responseMutators,
          this.pipelines.responseSideEffects,
          shortCircuit,
          req,
          this.pluginCtx,
          this.config.logger,
        );
        return shortCircuit as HttpResponse<T>;
      }

      const transport = this.transport || (await this.ensureTransport());
      const rawResponse = await transport.execute(req as TransportArgs);
      const response = mapResponseFast(rawResponse);

      await executeResponsePipeline(
        this.pipelines.responseMutators,
        this.pipelines.responseSideEffects,
        response,
        req,
        this.pluginCtx,
        this.config.logger,
      );
      return response as unknown as HttpResponse<T>;
    } catch (error) {
      const httpError = error as HyperttpError;
      const recovered = await executeErrorPipeline(
        this.pipelines.error,
        httpError,
        req,
        this.pluginCtx,
      );

      if (recovered) {
        await executeResponsePipeline(
          this.pipelines.responseMutators,
          this.pipelines.responseSideEffects,
          recovered,
          req,
          this.pluginCtx,
          this.config.logger,
        );
        return recovered as HttpResponse<T>;
      }

      throw error;
    }
  }

  public use(plugin: HyperPlugin): this {
    const isEnabled = plugin.enabled ? plugin.enabled(this.config) : true;
    if (!isEnabled) return this;

    if (plugin.setup) plugin.setup(this.pluginCtx);

    const priority = (plugin as { priority?: number }).priority ?? 0;

    if (plugin.onRequest) {
      insertHookSorted(this.pipelines.request, {
        name: plugin.name,
        priority,
        run: plugin.onRequest,
      });
    }

    if (plugin.onResponse) {
      if (plugin.mode === "background") {
        insertHookSorted(this.pipelines.responseSideEffects, {
          name: plugin.name,
          priority,
          run: plugin.onResponse,
        });
      } else {
        insertHookSorted(this.pipelines.responseMutators, {
          name: plugin.name,
          priority,
          run: plugin.onResponse,
        });
      }
    }

    if (plugin.onError) {
      insertHookSorted(this.pipelines.error, {
        name: plugin.name,
        priority,
        run: plugin.onError,
      });
    }

    return this;
  }

  public async stream(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<StreamResponse<unknown>> {
    const isStr = typeof req === "string";
    const url = isStr ? req : req.url;
    const reqHeaders = isStr ? undefined : req.headers;
    const finalSignal = isStr ? signal : (req.signal ?? signal);

    const transportArgs: TransportArgs = {
      method: "GET",
      url,
      headers: mergeHeadersFast(this.defaultHeaders, reqHeaders) as Record<
        string,
        string | string[]
      >,
      signal: finalSignal,
    };

    const transport = this.transport || (await this.ensureTransport());
    const rawResponse = await transport.execute(transportArgs);
    return mapStreamFast(rawResponse);
  }

  public get<T = unknown>(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.dispatch<T>(
      this.buildInternalRequest("GET", req, undefined, signal),
    );
  }

  public post<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.dispatch<T>(
      this.buildInternalRequest("POST", req, body, signal),
    );
  }

  public async postStream<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): Promise<StreamResponse<T>> {
    const isStr = typeof req === "string";
    const url = isStr ? req : req.url;
    const reqHeaders = isStr ? undefined : req.headers;
    const finalSignal = isStr ? signal : (req.signal ?? signal);

    const transportArgs: TransportArgs = {
      method: "POST",
      url,
      headers: mergeHeadersFast(this.defaultHeaders, reqHeaders) as Record<
        string,
        string | string[]
      >,
      body: isStr ? body : (req.body ?? body),
      signal: finalSignal,
    };

    const transport = this.transport || (await this.ensureTransport());
    const rawResponse = await transport.execute(transportArgs);
    return mapStreamFast(rawResponse) as unknown as StreamResponse<T>;
  }

  public put<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.dispatch<T>(
      this.buildInternalRequest("PUT", req, body, signal),
    );
  }

  public patch<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.dispatch<T>(
      this.buildInternalRequest("PATCH", req, body, signal),
    );
  }

  public delete<T = unknown>(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.dispatch<T>(
      this.buildInternalRequest("DELETE", req, undefined, signal),
    );
  }

  public options<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.dispatch<T>(
      this.buildInternalRequest("OPTIONS", req, body, signal),
    );
  }

  public head(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<null>> {
    return this.dispatch<null>(
      this.buildInternalRequest("HEAD", req, undefined, signal),
    );
  }

  private buildInternalRequest(
    method: Method,
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): InternalRequest {
    if (typeof req === "string") {
      return {
        method,
        url: req,
        headers: { ...this.defaultHeaders } as Record<
          string,
          string | string[]
        >,
        body,
        signal,
        meta: undefined,
      };
    }

    const headers = req.headers
      ? (mergeHeadersFast(this.defaultHeaders, req.headers) as Record<
          string,
          string | string[]
        >)
      : ({ ...this.defaultHeaders } as Record<string, string | string[]>);

    return {
      method,
      url: req.url,
      headers,
      body: req.body ?? body,
      signal: req.signal ?? signal,
      meta: req.meta as InternalRequest["meta"],
    };
  }

  public extend(options: Partial<HttpClientOptions>): this {
    this.config = {
      ...this.config,
      ...options,
      network: { ...this.config.network, ...options.network },
    };

    (this.pluginCtx as { config: HttpClientOptions }).config = this.config;
    return this;
  }

  public create(options: Partial<HttpClientOptions>): HyperCore {
    return new HyperCore(
      {
        ...this.config,
        ...options,
        network: { ...this.config.network, ...options.network },
      },
      this.transport ?? undefined,
    );
  }

  public async destroy(graceful = true): Promise<void> {
    this.config.logger?.("debug", "Destroying transport...");
    const transport = this.transport;
    if (!transport) return;

    if (graceful && typeof transport.close === "function") {
      await transport.close();
    } else if (typeof transport.destroy === "function") {
      await transport.destroy();
    }
  }

  public async json<T = unknown>(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<T> {
    const method =
      typeof req === "string"
        ? "GET"
        : ((req as { method?: Method }).method ?? "GET");
    const res = await this.dispatch<unknown>(
      this.buildInternalRequest(method, req, undefined, signal),
    );
    return res.json!<T>();
  }

  public async text(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<string> {
    const method =
      typeof req === "string"
        ? "GET"
        : ((req as { method?: Method }).method ?? "GET");
    const res = await this.dispatch<unknown>(
      this.buildInternalRequest(method, req, undefined, signal),
    );
    return res.text!();
  }

  public async dump(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<void> {
    const method =
      typeof req === "string"
        ? "GET"
        : ((req as { method?: Method }).method ?? "GET");
    const res = await this.dispatch<unknown>(
      this.buildInternalRequest(method, req, undefined, signal),
    );
    await res.dump!();
  }
}
