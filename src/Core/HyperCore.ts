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
import { TransportManager } from "../transports/manager.js";
import {
  createPipelines,
  executeErrorPipeline,
  executeRequestPipeline,
  executeResponsePipeline,
  executeResponseDataPipeline,
  insertHookSorted,
} from "../utils/pipeline.js";
import {
  normalizeBody,
  normalizeHeaders,
  normalizeUrl,
} from "../utils/normalize.js";
import {
  decompressBuffer,
  createDecompressStream,
} from "../utils/decompress.js";

type TransportArgs = Parameters<HyperTransport["execute"]>[0];

/**
 * @ru Основной класс HTTP-клиента Hyperttp. Управляет транспортами, плагинами, перехватчиками, повторными попытками и сжатием.
 * @en Core HTTP client class for Hyperttp. Manages transports, plugins, interceptors, retries, and compression.
 */
export class HyperCore implements IHyperCore {
  /** @ru Конфигурация клиента (базовый URL, таймауты, заголовки и т.д.). @en Client configuration (base URL, timeouts, headers, etc.). */
  public config: HttpClientOptions;
  private readonly transportManager: TransportManager;
  private readonly defaultHeaders: Record<string, string | string[]>;
  private readonly pluginCtx: PluginContext;
  private readonly pipelines = createPipelines();

  /**
   * @ru Создаёт экземпляр HyperCore.
   * @en Creates an instance of HyperCore.
   * @param config - Client configuration options.
   * @param transport - Optional custom transport implementation.
   */
  constructor(
    config: HttpClientOptions = defaultConfig,
    transport?: HyperTransport,
  ) {
    this.config = {
      ...defaultConfig,
      ...config,
      network: { ...defaultConfig.network, ...config.network },
    };

    this.transportManager = new TransportManager(this.config, transport);

    this.defaultHeaders = normalizeHeaders({
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br",
      "User-Agent": this.config.network?.userAgent ?? "Hyperttp/2.0",
      ...this.config.network?.headers,
    });

    this.pluginCtx = { config: this.config, core: this };
  }

  private get transport(): HyperTransport | null {
    return this.transportManager.instance;
  }

  private ensureTransport(): Promise<HyperTransport> {
    return this.transportManager.get();
  }

  private async dispatchInternal<T = unknown>(
    req: InternalRequest,
  ): Promise<HttpResponse<T> | StreamResponse<T>> {
    try {
      if (this.pipelines.request.length > 0) {
        const shortCircuit = await executeRequestPipeline(
          this.pipelines.request,
          req,
          this.pluginCtx,
        );
        if (shortCircuit) {
          await this.runResponsePipeline(shortCircuit, req);
          return shortCircuit as HttpResponse<T>;
        }
      }

      const transport = this.transport || (await this.ensureTransport());
      let rawResponse = await transport.execute(req as TransportArgs);

      if (this.pipelines.responseData.length > 0) {
        rawResponse = await executeResponseDataPipeline(
          this.pipelines.responseData,
          rawResponse,
          this.pluginCtx,
        );
      }

      this.applyDecompression(rawResponse);

      const isStream = req.meta?.responseType === "stream";
      const response = isStream
        ? mapStreamFast(rawResponse)
        : mapResponseFast(rawResponse);

      await this.runResponsePipeline(response, req);

      return response as unknown as HttpResponse<T>;
    } catch (error) {
      return this.handleDispatchError(error as Error, req);
    }
  }

  /**
   * @ru Выполняет HTTP-запрос с полным контролем (через объект InternalRequest).
   * @en Performs an HTTP request with full control (via InternalRequest object).
   * @param req - Internal request object.
   * @returns Promise with the HTTP response.
   */
  public async dispatch<T = unknown>(
    req: InternalRequest,
  ): Promise<HttpResponse<T>> {
    return this.dispatchInternal<T>(req) as Promise<HttpResponse<T>>;
  }

  /**
   * @ru Регистрирует плагин для расширения функциональности клиента.
   * @en Registers a plugin to extend client functionality.
   * @param plugin - Plugin instance.
   * @returns This instance for chaining.
   */
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
      const targetPipeline =
        plugin.mode === "background"
          ? this.pipelines.responseSideEffects
          : this.pipelines.responseMutators;
      insertHookSorted(targetPipeline, {
        name: plugin.name,
        priority,
        run: plugin.onResponse,
      });
    }

    if (plugin.onResponseData) {
      insertHookSorted(this.pipelines.responseData, {
        name: plugin.name,
        priority,
        run: plugin.onResponseData,
      });
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

  /**
   * @ru Выполняет GET-запрос и возвращает ответ в виде потока (StreamResponse).
   * @en Performs a GET request and returns the response as a stream (StreamResponse).
   * @param req - Request URL or RequestInterface object.
   * @param signal - Optional abort signal.
   * @returns Promise with the stream response.
   */
  public async stream(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<StreamResponse<unknown>> {
    const internalReq = this.buildInternalRequest(
      "GET",
      req,
      undefined,
      signal,
    );
    internalReq.meta = { ...internalReq.meta, responseType: "stream" };
    return this.dispatchInternal(internalReq) as Promise<
      StreamResponse<unknown>
    >;
  }

  /**
   * @ru Выполняет POST-запрос и возвращает ответ в виде потока (StreamResponse).
   * @en Performs a POST request and returns the response as a stream (StreamResponse).
   * @param req - Request URL or RequestInterface object.
   * @param body - Request body data.
   * @param signal - Optional abort signal.
   * @returns Promise with the stream response.
   */
  public async postStream<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): Promise<StreamResponse<T>> {
    const internalReq = this.buildInternalRequest("POST", req, body, signal);
    internalReq.meta = { ...internalReq.meta, responseType: "stream" };
    return this.dispatchInternal(internalReq) as Promise<StreamResponse<T>>;
  }

  /**
   * @ru Выполняет GET-запрос.
   * @en Performs a GET request.
   * @param req - Request URL or RequestInterface object.
   * @param signal - Optional abort signal.
   * @returns Promise with the HTTP response.
   */
  public get<T = unknown>(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.dispatch<T>(
      this.buildInternalRequest("GET", req, undefined, signal),
    );
  }

  /**
   * @ru Выполняет POST-запрос.
   * @en Performs a POST request.
   * @param req - Request URL or RequestInterface object.
   * @param body - Request body data.
   * @param signal - Optional abort signal.
   * @returns Promise with the HTTP response.
   */
  public post<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.dispatch<T>(
      this.buildInternalRequest("POST", req, body, signal),
    );
  }

  /**
   * @ru Выполняет PUT-запрос.
   * @en Performs a PUT request.
   * @param req - Request URL or RequestInterface object.
   * @param body - Request body data.
   * @param signal - Optional abort signal.
   * @returns Promise with the HTTP response.
   */
  public put<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.dispatch<T>(
      this.buildInternalRequest("PUT", req, body, signal),
    );
  }

  /**
   * @ru Выполняет PATCH-запрос.
   * @en Performs a PATCH request.
   * @param req - Request URL or RequestInterface object.
   * @param body - Request body data.
   * @param signal - Optional abort signal.
   * @returns Promise with the HTTP response.
   */
  public patch<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.dispatch<T>(
      this.buildInternalRequest("PATCH", req, body, signal),
    );
  }

  /**
   * @ru Выполняет DELETE-запрос.
   * @en Performs a DELETE request.
   * @param req - Request URL or RequestInterface object.
   * @param signal - Optional abort signal.
   * @returns Promise with the HTTP response.
   */
  public delete<T = unknown>(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.dispatch<T>(
      this.buildInternalRequest("DELETE", req, undefined, signal),
    );
  }

  /**
   * @ru Выполняет OPTIONS-запрос.
   * @en Performs an OPTIONS request.
   * @param req - Request URL or RequestInterface object.
   * @param body - Optional request body data.
   * @param signal - Optional abort signal.
   * @returns Promise with the HTTP response.
   */
  public options<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.dispatch<T>(
      this.buildInternalRequest("OPTIONS", req, body, signal),
    );
  }

  /**
   * @ru Выполняет HEAD-запрос.
   * @en Performs a HEAD request.
   * @param req - Request URL or RequestInterface object.
   * @param signal - Optional abort signal.
   * @returns Promise with the HTTP response (body is always null).
   */
  public head(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<null>> {
    return this.dispatch<null>(
      this.buildInternalRequest("HEAD", req, undefined, signal),
    );
  }

  /**
   * @ru Создаёт новый экземпляр HyperCore с расширенной конфигурацией (поверх текущей).
   * @en Creates a new HyperCore instance with extended configuration (on top of current).
   * @param options - Additional configuration options.
   * @returns New HyperCore instance.
   */
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

  /**
   * @ru Алиас для extend(). Создаёт новый экземпляр HyperCore.
   * @en Alias for extend(). Creates a new HyperCore instance.
   * @param options - Configuration options.
   * @returns New HyperCore instance.
   */
  public create(options: Partial<HttpClientOptions>): HyperCore {
    return this.extend(options);
  }

  /**
   * @ru Уничтожает клиент, закрывая соединения и очищая ресурсы.
   * @en Destroys the client, closing connections and cleaning up resources.
   * @param graceful - If true, attempts graceful shutdown (default: true).
   * @returns Promise that resolves when destruction is complete.
   */
  public async destroy(graceful = true): Promise<void> {
    await this.transportManager.destroy(graceful);
  }

  /**
   * @ru Выполняет запрос и сразу возвращает распарсенный JSON (сокращённый метод).
   * @en Performs a request and immediately returns parsed JSON (shortcut method).
   * @param req - Request URL or RequestInterface object.
   * @param signal - Optional abort signal.
   * @returns Promise with the parsed JSON value.
   * @throws If the response does not contain a json() method.
   */
  public async json<T = unknown>(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<T> {
    const res = await this.dispatchShortcut(req, signal);
    if (!res.json)
      throw new Error(
        "[HyperCore] Method 'json()' is missing on response object.",
      );
    return res.json<T>();
  }

  /**
   * @ru Выполняет запрос и возвращает тело как строку (сокращённый метод).
   * @en Performs a request and returns the body as a string (shortcut method).
   * @param req - Request URL or RequestInterface object.
   * @param signal - Optional abort signal.
   * @returns Promise with the response text.
   * @throws If the response does not contain a text() method.
   */
  public async text(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<string> {
    const res = await this.dispatchShortcut(req, signal);
    if (!res.text)
      throw new Error(
        "[HyperCore] Method 'text()' is missing on response object.",
      );
    return res.text();
  }

  /**
   * @ru Выполняет запрос и немедленно отменяет (сбрасывает) тело ответа без чтения.
   * @en Performs a request and immediately discards the response body without reading.
   * @param req - Request URL or RequestInterface object.
   * @param signal - Optional abort signal.
   * @returns Promise that resolves after dumping the response.
   * @throws If the response does not contain a dump() method.
   */
  public async dump(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await this.dispatchShortcut(req, signal);
    if (!res.dump)
      throw new Error(
        "[HyperCore] Method 'dump()' is missing on response object.",
      );
    await res.dump();
  }

  private async runResponsePipeline(
    response: HttpResponse | StreamResponse<unknown>,
    req: InternalRequest,
  ): Promise<void> {
    const hasMutators = this.pipelines.responseMutators.length > 0;
    const hasSideEffects = this.pipelines.responseSideEffects.length > 0;

    if (hasMutators || hasSideEffects) {
      await executeResponsePipeline(
        this.pipelines.responseMutators,
        this.pipelines.responseSideEffects,
        response as HttpResponse,
        req,
        this.pluginCtx,
        this.config.logger,
      );
    }
  }

  private async handleDispatchError<T>(
    error: Error,
    req: InternalRequest,
  ): Promise<HttpResponse<T> | StreamResponse<T>> {
    if (this.pipelines.error.length > 0) {
      const recovered = await executeErrorPipeline(
        this.pipelines.error,
        error as HyperttpError,
        req,
        this.pluginCtx,
      );
      if (recovered) {
        await this.runResponsePipeline(recovered, req);
        return recovered as HttpResponse<T>;
      }
    }
    throw error;
  }

  private applyDecompression(rawResponse: Record<string, any>): void {
    if (!rawResponse.body) return;

    const encodingHeader =
      rawResponse.headers?.["content-encoding"] ??
      rawResponse.headers?.["Content-Encoding"];
    if (!encodingHeader) return;

    const contentEncoding =
      typeof encodingHeader === "string"
        ? encodingHeader
        : Array.isArray(encodingHeader)
          ? encodingHeader[0]
          : undefined;

    if (!contentEncoding) return;

    if (rawResponse.body instanceof Uint8Array) {
      rawResponse.body = decompressBuffer(rawResponse.body, contentEncoding);
    } else {
      rawResponse.body = createDecompressStream(
        rawResponse.body as ReadableStream<Uint8Array>,
        contentEncoding,
      );
    }
  }

  private buildInternalRequest(
    method: Method,
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): InternalRequest {
    const isStr = typeof req === "string";
    const rawUrl = normalizeUrl(req);

    if (!rawUrl) {
      throw new Error(
        `[HyperCore] Critical failure: 'url' resolved to undefined for ${method}.`,
      );
    }

    const urlObj = new URL(rawUrl);
    const castedReq = isStr
      ? undefined
      : (req as unknown as Record<string, unknown>);

    if (castedReq?.query) {
      this.appendQueryParams(
        urlObj,
        castedReq.query as Record<string, unknown>,
      );
    }

    const context = {
      method,
      url: urlObj.href,
      origin: urlObj.origin,
      path: urlObj.pathname + urlObj.search,
    };

    if (isStr) {
      return {
        ...context,
        headers: { ...this.defaultHeaders },
        body,
        signal,
        meta: {},
      } as unknown as InternalRequest;
    }

    const rawHeaders = (req.headers ?? castedReq!._headers) as
      | Record<string, string | string[]>
      | undefined;
    const headers = rawHeaders
      ? normalizeHeaders(mergeHeadersFast(this.defaultHeaders, rawHeaders))
      : { ...this.defaultHeaders };

    const rawBody =
      castedReq!.body ?? castedReq!.bodyData ?? castedReq!._bodyData ?? body;
    const computedBody = normalizeBody(method, rawBody);

    const computedSignal =
      req.signal ?? (castedReq!._signal as AbortSignal | undefined) ?? signal;
    const meta = (req.meta ??
      castedReq!._meta ??
      {}) as InternalRequest["meta"];

    return this.createInternalRequestObject(castedReq!, {
      ...context,
      headers,
      body: computedBody,
      signal: computedSignal,
      meta,
    });
  }

  private createInternalRequestObject(
    sourceReq: Record<string, unknown>,
    overrides: Record<string, unknown>,
  ): InternalRequest {
    const proto = Object.getPrototypeOf(sourceReq);
    const target =
      proto && proto !== Object.prototype ? Object.create(proto) : {};

    for (const key in sourceReq) {
      if (Object.prototype.hasOwnProperty.call(sourceReq, key)) {
        target[key] = sourceReq[key];
      }
    }

    for (const key in overrides) {
      if (Object.prototype.hasOwnProperty.call(overrides, key)) {
        target[key] = overrides[key];
      }
    }

    return target as InternalRequest;
  }

  private appendQueryParams(url: URL, query?: Record<string, unknown>): void {
    if (!query) return;

    for (const key in query) {
      if (Object.prototype.hasOwnProperty.call(query, key)) {
        const value = query[key];
        if (value === undefined || value === null) continue;

        if (Array.isArray(value)) {
          const len = value.length;
          for (let i = 0; i < len; i++) {
            const item = value[i];
            if (item === undefined || item === null) continue;
            url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
  }

  private async dispatchShortcut(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<unknown>> {
    const method =
      typeof req === "string"
        ? "GET"
        : (((req as unknown as Record<string, unknown>).method as
            | Method
            | undefined) ?? "GET");
    return this.dispatch<unknown>(
      this.buildInternalRequest(method, req, undefined, signal),
    );
  }
}
