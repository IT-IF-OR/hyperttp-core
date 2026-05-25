import type { Method } from "../types/http.js";
import type { HttpClientOptions } from "../types/options.js";
import type { RequestBodyData, RequestInterface } from "../types/request.js";
import type { StreamResponse } from "../types/stream.js";
import type { HyperTransport } from "../types/transport.js";
import type { HttpResponse, InternalRequest } from "../types/hyper.js";

import { defaultConfig } from "../defaultConfig.js";
import { HyperPlugin, PluginContext } from "../types/plugins.js";

type TransportArgs = Parameters<HyperTransport["execute"]>[0];
type TransportResponse = Awaited<ReturnType<HyperTransport["execute"]>>;

/**
 * @private
 * Теперь функция полностью дженериковая. Какой тип пришел — такой и ушел.
 */
const cloneBodyFast = <T>(body: T): T => {
  if (typeof body !== "object" || body === null) return body;
  try {
    return structuredClone(body);
  } catch {
    try {
      return JSON.parse(JSON.stringify(body)) as T;
    } catch {
      return { ...body };
    }
  }
};

function responseCloneHandler<T>(this: HttpResponse<T>): HttpResponse<T> {
  return {
    status: this.status,
    headers: { ...this.headers },
    body: cloneBodyFast(this.body),
    url: this.url,
    clone: responseCloneHandler,
  };
}

/**
 * Принимает сырой ответ с телом `unknown` и возвращает плоский объект.
 */
const mapResponseFast = (rawResponse: TransportResponse) => ({
  status: rawResponse.status,
  headers: rawResponse.headers,
  body: rawResponse.body,
  url: rawResponse.url ?? "",
  clone: responseCloneHandler,
});

const mapStreamFast = (
  rawResponse: TransportResponse,
): StreamResponse<unknown> => ({
  status: rawResponse.status,
  headers: rawResponse.headers,
  body: rawResponse.body,
  url: rawResponse.url ?? "",
});

const mergeHeadersFast = (
  base: Record<string, string | string[]>,
  override?: Record<string, string | string[]>,
): Record<string, string | string[]> => {
  if (!override || Object.keys(override).length === 0) return base;
  return { ...base, ...override };
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
      this.transportPromise = Promise.resolve(transport);
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
    return (
      this.transportPromise ||
      (this.transportPromise = this.createTransport().then((t) => {
        this.transport = t;
        return t;
      }))
    );
  }

  public dispatch = <T = unknown>(
    req: InternalRequest,
  ): Promise<HttpResponse<T>> => {
    if (req.signal?.aborted) {
      return Promise.reject(new Error("Request aborted by user"));
    }

    if (this.transport) {
      return this.transport
        .execute(req as TransportArgs)
        .then(mapResponseFast) as unknown as Promise<HttpResponse<T>>;
    }

    return this.ensureTransport()
      .then((transport) => transport.execute(req as TransportArgs))
      .then(mapResponseFast) as unknown as Promise<HttpResponse<T>>;
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

  public stream(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<StreamResponse<unknown>> {
    let url: string;
    let reqHeaders: Record<string, string> | undefined;

    if (typeof req === "string") {
      url = req;
    } else {
      url = req.url;
      signal = req.signal ?? signal;
      reqHeaders = req.headers;
    }

    const finalHeaders = mergeHeadersFast(
      this.defaultHeaders,
      reqHeaders,
    ) as Record<string, string>;

    const transportArgs: TransportArgs = {
      method: "GET",
      url,
      headers: finalHeaders,
      signal,
    };

    if (this.transport) {
      return this.transport.execute(transportArgs).then(mapStreamFast);
    }

    return this.ensureTransport()
      .then((transport) => transport.execute(transportArgs))
      .then(mapStreamFast);
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
    let reqHeaders: Record<string, string> | undefined;
    let reqSignal: AbortSignal | undefined = signal;
    let finalBody = body;

    let meta: InternalRequest["meta"] = undefined;

    if (typeof req === "string") {
      url = req;
    } else {
      url = req.url;
      reqHeaders = req.headers;
      reqSignal = req.signal ?? signal;
      finalBody = req.body ?? body;
      meta = req.meta as InternalRequest["meta"];
    }

    return {
      method,
      url,
      headers: mergeHeadersFast(this.defaultHeaders, reqHeaders) as Record<
        string,
        string
      >,
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

  public async destroy(graceful = true): Promise<void> {
    const transport = this.transport;
    if (!transport) return;

    if (graceful && typeof transport.close === "function") {
      await transport.close();
    } else if (typeof transport.destroy === "function") {
      await transport.destroy();
    }
  }
}
