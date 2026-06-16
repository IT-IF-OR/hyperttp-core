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
  ResponseType,
  TransportResponse,
} from "@hyperttp/types";
import { defaultConfig } from "../defaultConfig.js";
import { mapResponseFast, mapStreamFast } from "../utils/response.js";
import { TransportManager } from "../transports/manager.js";
import {
  createPipelines,
  executeErrorPipeline,
  executeRequestPipeline,
  executeResponsePipeline,
  executeResponseDataPipeline,
  insertHookSorted,
} from "../utils/pipeline.js";
import { normalizeHeaders, normalizeBodyForTransport } from "../utils/normalize.js";
import { calcDelay, shouldRetry, drainBody } from "../utils/retryUtils.js";
import { TimeoutError } from "../utils/errors.js";
import { RequestBuilder } from "./RequestBuilder.js";

type TransportArgs = Parameters<HyperTransport["execute"]>[0];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const MAX_POOL_SIZE = 64;

class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(private max: number) {}

  acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.current--;
    }
  }
}

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
  private readonly requestBuilder = new RequestBuilder();
  private readonly requestPool: InternalRequest[] = [];

  private semaphore: Semaphore | null = null;
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
      network: {
        ...defaultConfig.network,
        ...config.network,
        stealth:
          config.network?.stealth || defaultConfig.network?.stealth
            ? Object.assign({}, defaultConfig.network?.stealth, config.network?.stealth)
            : undefined,
      },
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

    const maxConcurrent = this.config.network?.maxConcurrent;
    this.semaphore = maxConcurrent != null && maxConcurrent > 0 ? new Semaphore(maxConcurrent) : null;

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
    const retryOpts = this.config.retry ?? {};
    const maxRetries = retryOpts.maxRetries ?? 0;

    for (let attempt = 0; ; attempt++) {
      try {
        if (this.hasRequestPlugins) {
          const syncResult = executeRequestPipeline(this.pipelines.request, req, this.pluginCtx);
          const shortCircuit = syncResult instanceof Promise ? await syncResult : syncResult;

          if (shortCircuit != null) {
            this.recycleRequest(req);
            return shortCircuit as HttpResponse<T>;
          }
        }

        if (req.body != null) {
          req.body = normalizeBodyForTransport(req.body, req.headers);
        }

        const transport =
          this.transportManager.transport ??
          this.transportManager.getSync() ??
          (await this.transportReady);

        if (this.semaphore) await this.semaphore.acquire();
        let rawResponse: TransportResponse;
        const networkStart = performance.now();
        try {
          rawResponse = await transport.execute(req as TransportArgs);
        } finally {
          this.semaphore?.release();
        }
        const networkMs = performance.now() - networkStart;

        const meta = req.meta as {
          responseType?: ResponseType;
          timings?: { networkMs?: number };
        };
        if (meta.timings) {
          meta.timings.networkMs = networkMs;
        }

        if (attempt < maxRetries && shouldRetry(rawResponse.status, retryOpts)) {
          await drainBody(rawResponse.body);
          await sleep(calcDelay(attempt, retryOpts));
          continue;
        }

        if (this.hasResponseDataPlugins) {
          const syncResult = executeResponseDataPipeline(
            this.pipelines.responseData,
            rawResponse,
            this.pluginCtx,
          );
          rawResponse = syncResult instanceof Promise ? await syncResult : syncResult;
        }

        const response =
          meta.responseType === "stream"
            ? mapStreamFast(rawResponse)
            : mapResponseFast(rawResponse);

        if (this.hasResponsePlugins) {
          const reqForPipeline =
            this.pipelines.responseSideEffects.length > 0
              ? {
                  ...req,
                  meta: {
                    ...meta,
                    timings: meta.timings ? { ...meta.timings } : undefined,
                  },
                }
              : req;

          const syncResult = executeResponsePipeline(
            this.pipelines.responseMutators,
            this.pipelines.responseSideEffects,
            response as HttpResponse,
            reqForPipeline,
            this.pluginCtx,
            this.config.logger,
          );
          if (syncResult instanceof Promise) {
            await syncResult;
          }
        }

        this.recycleRequest(req);
        return response as HttpResponse<T>;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          const timeout = this.config.network?.timeout;
          if (timeout != null && timeout > 0) {
            return this.handleDispatchError(new TimeoutError(req.url, timeout), req);
          }
          return this.handleDispatchError(error, req);
        }

        if (attempt < maxRetries && !req.signal?.aborted) {
          await sleep(calcDelay(attempt, retryOpts));
          continue;
        }

        return this.handleDispatchError(error as Error, req);
      }
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
        network: {
          ...this.config.network,
          ...options.network,
          stealth:
            options.network?.stealth || this.config.network?.stealth
              ? { ...this.config.network?.stealth, ...options.network?.stealth }
              : undefined,
        },
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
  public json<T = unknown>(req: RequestInterface | string, signal?: AbortSignal): Promise<T> {
    return this.shortcut(req, signal).then((res) => {
      if (res.json) return res.json<T>();
      throw new Error("json() not supported");
    });
  }

  /**
   * @ru Выполняет GET-запрос и возвращает тело ответа как текст.
   * @en Performs a GET request and returns the response body as text.
   * @param req - Request URL or RequestInterface object.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to the response text.
   */
  public text(req: RequestInterface | string, signal?: AbortSignal): Promise<string> {
    return this.shortcut(req, signal).then((res) => {
      if (res.text) return res.text();
      throw new Error("text() not supported");
    });
  }

  /**
   * @ru Выполняет GET-запрос и немедленно отбрасывает тело ответа для освобождения ресурсов.
   * @en Performs a GET request and immediately discards the response body to free resources.
   * @param req - Request URL or RequestInterface object.
   * @param signal - Optional abort signal.
   * @returns Promise that resolves when the stream is drained.
   */
  public dump(req: RequestInterface | string, signal?: AbortSignal): Promise<void> {
    return this.shortcut(req, signal).then((res) => {
      if (res.dump) return res.dump();
    });
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
    try {
      if (this.hasErrorPlugins) {
        const recovered = await executeErrorPipeline(
          this.pipelines.error,
          error as HyperttpError,
          req,
          this.pluginCtx,
        );
        if (recovered != null) {
          if (this.hasResponsePlugins) {
            const meta = req.meta;
            const reqForPipeline =
              this.pipelines.responseSideEffects.length > 0
                ? {
                    ...req,
                    meta: {
                      ...meta,
                      timings: meta?.timings ? { ...meta.timings } : undefined,
                    },
                  }
                : req;

            const syncResult = executeResponsePipeline(
              this.pipelines.responseMutators,
              this.pipelines.responseSideEffects,
              recovered as HttpResponse,
              reqForPipeline,
              this.pluginCtx,
              this.config.logger,
            );
            if (syncResult instanceof Promise) {
              await syncResult;
            }
          }
          return recovered as HttpResponse<T>;
        }
      }
      throw error;
    } finally {
      this.recycleRequest(req);
    }
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
    const pooled = this.requestPool.pop();
    return this.requestBuilder.build(
      method,
      req,
      body,
      signal,
      responseType,
      this.defaultHeaders,
      this.config,
      pooled,
    );
  }

  /**
   * @ru Возвращает объект запроса в пул для переиспользования, очищая ссылки для GC.
   * @en Returns the request object to the pool for reuse, clearing references for GC.
   * @param req - The internal request object to recycle.
   */
  private recycleRequest(req: InternalRequest): void {
    if (this.requestPool.length < MAX_POOL_SIZE) {
      req.method = "GET";
      req.url = "";
      req.headers = this.defaultHeaders;
      req.body = undefined;
      req.signal = undefined;
      req.stealth = undefined;

      const m = req.meta;
      if (m) {
        m.responseType = undefined;
        if (m.timings) {
          for (const key in m.timings) {
            (m.timings as any)[key] = undefined;
          }
        }
      }

      this.requestPool.push(req);
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
