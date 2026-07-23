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
import { mapResponseFast, mapStreamFast, recycleResponse } from "../utils/response.js";
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

/**
 * @ru Высокопроизводительный семафор на базе кольцевого буфера.
 * Гарантирует отсутствие аллокаций массивов в steady-state режиме.
 * @en High-performance semaphore backed by a ring buffer.
 * Guarantees zero array allocations in steady state.
 */
class Semaphore {
  private current = 0;
  private readonly max: number;

  private queue: Array<(() => void) | undefined>;
  private capacity: number;
  private head = 0;
  private tail = 0;
  private size = 0;

  constructor(max: number, initialCapacity = 1024) {
    this.max = max;
    this.capacity = initialCapacity;
    const arr: Array<(() => void) | undefined> = [];
    arr.length = initialCapacity;
    this.queue = arr;
  }

  /**
   * @ru Пытается захватить слот без ожидания.
   * @en Attempts to acquire a slot without waiting.
   * @returns true if the slot was acquired.
   */
  tryAcquire(): boolean {
    if (this.current < this.max) {
      this.current++;
      return true;
    }
    return false;
  }

  /**
   * @ru Захватывает слот, ожидая при необходимости.
   * @en Acquires a slot, waiting if necessary.
   * @returns Promise that resolves when the slot is acquired.
   */
  acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      if (this.size === this.capacity) {
        this.grow();
      }

      this.queue[this.tail] = resolve;
      this.tail = (this.tail + 1) % this.capacity;
      this.size++;
    });
  }

  /**
   * @ru Освобождает слот и запускает ожидающий из очереди.
   * @en Releases a slot and wakes the next waiter in the queue.
   */
  release(): void {
    if (this.size > 0) {
      const next = this.queue[this.head]!;
      this.queue[this.head] = undefined;
      this.head = (this.head + 1) % this.capacity;
      this.size--;
      next();
    } else {
      this.current--;
    }
  }

  /**
   * @ru Удваивает емкость буфера при переполнении.
   * @en Doubles buffer capacity on overflow.
   */
  private grow(): void {
    const oldCapacity = this.capacity;
    const newCapacity = oldCapacity * 2;

    const newQueue: Array<(() => void) | undefined> = [];
    newQueue.length = newCapacity;

    for (let i = 0; i < this.size; i++) {
      newQueue[i] = this.queue[(this.head + i) % oldCapacity];
    }

    this.queue = newQueue;
    this.capacity = newCapacity;
    this.head = 0;
    this.tail = this.size;
  }
}

/**
 * @ru Основной класс HTTP-клиента Hyperttp. Управляет транспортом, плагинами, повторными попытками и пулом запросов.
 * @en Core Hyperttp HTTP client class. Manages transport, plugins, retries, and request pooling.
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

  private readonly _cachedMaxRetries: number;
  private readonly _cachedRetryOpts: {
    maxRetries?: number;
    [k: string]: unknown;
  };

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
    this.semaphore =
      maxConcurrent != null && maxConcurrent > 0 ? new Semaphore(maxConcurrent) : null;

    this._cachedRetryOpts = this.config.retry ?? {};
    this._cachedMaxRetries = this._cachedRetryOpts.maxRetries ?? 0;

    this.pluginCtx = { config: this.config, core: this };
  }

  /**
   * @ru Возвращает имя текущего транспорта.
   * @en Returns the name of the current transport.
   * @returns Transport constructor name.
   */
  public async getTransportName(): Promise<string> {
    const t = this.transportManager.transport ?? (await this.transportManager.get());
    return t.constructor.name;
  }

  /**
   * @ru Основной метод отправки запроса через транспорт с поддержкой плагинов и повторных попыток.
   * @en Core request dispatch method through transport with plugin and retry support.
   * @param req - The internal request to dispatch.
   * @returns Promise resolving to the HTTP response.
   */
  public async dispatch<T = unknown>(req: InternalRequest): Promise<HttpResponse<T>> {
    const retryOpts = this._cachedRetryOpts;
    const maxRetries = this._cachedMaxRetries;

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

        let acquired = false;
        if (this.semaphore) {
          acquired = this.semaphore.tryAcquire();
          if (!acquired) await this.semaphore.acquire();
          acquired = true;
        }

        if (req.signal?.aborted) {
          throw req.signal.reason ?? new DOMException("Aborted", "AbortError");
        }

        let rawResponse: TransportResponse;
        const meta = req.meta as {
          responseType?: ResponseType;
          timings?: { networkMs?: number };
        };
        const shouldTrackTimings = !!meta.timings;
        const networkStart = shouldTrackTimings ? performance.now() : 0;
        try {
          rawResponse = await transport.execute(req as TransportArgs);
        } finally {
          if (acquired) this.semaphore?.release();
        }
        if (shouldTrackTimings) {
          meta.timings!.networkMs = performance.now() - networkStart;
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
          const syncResult = executeResponsePipeline(
            this.pipelines.responseMutators,
            this.pipelines.responseSideEffects,
            response as HttpResponse,
            req,
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
        if (
          error instanceof Error &&
          (error.name === "AbortError" || error.name === "TimeoutError")
        ) {
          if (req.signal && (req.signal as any).isTimeout) {
            const timeout = this.config.network?.timeout ?? 0;
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
   * @ru Регистрирует плагин с сортировкой по приоритету. Пропускает отключённые плагины.
   * @en Registers a plugin sorted by priority. Skips disabled plugins.
   * @param plugin - The plugin instance to register.
   * @returns This instance for chaining.
   */
  public use(plugin: HyperPlugin): this {
    const isEnabled = plugin.enabled ? plugin.enabled(this.config) : true;
    if (!isEnabled) return this;

    plugin.setup?.(this.pluginCtx);
    const priority = (plugin as { priority?: number }).priority ?? 0;

    const hook = { name: plugin.name, priority, run: null as any };

    if (plugin.onRequest) {
      insertHookSorted(this.pipelines.request, {
        name: hook.name,
        priority: hook.priority,
        run: plugin.onRequest,
      });
      this.hasRequestPlugins = true;
    }
    if (plugin.onResponse) {
      const target =
        plugin.mode === "background"
          ? this.pipelines.responseSideEffects
          : this.pipelines.responseMutators;
      insertHookSorted(target, {
        name: hook.name,
        priority: hook.priority,
        run: plugin.onResponse,
      });
      this.hasResponsePlugins = true;
    }
    if (plugin.onResponseData) {
      insertHookSorted(this.pipelines.responseData, {
        name: hook.name,
        priority: hook.priority,
        run: plugin.onResponseData,
      });
      this.hasResponseDataPlugins = true;
    }
    if (plugin.onError) {
      insertHookSorted(this.pipelines.error, {
        name: hook.name,
        priority: hook.priority,
        run: plugin.onError,
      });
      this.hasErrorPlugins = true;
    }
    return this;
  }

  /**
   * @ru Выполняет GET-запрос. Использует быстрый путь для простых строковых URL без плагинов/повторов.
   * @en Performs a GET request. Uses a fast path for bare string URLs without plugins/retries.
   * @param req - URL string or RequestInterface.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to the HTTP response.
   */
  public get<T = unknown>(req: RequestInterface | string, signal?: AbortSignal) {
    if (
      typeof req === "string" &&
      req !== "" &&
      !signal &&
      !this.hasRequestPlugins &&
      !this.hasResponsePlugins &&
      !this.hasResponseDataPlugins &&
      !this.hasErrorPlugins &&
      this._cachedMaxRetries === 0
    ) {
      return this.fastGet<T>(req);
    }
    return this.dispatch<T>(this.acquireReq("GET", req, undefined, signal));
  }

  private async fastGet<T>(url: string): Promise<HttpResponse<T>> {
    const resolvedUrl = this.requestBuilder.resolveUrl(url, this.config.baseURL);

    let acquired = false;
    if (this.semaphore) {
      acquired = this.semaphore.tryAcquire();
      if (!acquired) {
        await this.semaphore.acquire();
        acquired = true;
      }
    }

    const transport =
      this.transportManager.transport ??
      this.transportManager.getSync() ??
      (await this.transportReady);

    try {
      if (typeof (transport as any).fastRequest === "function") {
        return (await (transport as any).fastRequest(
          resolvedUrl,
          "GET",
          this.defaultHeaders,
        )) as HttpResponse<T>;
      }

      const raw = await transport.execute({
        method: "GET",
        url: resolvedUrl,
        headers: this.defaultHeaders as Record<string, string>,
        body: undefined,
        signal: undefined,
        stealth: this.config.network?.stealth,
      } as TransportArgs);

      return mapResponseFast(raw) as HttpResponse<T>;
    } finally {
      if (acquired) this.semaphore?.release();
    }
  }

  /**
   * @ru Выполняет POST-запрос.
   * @en Performs a POST request.
   * @param req - URL string or RequestInterface.
   * @param body - Optional request body.
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
   * @ru Выполняет PUT-запрос.
   * @en Performs a PUT request.
   * @param req - URL string or RequestInterface.
   * @param body - Optional request body.
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
   * @ru Выполняет PATCH-запрос.
   * @en Performs a PATCH request.
   * @param req - URL string or RequestInterface.
   * @param body - Optional request body.
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
   * @param req - URL string or RequestInterface.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to the HTTP response.
   */
  public delete<T = unknown>(req: RequestInterface | string, signal?: AbortSignal) {
    return this.dispatch<T>(this.acquireReq("DELETE", req, undefined, signal));
  }

  /**
   * @ru Выполняет OPTIONS-запрос.
   * @en Performs an OPTIONS request.
   * @param req - URL string or RequestInterface.
   * @param body - Optional request body.
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
   * @ru Выполняет HEAD-запрос.
   * @en Performs a HEAD request.
   * @param req - URL string or RequestInterface.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to the HTTP response with null body.
   */
  public head(req: RequestInterface | string, signal?: AbortSignal) {
    return this.dispatch<null>(this.acquireReq("HEAD", req, undefined, signal));
  }

  /**
   * @ru Выполняет GET-запрос и возвращает стриминг-ответ.
   * @en Performs a GET request and returns a streaming response.
   * @param req - URL string or RequestInterface.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to a StreamResponse.
   */
  public stream(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<StreamResponse<unknown>> {
    return this.dispatch(this.acquireReq("GET", req, undefined, signal)) as Promise<
      StreamResponse<unknown>
    >;
  }

  /**
   * @ru Выполняет POST-запрос и возвращает стриминг-ответ.
   * @en Performs a POST request and returns a streaming response.
   * @param req - URL string or RequestInterface.
   * @param body - Optional request body.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to a StreamResponse.
   */
  public postStream<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): Promise<StreamResponse<T>> {
    return this.dispatch(this.acquireReq("POST", req, body, signal)) as Promise<StreamResponse<T>>;
  }

  /**
   * @ru Создаёт новый экземпляр HyperCore с расширенной/переопределённой конфигурацией.
   * @en Creates a new HyperCore instance with extended/overridden configuration.
   * @param options - Partial configuration overrides.
   * @returns A new HyperCore instance.
   */
  public extend(options: Partial<HttpClientOptions>): HyperCore {
    const nextConfig = { ...this.config };
    for (const key in options) {
      if (Object.prototype.hasOwnProperty.call(options, key)) {
        if (key === "network" && options.network) {
          nextConfig.network = {
            ...this.config.network,
            ...options.network,
            stealth:
              options.network.stealth || this.config.network?.stealth
                ? {
                    ...this.config.network?.stealth,
                    ...options.network.stealth,
                  }
                : undefined,
          };
        } else {
          (nextConfig as any)[key] = (options as any)[key];
        }
      }
    }
    return new HyperCore(nextConfig, this.transportManager.transport ?? undefined);
  }

  /**
   * @ru Алиас для extend().
   * @en Alias for extend().
   * @param options - Partial configuration overrides.
   * @returns A new HyperCore instance.
   */
  public create(options: Partial<HttpClientOptions>): HyperCore {
    return this.extend(options);
  }

  /**
   * @ru Завершает работу клиента и освобождает ресурсы транспорта.
   * @en Shuts down the client and releases transport resources.
   * @param graceful - If true, waits for active requests to complete.
   * @returns Promise that resolves when shutdown is complete.
   */
  public destroy(graceful = true): Promise<void> {
    return this.transportManager.destroy(graceful);
  }

  /**
   * @ru Выполняет GET-запрос и возвращает тело ответа, разобранное как JSON.
   * @en Performs a GET request and returns the response body parsed as JSON.
   * @param req - URL string or RequestInterface.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to the parsed JSON value.
   */
  public json<T = unknown>(req: RequestInterface | string, signal?: AbortSignal): Promise<T> {
    return this.shortcut(req, signal).then((res) => {
      const out = res.json ? res.json<T>() : Promise.reject(new Error("json() not supported"));
      recycleResponse(res);
      return out;
    });
  }

  /**
   * @ru Выполняет GET-запрос и возвращает тело ответа как строку.
   * @en Performs a GET request and returns the response body as text.
   * @param req - URL string or RequestInterface.
   * @param signal - Optional abort signal.
   * @returns Promise resolving to the response text.
   */
  public text(req: RequestInterface | string, signal?: AbortSignal): Promise<string> {
    return this.shortcut(req, signal).then((res) => {
      const out = res.text ? res.text() : Promise.reject(new Error("text() not supported"));
      recycleResponse(res);
      return out;
    });
  }

  /**
   * @ru Выполняет GET-запрос и сбрасывает тело ответа (без сохранения).
   * @en Performs a GET request and discards the response body.
   * @param req - URL string or RequestInterface.
   * @param signal - Optional abort signal.
   * @returns Promise that resolves when the body is discarded.
   */
  public dump(req: RequestInterface | string, signal?: AbortSignal): Promise<void> {
    return this.shortcut(req, signal).then((res) => {
      const out = res.dump ? res.dump() : Promise.resolve();
      recycleResponse(res);
      return out;
    });
  }

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
            const syncResult = executeResponsePipeline(
              this.pipelines.responseMutators,
              this.pipelines.responseSideEffects,
              recovered as HttpResponse,
              req,
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

  private recycleRequest(req: InternalRequest): void {
    if (this.requestPool.length < MAX_POOL_SIZE) {
      req.method = "GET";
      req.url = "";
      req.headers = this.defaultHeaders;
      req.body = undefined;
      req.signal = undefined;
      req.stealth = undefined;

      const m = req.meta as any;
      if (m) {
        m.responseType = undefined;

        if (typeof m.cleanupSignal === "function") {
          m.cleanupSignal();
          m.cleanupSignal = undefined;
        }

        if (m.timings) {
          m.timings.networkMs = undefined;
        }
      }
      this.requestPool.push(req);
    }
  }

  private shortcut(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<unknown>> {
    const method = typeof req === "string" ? "GET" : (req.method ?? "GET");
    return this.dispatch(this.acquireReq(method, req, undefined, signal));
  }
}
