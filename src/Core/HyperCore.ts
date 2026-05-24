import type { Method } from "../types/http.js";
import type { HttpClientOptions } from "../types/options.js";
import type { RequestBodyData, RequestInterface } from "../types/request.js";
import type { StreamResponse } from "../types/stream.js";
import type { RequestMetrics } from "../types/metrics.js";
import type { HyperTransport } from "../types/transport.js";
import type {
  HttpResponse,
  HyperStats,
  InternalRequest,
} from "../types/hyper.js";

import { defaultConfig } from "../defaultConfig.js";
import { HyperPlugin, PluginContext } from "../types/plugins.js";

const mergeHeadersFast = (
  base: Record<string, string | string[]>,
  override?: Record<string, string | string[]>,
): Record<string, string | string[]> => {
  if (!override) return { ...base };
  return {
    ...base,
    ...override,
  };
};

export class HyperCore {
  public config: HttpClientOptions;
  private transport: HyperTransport | null = null;
  private transportPromise: Promise<HyperTransport> | null = null;
  private readonly defaultHeaders: Record<string, string | string[]>;
  private readonly pluginCtx: PluginContext;

  constructor(config: HttpClientOptions, transport?: HyperTransport) {
    this.config = {
      ...defaultConfig,
      ...config,
      network: {
        ...defaultConfig.network,
        ...config.network,
      },
    };

    if (transport) {
      this.transport = transport;
    }

    this.defaultHeaders = {
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br",
      "User-Agent": this.config.network?.userAgent ?? "Hyperttp/2.0",
      ...(this.config.network?.headers ?? {}),
    };

    this.pluginCtx = {
      config: this.config,
      core: this,
    };
  }

  private async createTransport(): Promise<HyperTransport> {
    if (typeof Bun !== "undefined") {
      const { BunTransport } = await import("../transports/bun.js");
      return new BunTransport(this.config);
    }
    const { NodeTransport } = await import("../transports/node.js");
    return new NodeTransport(this.config);
  }

  private ensureTransport(): Promise<HyperTransport> {
    if (this.transport) {
      return Promise.resolve(this.transport);
    }
    if (!this.transportPromise) {
      this.transportPromise = this.createTransport().then((transport) => {
        this.transport = transport;
        return transport;
      });
    }
    return this.transportPromise;
  }

  public dispatch = async <T = unknown>(
    req: InternalRequest,
  ): Promise<HttpResponse<T>> => {
    if (req.signal?.aborted) {
      throw new Error("Request aborted by user");
    }

    const transport = this.transport ?? (await this.ensureTransport());
    const rawResponse = await transport.execute({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
      signal: req.signal,
    });

    const result: HttpResponse<T> = {
      status: rawResponse.status,
      headers: rawResponse.headers,
      body: rawResponse.body as T,
      url: rawResponse.url,
      clone: () => ({
        status: rawResponse.status,
        headers: { ...rawResponse.headers },
        body:
          typeof rawResponse.body === "object" && rawResponse.body !== null
            ? structuredClone(rawResponse.body)
            : rawResponse.body,
        url: rawResponse.url,
        clone: () => result.clone(),
      }),
    };

    return result;
  };

  public use(plugin: HyperPlugin): this {
    if (typeof plugin.enabled === "function" && !plugin.enabled(this.config)) {
      return this;
    }

    if (typeof plugin.setup === "function") {
      plugin.setup(this.pluginCtx);
    }

    if (typeof plugin.wrapDispatch === "function") {
      this.dispatch = plugin.wrapDispatch(this.dispatch, this.pluginCtx);
    }

    return this;
  }

  public async stream(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<StreamResponse<any>> {
    let url: string;
    let reqHeaders: Record<string, string | string[]> | undefined;

    if (typeof req === "string") {
      url = req;
    } else {
      url = req.getURL();
      signal = req.getSignal?.() ?? (req as any).signal;
      reqHeaders = req.getHeaders?.();
    }

    const transport = this.transport ?? (await this.ensureTransport());

    const rawResponse = await transport.execute({
      method: "GET",
      url,
      headers: mergeHeadersFast(this.defaultHeaders, reqHeaders),
      signal,
    });

    return {
      status: rawResponse.status,
      headers: rawResponse.headers,
      body: rawResponse.body,
      url: rawResponse.url,
    };
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
    let url: string;
    let reqHeaders: Record<string, string | string[]> | undefined;
    let reqSignal: AbortSignal | undefined = signal;
    let finalBody = body;
    let meta: any = undefined;

    if (typeof req === "string") {
      url = req;
    } else {
      url = req.getURL();
      reqHeaders = req.getHeaders?.();
      reqSignal = req.getSignal?.() ?? signal;
      if (req.getBodyData) finalBody = req.getBodyData();
      if (req.getMeta) meta = req.getMeta();
    }

    return {
      method,
      url,
      headers: mergeHeadersFast(this.defaultHeaders, reqHeaders),
      body: finalBody,
      signal: reqSignal,
      meta,
    };
  }

  public extend(options: Partial<HttpClientOptions>): HyperCore {
    return new HyperCore(
      {
        ...this.config,
        ...options,
        network: { ...this.config.network, ...options.network },
      },
      this.transport ?? undefined,
    );
  }

  public create(options: Partial<HttpClientOptions>): HyperCore {
    return this.extend(options);
  }

  public getStats(): HyperStats {
    return {};
  }

  public getAllMetrics(): RequestMetrics[] {
    return [];
  }

  public async destroy(): Promise<void> {
    const transport = this.transport;
    if (transport && typeof transport.destroy === "function") {
      try {
        await transport.destroy();
      } catch (error) {
        if (this.config.verbose) {
          console.warn("[HyperCore] destroy failed:", error);
        }
      }
    }
  }
}
