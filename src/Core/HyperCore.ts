import { CookieAgent } from "http-cookie-agent/undici";
import { RequestExecutor } from "./RequestExecutor.js";

import type { Method } from "../types/http.js";
import type { HttpClientOptions } from "../types/options.js";
import type { RequestBodyData, RequestInterface } from "../types/request.js";
import type { StreamResponse } from "../types/stream.js";
import type { Readable } from "node:stream";
import type { RetryOptions } from "../types/retry.js";
import type { RequestMetrics } from "../types/metrics.js";

export interface InternalRequest {
  method: Method;
  url: RequestInterface | string;
  headers: Record<string, string>;
  body?: RequestBodyData;
  signal?: AbortSignal;
  isGet: boolean;
  meta?: {
    timings?: {
      serializationMs?: number;
      networkMs?: number;
      parsingMs?: number;
    };
    [key: string]: any;
  };
}

export interface HttpResponse<T = any> {
  status: number;
  headers: Record<string, any>;
  url?: string;
  body: T;
}

export interface HyperStats {
  inflightRequests?: number;
  cacheSize?: number;
  queuedRequests?: number;
  activeQueue?: number;
  rateLimitHits?: number;
  [key: string]: any;
}

export class HyperCore {
  public config: HttpClientOptions;
  private agent: CookieAgent;
  private executor: RequestExecutor;
  private defaultHeaders: Record<string, string>;

  constructor(config: HttpClientOptions) {
    this.config = config;

    const concurrency =
      config.network?.maxConcurrent === 0
        ? Infinity
        : (config.network?.maxConcurrent ?? 500);

    const pipelining =
      config.network?.pipelining === 0
        ? 256
        : (config.network?.pipelining ?? 10);

    this.agent = new CookieAgent({
      connections: concurrency === Infinity ? 0x7fffffff : concurrency,
      pipelining: pipelining,
      keepAliveTimeout: config.network?.keepAliveTimeout ?? 30000,
      keepAliveMaxTimeout: config.network?.keepAliveTimeout ?? 30000,
      connect: { rejectUnauthorized: config.network?.rejectUnauthorized },
      allowH2: config.network?.allowHttp2 ?? true,
    });

    const retryOptions: RetryOptions = {
      maxRetries: (config as any).retry?.maxRetries ?? 3,
      ...(config as any).retry,
    };

    const network = config.network;

    this.executor = new RequestExecutor(this.agent, {
      timeout: network?.timeout ?? 30000,
      maxRetries: retryOptions.maxRetries ?? 3,
      followRedirects: network?.followRedirects ?? true,
      maxRedirects: network?.maxRedirects ?? 5,
      retryOptions: retryOptions,
      verbose: config.verbose ?? false,
      logger: config.logger,
    });

    this.defaultHeaders = {
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br",
      "User-Agent": config.network?.userAgent || "Hyperttp/2.0",
    };
  }

  public dispatch = async <T = any>(
    req: InternalRequest,
  ): Promise<HttpResponse<T>> => {
    const urlString = typeof req.url === "string" ? req.url : req.url.getURL();

    if (req.signal?.aborted) {
      throw new Error("Request aborted by user");
    }

    req.meta = req.meta || {};
    req.meta.timings = req.meta.timings || {};

    const startNetwork = this.config.trackMetrics
      ? process.hrtime.bigint()
      : null;

    const rawResponse = await this.executor.execute(
      req.method,
      urlString,
      req.headers,
      req.body,
      req.signal,
    );

    if (this.config.trackMetrics && startNetwork !== null) {
      req.meta.timings.networkMs =
        Number(process.hrtime.bigint() - startNetwork) / 1_000_000;
    }

    return {
      status: rawResponse.status,
      headers: rawResponse.headers,
      body: req.method === "HEAD" ? (undefined as any) : rawResponse.body,
      url: rawResponse.url,
    };
  };

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
    return new HyperCore({
      ...this.config,
      ...options,
      network: {
        ...this.config.network,
        ...options.network,
      },
    });
  }

  public create(options: Partial<HttpClientOptions>): HyperCore {
    return this.extend(options);
  }

  public async stream(
    req: RequestInterface | string,
  ): Promise<StreamResponse<Readable>> {
    const url = typeof req === "string" ? req : req.getURL();
    const signal =
      typeof req !== "string"
        ? (req.getSignal?.() ?? (req as any).signal)
        : undefined;
    const headers = {
      ...this.defaultHeaders,
      ...(typeof req !== "string" ? req.getHeaders?.() : {}),
    };

    const rawResponse = await this.executor.execute(
      "GET",
      url,
      headers,
      undefined,
      signal,
    );

    return {
      status: rawResponse.status,
      headers: rawResponse.headers,
      body: rawResponse.body,
      url: rawResponse.url,
    };
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
      const anyAgent = this.agent as any;
      if (typeof anyAgent.destroy === "function") {
        await anyAgent.destroy();
      } else if (typeof anyAgent.close === "function") {
        await anyAgent.close();
      }
    } catch (error) {
      if (this.config.verbose) {
        console.warn("[HyperCore] destroy failed:", error);
      }
    }
  }
}
