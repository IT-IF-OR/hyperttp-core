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
import { mapResponseFast, mapStreamFast, mergeHeadersFast } from "../utils/response.js";
import { TransportManager } from "../transports/manager.js";
import {
  createPipelines,
  executeErrorPipeline,
  executeRequestPipeline,
  executeResponsePipeline,
  executeResponseDataPipeline,
  insertHookSorted,
} from "../utils/pipeline.js";
import { normalizeBody, normalizeHeaders, normalizeUrl } from "../utils/normalize.js";

type TransportArgs = Parameters<HyperTransport["execute"]>[0];

/**
 * @ru Глобальный кэш URL для избежания повторного парсинга через `new URL()`.
 * Использует `Object.create(null)` для быстрого доступа без прототипа.
 * @en Global URL cache to avoid repeated parsing via `new URL()`.
 * Uses `Object.create(null)` for fast prototype-less access.
 */
const urlCache: Record<string, string> = Object.create(null);
let urlCacheCount = 0;
const MAX_CACHE_SIZE = 512;

/**
 * @ru Пул переиспользуемых объектов InternalRequest для zero-allocation в горячем пути.
 * @en Pool of reusable InternalRequest objects for zero-allocation in the hot path.
 */
const requestPool: InternalRequest[] = [];
const MAX_POOL_SIZE = 64;

/**
 * @ru Ядро HTTP-клиента Hyperttp. Обеспечивает диспетчеризацию запросов через
 * конвейер плагинов, пулинг объектов запросов и кэширование URL.
 * @en Hyperttp HTTP client core. Provides request dispatching through the
 * plugin pipeline, request object pooling, and URL caching.
 */
export class HyperCore implements IHyperCore {
  public config: HttpClientOptions;
  private readonly transportManager: TransportManager;
  private readonly transportReady: Promise<HyperTransport>;
  private readonly defaultHeaders: Record<string, string | string[]>;
  private readonly pluginCtx: PluginContext;
  private readonly pipelines = createPipelines();

  private hasRequestPlugins = false;
  private hasResponseDataPlugins = false;
  private hasResponsePlugins = false;
  private hasErrorPlugins = false;

  /**
   * @ru Создаёт новый экземпляр ядра HTTP-клиента.
   * @en Creates a new HTTP client core instance.
   * @param config - Client configuration options.
   * @param transport - Optional custom transport implementation.
   */
  constructor(config: HttpClientOptions = defaultConfig, transport?: HyperTransport) {
    this.config = {
      ...defaultConfig,
      ...config,
      network: { ...defaultConfig.network, ...config.network },
    };
    this.transportManager = new TransportManager(this.config, transport);
    this.transportReady = this.transportManager.getSync()
      ? Promise.resolve(this.transportManager.getSync()!)
      : this.transportManager.ensure();

    this.defaultHeaders = normalizeHeaders({
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br",
      "User-Agent": this.config.network?.userAgent ?? "Hyperttp/2.0",
      ...this.config.network?.headers,
    });

    this.pluginCtx = { config: this.config, core: this };
  }

  /**
   * @ru Возвращает имя класса текущего активного транспорта.
   * @en Returns the class name of the currently active transport.
   * @returns Promise resolving to the transport class name.
   */
  public async getTransportName(): Promise<string> {
    const t = this.transportManager.transport ?? (await this.transportManager.get());
    return t.constructor.name;
  }

  /**
   * @ru Отправляет внутренний запрос через полный конвейер обработки:
   * плагины запроса → транспорт → плагины данных ответа → маппинг → плагины ответа.
   * @en Dispatches an internal request through the full processing pipeline:
   * request plugins → transport → response data plugins → mapping → response plugins.
   * @template T - Expected response body type.
   * @param req - The normalized internal request object.
   * @returns Promise resolving to the HTTP response.
   */
  public async dispatch<T = unknown>(req: InternalRequest): Promise<HttpResponse<T>> {
    try {
      if (this.hasRequestPlugins) {
        const shortCircuit = await Promise.resolve(
          executeRequestPipeline(this.pipelines.request, req, this.pluginCtx),
        );
        if (shortCircuit != null) {
          this.recycleRequest(req);
          return shortCircuit as HttpResponse<T>;
        }
      }

      const transport = this.transportManager.getSync() ?? (await this.transportReady);

      const networkStart = performance.now();
      let rawResponse = await transport.execute(req as TransportArgs);
      const networkMs = performance.now() - networkStart;

      const meta = (req.meta ??= {}) as {
        responseType?: string;
        timings?: { networkMs?: number; serializationMs?: number };
      };
      meta.timings = { ...meta.timings, networkMs };

      if (this.hasResponseDataPlugins) {
        rawResponse = await Promise.resolve(
          executeResponseDataPipeline(this.pipelines.responseData, rawResponse, this.pluginCtx),
        );
      }

      const response =
        req.meta?.responseType === "stream"
          ? mapStreamFast(rawResponse)
          : mapResponseFast(rawResponse);

      if (this.hasResponsePlugins) {
        await Promise.resolve(
          executeResponsePipeline(
            this.pipelines.responseMutators,
            this.pipelines.responseSideEffects,
            response as HttpResponse,
            req,
            this.pluginCtx,
            this.config.logger,
          ),
        );
      }

      this.recycleRequest(req);
      return response as HttpResponse<T>;
    } catch (error) {
      this.recycleRequest(req);
      return this.handleDispatchError(error as Error, req);
    }
  }

  /**
   * @ru Регистрирует плагин в экземпляре клиента. Плагины выполняются в порядке приоритета.
   * @en Registers a plugin into the client instance. Plugins are executed in priority order.
   * @param plugin - The plugin instance to register.
   * @returns The current instance for chaining.
   */
  public use(plugin: HyperPlugin): this {
    const isEnabled = plugin.enabled ? plugin.enabled(this.config) : true;
    if (!isEnabled) return this;

    plugin.setup?.(this.pluginCtx);
    const priority = (plugin as { priority?: number }).priority ?? 0;
    const hook = { name: plugin.name, priority };

    if (plugin.onRequest) {
      insertHookSorted(this.pipelines.request, {
        ...hook,
        run: plugin.onRequest,
      });
      this.hasRequestPlugins = true;
    }
    if (plugin.onResponse) {
      const target =
        plugin.mode === "background"
          ? this.pipelines.responseSideEffects
          : this.pipelines.responseMutators;
      insertHookSorted(target, { ...hook, run: plugin.onResponse });
      this.hasResponsePlugins = true;
    }
    if (plugin.onResponseData) {
      insertHookSorted(this.pipelines.responseData, {
        ...hook,
        run: plugin.onResponseData,
      });
      this.hasResponseDataPlugins = true;
    }
    if (plugin.onError) {
      insertHookSorted(this.pipelines.error, { ...hook, run: plugin.onError });
      this.hasErrorPlugins = true;
    }
    return this;
  }

  /**
   * @ru Выполняет GET-запрос.
   * @en Performs a GET request.
   * @template T - Expected response body type.
   * @param req - Request URL or RequestInterface object.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to the HTTP response.
   */
  public get<T = unknown>(req: RequestInterface | string, signal?: AbortSignal) {
    return this.dispatch<T>(this.acquireReq("GET", req, undefined, signal));
  }

  /**
   * @ru Выполняет POST-запрос с телом.
   * @en Performs a POST request with a body.
   * @template T - Expected response body type.
   * @param req - Request URL or RequestInterface object.
   * @param body - Request body data.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to the HTTP response.
   */
  public post<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ) {
    return this.dispatch<T>(this.acquireReq("POST", req, body, signal));
  }

  /**
   * @ru Выполняет PUT-запрос с телом.
   * @en Performs a PUT request with a body.
   * @template T - Expected response body type.
   * @param req - Request URL or RequestInterface object.
   * @param body - Request body data.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to the HTTP response.
   */
  public put<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ) {
    return this.dispatch<T>(this.acquireReq("PUT", req, body, signal));
  }

  /**
   * @ru Выполняет PATCH-запрос с телом.
   * @en Performs a PATCH request with a body.
   * @template T - Expected response body type.
   * @param req - Request URL or RequestInterface object.
   * @param body - Request body data.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to the HTTP response.
   */
  public patch<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ) {
    return this.dispatch<T>(this.acquireReq("PATCH", req, body, signal));
  }

  /**
   * @ru Выполняет DELETE-запрос.
   * @en Performs a DELETE request.
   * @template T - Expected response body type.
   * @param req - Request URL or RequestInterface object.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to the HTTP response.
   */
  public delete<T = unknown>(req: RequestInterface | string, signal?: AbortSignal) {
    return this.dispatch<T>(this.acquireReq("DELETE", req, undefined, signal));
  }

  /**
   * @ru Выполняет OPTIONS-запрос.
   * @en Performs an OPTIONS request.
   * @template T - Expected response body type.
   * @param req - Request URL or RequestInterface object.
   * @param body - Optional request body data.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to the HTTP response.
   */
  public options<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ) {
    return this.dispatch<T>(this.acquireReq("OPTIONS", req, body, signal));
  }

  /**
   * @ru Выполняет HEAD-запрос (без тела ответа).
   * @en Performs a HEAD request (no response body).
   * @param req - Request URL or RequestInterface object.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to the HTTP response with null body.
   */
  public head(req: RequestInterface | string, signal?: AbortSignal) {
    return this.dispatch<null>(this.acquireReq("HEAD", req, undefined, signal));
  }

  /**
   * @ru Инициирует потоковый GET-запрос. Тело ответа возвращается как ReadableStream.
   * @en Initiates a streaming GET request. Response body is returned as a ReadableStream.
   * @param req - Request URL or RequestInterface object.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to the stream response.
   */
  public stream(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<StreamResponse<unknown>> {
    return this.dispatch(this.acquireReq("GET", req, undefined, signal, "stream")) as Promise<
      StreamResponse<unknown>
    >;
  }

  /**
   * @ru Инициирует потоковый POST-запрос с телом. Тело ответа возвращается как ReadableStream.
   * @en Initiates a streaming POST request with a body. Response body is returned as a ReadableStream.
   * @template T - Expected response body type.
   * @param req - Request URL or RequestInterface object.
   * @param body - Request body data.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to the stream response.
   */
  public postStream<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): Promise<StreamResponse<T>> {
    return this.dispatch(this.acquireReq("POST", req, body, signal, "stream")) as Promise<
      StreamResponse<T>
    >;
  }

  /**
   * @ru Создаёт новый экземпляр клиента, объединяя текущую конфигурацию с переданными опциями.
   * @en Creates a new client instance by merging the current configuration with provided options.
   * @param options - Partial configuration options to extend.
   * @returns A new HyperCore instance.
   */
  public extend(options: Partial<HttpClientOptions>): HyperCore {
    return new HyperCore(
      {
        ...this.config,
        ...options,
        network: { ...this.config.network, ...options.network },
      },
      this.transportManager.transport ?? undefined,
    );
  }

  /**
   * @ru Создаёт полностью новый экземпляр клиента на основе переданных опций.
   * @en Creates a completely new client instance based on provided options.
   * @param options - Partial configuration options for the new instance.
   * @returns A new HyperCore instance.
   */
  public create(options: Partial<HttpClientOptions>): HyperCore {
    return this.extend(options);
  }

  /**
   * @ru Завершает работу клиента и освобождает ресурсы (соединения, пулы).
   * @en Shuts down the client and releases resources (connections, pools).
   * @param graceful - If true, waits for active requests to complete before closing.
   * @returns Promise that resolves when shutdown is complete.
   */
  public destroy(graceful = true): Promise<void> {
    return this.transportManager.destroy(graceful);
  }

  /**
   * @ru Выполняет GET-запрос и возвращает распарсенное JSON-тело ответа.
   * @en Performs a GET request and returns the parsed JSON response body.
   * @template T - Expected type of the parsed JSON.
   * @param req - Request URL or RequestInterface object.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to the parsed JSON data.
   */
  public async json<T = unknown>(req: RequestInterface | string, signal?: AbortSignal): Promise<T> {
    return (
      (await this.shortcut(req, signal)).json?.<T>() ??
      Promise.reject(new Error("json() not supported"))
    );
  }

  /**
   * @ru Выполняет GET-запрос и возвращает тело ответа как текст.
   * @en Performs a GET request and returns the response body as text.
   * @param req - Request URL or RequestInterface object.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to the response text.
   */
  public async text(req: RequestInterface | string, signal?: AbortSignal): Promise<string> {
    return (
      (await this.shortcut(req, signal)).text?.() ??
      Promise.reject(new Error("text() not supported"))
    );
  }

  /**
   * @ru Выполняет GET-запрос и немедленно отбрасывает тело ответа для освобождения ресурсов.
   * @en Performs a GET request and immediately discards the response body to free resources.
   * @param req - Request URL or RequestInterface object.
   * @param signal - Optional abort signal.
   * @returns Promise that resolves when the stream is drained.
   */
  public async dump(req: RequestInterface | string, signal?: AbortSignal): Promise<void> {
    await (await this.shortcut(req, signal)).dump?.();
  }

  /**
   * @ru Обрабатывает ошибку диспетчеризации через конвейер плагинов обработки ошибок.
   * @en Handles dispatch errors through the error handling plugin pipeline.
   * @template T - Expected response body type.
   * @param error - The error that occurred.
   * @param req - The original internal request.
   * @returns Promise resolving to a recovered HTTP response, or throws if unrecoverable.
   */
  private async handleDispatchError<T>(
    error: Error,
    req: InternalRequest,
  ): Promise<HttpResponse<T>> {
    if (this.hasErrorPlugins) {
      const recovered = await executeErrorPipeline(
        this.pipelines.error,
        error as HyperttpError,
        req,
        this.pluginCtx,
      );
      if (recovered != null) {
        if (this.hasResponsePlugins) {
          await Promise.resolve(
            executeResponsePipeline(
              this.pipelines.responseMutators,
              this.pipelines.responseSideEffects,
              recovered as HttpResponse,
              req,
              this.pluginCtx,
              this.config.logger,
            ),
          );
        }
        return recovered as HttpResponse<T>;
      }
    }
    throw error;
  }

  /**
   * @ru Создаёт или переиспользует объект InternalRequest из пула, заполняя его поля.
   * @en Creates or reuses an InternalRequest object from the pool, populating its fields.
   * @param method - HTTP method (GET, POST, etc.).
   * @param req - Request URL or RequestInterface object.
   * @param body - Optional request body data.
   * @param signal - Optional abort signal.
   * @param responseType - Optional response type hint ('stream').
   * @returns The populated internal request object.
   */
  private acquireReq(
    method: Method,
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
    responseType?: "stream",
  ): InternalRequest {
    const pooled = requestPool.pop();
    const internalReq = pooled ?? {
      method: "GET" as Method,
      url: "",
      headers: this.defaultHeaders,
      body: undefined,
      signal: undefined,
      meta: undefined,
    };

    if (typeof req === "string") {
      internalReq.method = method;
      internalReq.url = this.resolveUrl(req);
      internalReq.headers = this.defaultHeaders;
      internalReq.body = body !== undefined ? normalizeBody(method, body) : undefined;
      internalReq.signal = signal;
      internalReq.meta = responseType ? { responseType } : undefined;
      return internalReq;
    }

    const rawUrl = normalizeUrl(req);
    if (!rawUrl) throw new Error(`[HyperCore] URL is undefined for ${method}`);

    let finalUrl = urlCache[rawUrl];
    if (!finalUrl) {
      const urlObj = new URL(rawUrl);
      if (req.query) this.appendQueryParams(urlObj, req.query);
      finalUrl = urlObj.href;

      if (urlCacheCount < MAX_CACHE_SIZE) {
        urlCache[rawUrl] = finalUrl;
        urlCacheCount++;
      }
    }

    internalReq.method = method;
    internalReq.url = finalUrl;
    internalReq.headers = req.headers
      ? mergeHeadersFast(this.defaultHeaders, req.headers)
      : this.defaultHeaders;
    internalReq.body = normalizeBody(method, req.body ?? body);
    internalReq.signal = req.signal ?? signal;
    internalReq.meta = responseType
      ? { responseType }
      : req.meta
        ? {
            responseType: (req.meta as { responseType?: "stream" }).responseType,
          }
        : undefined;

    return internalReq;
  }

  /**
   * @ru Возвращает объект запроса в пул для переиспользования, очищая ссылки для GC.
   * @en Returns the request object to the pool for reuse, clearing references for GC.
   * @param req - The internal request object to recycle.
   */
  private recycleRequest(req: InternalRequest): void {
    if (requestPool.length < MAX_POOL_SIZE) {
      req.body = undefined;
      req.signal = undefined;
      req.meta = undefined;
      requestPool.push(req);
    }
  }

  /**
   * @ru Разрешает и кэширует URL, нормализуя его через URL API при необходимости.
   * @en Resolves and caches the URL, normalizing it via the URL API when necessary.
   * @param url - The raw URL string.
   * @returns The resolved and cached URL string.
   */
  private resolveUrl(url: string): string {
    if (!url) throw new Error("[HyperCore] URL is undefined");

    let finalUrl = urlCache[url];
    if (finalUrl) return finalUrl;

    const hasQuery = url.includes("?") || url.endsWith("?");
    const isAbsolute = url.startsWith("http://") || url.startsWith("https://");

    finalUrl = !hasQuery || !isAbsolute ? new URL(url).href : url;

    if (urlCacheCount < MAX_CACHE_SIZE) {
      urlCache[url] = finalUrl;
      urlCacheCount++;
    }
    return finalUrl;
  }

  /**
   * @ru Добавляет query-параметры к объекту URL, поддерживая массивы значений.
   * @en Appends query parameters to the URL object, supporting arrays of values.
   * @param url - The URL object to modify.
   * @param query - Record of query parameter key-value pairs.
   */
  private appendQueryParams(url: URL, query: Record<string, unknown>): void {
    for (const k in query) {
      if (Object.prototype.hasOwnProperty.call(query, k)) {
        const v = query[k];
        if (v == null) continue;
        if (Array.isArray(v)) {
          for (let j = 0; j < v.length; j++) url.searchParams.append(k, String(v[j]));
        } else {
          url.searchParams.set(k, String(v));
        }
      }
    }
  }

  /**
   * @ru Выполняет быстрый запрос с автоматическим определением HTTP-метода.
   * @en Performs a shortcut request with automatic HTTP method detection.
   * @param req - Request URL or RequestInterface object.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to the HTTP response.
   */
  private shortcut(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<unknown>> {
    const method = typeof req === "string" ? "GET" : (req.method ?? "GET");
    return this.dispatch(this.acquireReq(method, req, undefined, signal));
  }
}
