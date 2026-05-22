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
import { deepMerge } from "../utils/merge.js";

const getTimestamp = (): number | bigint => {
  return typeof process !== "undefined" && process.hrtime?.bigint
    ? process.hrtime.bigint()
    : performance.now();
};

const getDurationMs = (
  start: number | bigint,
  end: number | bigint,
): number => {
  if (typeof start === "bigint" && typeof end === "bigint") {
    return Number(end - start) / 1_000_000;
  }
  return (end as number) - (start as number);
};

export class HyperCore {
  public config: HttpClientOptions;
  private transport: HyperTransport | null = null;
  private defaultHeaders: Record<string, string>;
  private transportPromise: Promise<HyperTransport> | null = null;
  constructor(config: HttpClientOptions, transport?: HyperTransport) {
    const finalConfig = deepMerge({ ...defaultConfig }, config);
    this.config = finalConfig;
    if (transport) {
      this.transport = transport;
    }

    this.defaultHeaders = {
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br",
      "User-Agent": config.network?.userAgent || "Hyperttp/2.0",
    };
  }

  /**
   * Приватный метод для ленивого создания транспорта при первом запросе
   */
  private async ensureTransport(): Promise<HyperTransport> {
    if (this.transportPromise) return this.transportPromise;
    if (this.transport) return this.transport;

    this.transportPromise = (async () => {
      let transport: HyperTransport;
      if (typeof Bun !== "undefined") {
        const { BunTransport } = await import("../transports/bun.js");
        transport = new BunTransport(this.config);
      } else {
        const { NodeTransport } = await import("../transports/node.js");
        transport = new NodeTransport(this.config);
      }

      this.transport = transport;

      return transport;
    })();

    return this.transportPromise;
  }

  public dispatch = async <T = any>(
    req: InternalRequest,
  ): Promise<HttpResponse<T>> => {
    const urlString = typeof req.url === "string" ? req.url : req.url.getURL();

    if (req.signal?.aborted) {
      throw new Error("Request aborted by user");
    }

    const activeTransport = await this.ensureTransport();

    req.meta = req.meta || {};
    req.meta.timings = req.meta.timings || {};

    const startNetwork = this.config.trackMetrics ? getTimestamp() : null;

    const rawResponse = await activeTransport.execute({
      method: req.method,
      url: urlString,
      headers: req.headers,
      body: req.body,
      signal: req.signal,
    });

    if (this.config.trackMetrics && startNetwork !== null) {
      req.meta.timings.networkMs = getDurationMs(startNetwork, getTimestamp());
    }

    return {
      status: rawResponse.status,
      headers: rawResponse.headers,
      body: req.method === "HEAD" ? (undefined as any) : rawResponse.body,
      url: rawResponse.url,
    };
  };

  public async stream(
    req: RequestInterface | string,
  ): Promise<StreamResponse<any>> {
    const url = typeof req === "string" ? req : req.getURL();
    const signal =
      typeof req !== "string"
        ? (req.getSignal?.() ?? (req as any).signal)
        : undefined;
    const headers = {
      ...this.defaultHeaders,
      ...(typeof req !== "string" ? req.getHeaders?.() : {}),
    };

    const activeTransport = await this.ensureTransport();

    const rawResponse = await activeTransport.execute({
      method: "GET",
      url,
      headers,
      signal,
    });

    return {
      status: rawResponse.status,
      headers: rawResponse.headers,
      body: rawResponse.body,
      url: rawResponse.url,
    };
  }

  public get<T = any>(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    if (typeof req === "string") {
      return this.dispatch<T>({
        method: "GET",
        url: req,
        headers: { ...this.defaultHeaders },
        isGet: true,
        signal,
      });
    }
    return this.requestInternal<T>("GET", req, undefined, true, signal);
  }

  public post<T = any>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.requestInternal<T>("POST", req, body, false, signal);
  }

  public put<T = any>(
    req: RequestInterface | string,
    body?: RequestBodyData,
  ): Promise<HttpResponse<T>> {
    return this.requestInternal<T>("PUT", req, body, false);
  }

  public delete<T = any>(
    req: RequestInterface | string,
  ): Promise<HttpResponse<T>> {
    return this.requestInternal<T>("DELETE", req, undefined, false);
  }

  public patch<T = any>(
    req: RequestInterface | string,
    body?: RequestBodyData,
  ): Promise<HttpResponse<T>> {
    return this.requestInternal<T>("PATCH", req, body, false);
  }

  public options<T = any>(
    req: RequestInterface | string,
    body?: RequestBodyData,
  ): Promise<HttpResponse<T>> {
    return this.requestInternal<T>("OPTIONS", req, body, false);
  }

  public async head(
    req: RequestInterface | string,
  ): Promise<HttpResponse<null>> {
    return this.requestInternal<null>("HEAD", req, undefined, false);
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

  private async requestInternal<T>(
    method: Method,
    req: RequestInterface | string,
    body?: RequestBodyData,
    isGet: boolean = false,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.dispatch<T>({
      method,
      url: req,
      headers: {
        ...this.defaultHeaders,
        ...(typeof req !== "string" ? req.getHeaders?.() : {}),
      },
      body:
        typeof req !== "string" && req.getBodyData ? req.getBodyData() : body,
      isGet,
      signal: typeof req !== "string" ? req.getSignal?.() : signal,
    });
  }

  public getStats(): HyperStats {
    return {};
  }
  public getAllMetrics(): RequestMetrics[] {
    return [];
  }

  public async destroy() {
    try {
      if (this.transport && typeof this.transport.destroy === "function") {
        await this.transport.destroy();
      }
    } catch (error) {
      if (this.config.verbose) {
        console.warn("[HyperCore] destroy failed:", error);
      }
    }
  }
}
