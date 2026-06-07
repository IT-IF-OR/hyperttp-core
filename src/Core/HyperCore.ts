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

interface CachedUrl {
  href: string;
  origin: string;
  path: string;
}

const urlCache = new Map<string, CachedUrl>();

/**
 * @ru Основной класс HTTP-клиента с поддержкой плагинов, потоковой передачи, кэширования URL и гибкой настройки.
 * @en Core HTTP client class with plugin support, streaming, URL caching and flexible configuration.
 * @implements {IHyperCore}
 */
export class HyperCore implements IHyperCore {
  /**
   * @ru Активная конфигурация клиента (объединена с настройками по умолчанию).
   * @en Current client configuration (merged with default settings).
   */
  public config: HttpClientOptions;

  private readonly transportManager: TransportManager;
  private readonly defaultHeaders: Record<string, string | string[]>;
  private readonly pluginCtx: PluginContext;
  private readonly pipelines = createPipelines();

  /**
   * @ru Создаёт экземпляр HyperCore.
   * @en Creates a HyperCore instance.
   * @param config - Client configuration (overrides defaults).
   * @param transport - Optional transport layer (auto‑selected if omitted).
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

  /**
   * @ru Возвращает текущий транспортный экземпляр (или null, если он ещё не инициализирован).
   * @en Returns the current transport instance (or null if not yet initialized).
   */
  private get transport(): HyperTransport | null {
    return this.transportManager.instance;
  }

  public async getTransportName(): Promise<string> {
    const t = await this.ensureTransport();
    return t.constructor.name;
  }

  /**
   * @ru Гарантирует наличие готового к работе транспорта (асинхронная инициализация при необходимости).
   * @en Ensures a ready‑to‑use transport (async initialization if needed).
   * @returns Promise resolving to a transport instance.
   */
  private ensureTransport(): Promise<HyperTransport> {
    return this.transportManager.get();
  }

  /**
   * @ru Внутренний метод диспетчеризации запроса, обрабатывающий как обычные, так и стриминговые ответы.
   * @en Internal request dispatcher handling both regular and streaming responses.
   * @param req - Internal request object.
   * @returns Promise resolving to a response (HttpResponse or StreamResponse).
   */
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

      return response as HttpResponse<T>;
    } catch (error) {
      return this.handleDispatchError(error as Error, req);
    }
  }

  /**
   * @ru Отправляет HTTP-запрос и возвращает обычный (нестриминговый) ответ.
   * @en Sends an HTTP request and returns a regular (non‑streaming) response.
   * @param req - Internal request object.
   * @returns Promise resolving to a typed HTTP response.
   */
  public async dispatch<T = unknown>(
    req: InternalRequest,
  ): Promise<HttpResponse<T>> {
    return this.dispatchInternal<T>(req) as Promise<HttpResponse<T>>;
  }

  /**
   * @ru Регистрирует плагин в клиенте. Плагин может добавлять хуки на различных этапах обработки запроса/ответа.
   * @en Registers a plugin with the client. The plugin can add hooks at various request/response processing stages.
   * @param plugin - Plugin instance to register.
   * @returns This instance for chaining.
   */
  public use(plugin: HyperPlugin): this {
    const isEnabled = plugin.enabled ? plugin.enabled(this.config) : true;
    if (!isEnabled) return this;

    plugin.setup?.(this.pluginCtx);

    const priority = (plugin as { priority?: number }).priority ?? 0;

    if (plugin.onRequest) {
      insertHookSorted(this.pipelines.request, {
        name: plugin.name,
        priority,
        run: plugin.onRequest,
      });
    }

    if (plugin.onResponse) {
      const target =
        plugin.mode === "background"
          ? this.pipelines.responseSideEffects
          : this.pipelines.responseMutators;

      insertHookSorted(target, {
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
   * @ru Выполняет GET-запрос с потоковым ответом.
   * @en Performs a GET request with a streaming response.
   * @param req - Request URL or configuration object.
   * @param signal - Optional AbortSignal to cancel the request.
   * @returns Promise resolving to a StreamResponse.
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
   * @ru Выполняет POST-запрос с потоковым ответом.
   * @en Performs a POST request with a streaming response.
   * @param req - Request URL or configuration object.
   * @param body - Request body data.
   * @param signal - Optional AbortSignal to cancel the request.
   * @returns Promise resolving to a StreamResponse.
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
   * @param req - Request URL or configuration object.
   * @param signal - Optional AbortSignal to cancel the request.
   * @returns Promise resolving to an HttpResponse.
   */
  public get<T = unknown>(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ) {
    return this.dispatch<T>(
      this.buildInternalRequest("GET", req, undefined, signal),
    );
  }

  /**
   * @ru Выполняет POST-запрос.
   * @en Performs a POST request.
   * @param req - Request URL or configuration object.
   * @param body - Request body data.
   * @param signal - Optional AbortSignal to cancel the request.
   * @returns Promise resolving to an HttpResponse.
   */
  public post<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ) {
    return this.dispatch<T>(
      this.buildInternalRequest("POST", req, body, signal),
    );
  }

  /**
   * @ru Выполняет PUT-запрос.
   * @en Performs a PUT request.
   * @param req - Request URL or configuration object.
   * @param body - Request body data.
   * @param signal - Optional AbortSignal to cancel the request.
   * @returns Promise resolving to an HttpResponse.
   */
  public put<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ) {
    return this.dispatch<T>(
      this.buildInternalRequest("PUT", req, body, signal),
    );
  }

  /**
   * @ru Выполняет PATCH-запрос.
   * @en Performs a PATCH request.
   * @param req - Request URL or configuration object.
   * @param body - Request body data.
   * @param signal - Optional AbortSignal to cancel the request.
   * @returns Promise resolving to an HttpResponse.
   */
  public patch<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ) {
    return this.dispatch<T>(
      this.buildInternalRequest("PATCH", req, body, signal),
    );
  }

  /**
   * @ru Выполняет DELETE-запрос.
   * @en Performs a DELETE request.
   * @param req - Request URL or configuration object.
   * @param signal - Optional AbortSignal to cancel the request.
   * @returns Promise resolving to an HttpResponse.
   */
  public delete<T = unknown>(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ) {
    return this.dispatch<T>(
      this.buildInternalRequest("DELETE", req, undefined, signal),
    );
  }

  /**
   * @ru Выполняет OPTIONS-запрос.
   * @en Performs an OPTIONS request.
   * @param req - Request URL or configuration object.
   * @param body - Request body data.
   * @param signal - Optional AbortSignal to cancel the request.
   * @returns Promise resolving to an HttpResponse.
   */
  public options<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ) {
    return this.dispatch<T>(
      this.buildInternalRequest("OPTIONS", req, body, signal),
    );
  }

  /**
   * @ru Выполняет HEAD-запрос.
   * @en Performs a HEAD request.
   * @param req - Request URL or configuration object.
   * @param signal - Optional AbortSignal to cancel the request.
   * @returns Promise resolving to an HttpResponse with null body.
   */
  public head(req: RequestInterface | string, signal?: AbortSignal) {
    return this.dispatch<null>(
      this.buildInternalRequest("HEAD", req, undefined, signal),
    );
  }

  /**
   * @ru Создаёт новый экземпляр HyperCore путём расширения текущей конфигурации.
   * @en Creates a new HyperCore instance by extending the current configuration.
   * @param options - Partial configuration overrides.
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
   * @ru Алиас для {@link extend}. Создаёт новый экземпляр с переопределёнными опциями.
   * @en Alias for {@link extend}. Creates a new instance with overridden options.
   * @param options - Partial configuration overrides.
   * @returns New HyperCore instance.
   */
  public create(options: Partial<HttpClientOptions>): HyperCore {
    return this.extend(options);
  }

  /**
   * @ru Завершает работу клиента: закрывает транспортные соединения.
   * @en Shuts down the client: closes transport connections.
   * @param graceful - If true, attempts graceful shutdown (waiting for pending requests).
   * @returns Promise that resolves when shutdown is complete.
   */
  public async destroy(graceful = true): Promise<void> {
    await this.transportManager.destroy(graceful);
  }

  /**
   * @ru Выполняет запрос и возвращает распарсенный JSON-ответ.
   * @en Performs a request and returns parsed JSON response.
   * @param req - Request URL or configuration object.
   * @param signal - Optional AbortSignal to cancel the request.
   * @returns Promise resolving to the parsed JSON value.
   * @throws If response body cannot be parsed as JSON.
   */
  public async json<T = unknown>(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<T> {
    const res = await this.dispatchShortcut(req, signal);
    return res.json?.<T>() ?? Promise.reject(new Error("json() not supported"));
  }

  /**
   * @ru Выполняет запрос и возвращает ответ в виде текста.
   * @en Performs a request and returns response as text.
   * @param req - Request URL or configuration object.
   * @param signal - Optional AbortSignal to cancel the request.
   * @returns Promise resolving to the response body as string.
   * @throws If response body cannot be read as text.
   */
  public async text(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<string> {
    const res = await this.dispatchShortcut(req, signal);
    return res.text?.() ?? Promise.reject(new Error("text() not supported"));
  }

  /**
   * @ru Выполняет запрос и полностью потребляет тело ответа (без обработки).
   * @en Performs a request and fully consumes the response body (no processing).
   * @param req - Request URL or configuration object.
   * @param signal - Optional AbortSignal to cancel the request.
   * @returns Promise that resolves when response body is drained.
   */
  public async dump(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await this.dispatchShortcut(req, signal);
    await res.dump?.();
  }

  /**
   * @ru Выполняет пайплайн обработки ответа (мутаторы и сайд-эффекты).
   * @en Executes response processing pipeline (mutators and side effects).
   * @param response - Response object (HttpResponse or StreamResponse).
   * @param req - Original internal request.
   */
  private async runResponsePipeline(
    response: HttpResponse | StreamResponse<unknown>,
    req: InternalRequest,
  ) {
    if (
      this.pipelines.responseMutators.length ||
      this.pipelines.responseSideEffects.length
    ) {
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

  /**
   * @ru Обрабатывает ошибки, возникшие при выполнении запроса, с учётом пайплайна ошибок.
   * @en Handles errors occurring during request execution, considering the error pipeline.
   * @param error - The caught error.
   * @param req - Internal request that caused the error.
   * @returns If recovered, returns a response; otherwise throws the error.
   * @throws The original error if no plugin recovers it.
   */
  private async handleDispatchError<T>(error: Error, req: InternalRequest) {
    if (this.pipelines.error.length) {
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

  /**
   * @ru Применяет декомпрессию к телу ответа в зависимости от заголовка Content-Encoding.
   * @en Applies decompression to the response body based on the Content-Encoding header.
   * @param rawResponse - Raw transport response object (mutated in place).
   */
  private applyDecompression(rawResponse: Record<string, any>) {
    const encoding = rawResponse.headers?.["content-encoding"];
    if (!encoding || !rawResponse.body) return;

    const enc = Array.isArray(encoding) ? encoding[0] : encoding;

    if (rawResponse.body instanceof Uint8Array) {
      rawResponse.body = decompressBuffer(rawResponse.body, enc);
    } else {
      rawResponse.body = createDecompressStream(
        rawResponse.body as ReadableStream<Uint8Array>,
        enc,
      );
    }
  }

  /**
   * @ru Строит внутренний объект запроса на основе пользовательских параметров.
   * @en Builds an internal request object from user parameters.
   * @param method - HTTP method.
   * @param req - Request URL or configuration object.
   * @param body - Request body (optional).
   * @param signal - AbortSignal (optional).
   * @returns Fully constructed InternalRequest.
   * @throws If URL is undefined or invalid.
   */
  private buildInternalRequest(
    method: Method,
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): InternalRequest {
    const rawUrl = normalizeUrl(req);

    if (!rawUrl) {
      throw new Error(`[HyperCore] URL is undefined for ${method}`);
    }

    if (typeof req === "string") {
      let cached = urlCache.get(rawUrl);

      if (!cached) {
        const urlObj = new URL(rawUrl);
        cached = {
          href: urlObj.href,
          origin: urlObj.origin,
          path: urlObj.pathname + urlObj.search,
        };

        if (urlCache.size > 512) urlCache.clear();
        urlCache.set(rawUrl, cached);
      }

      return {
        method,
        url: cached.href,
        origin: cached.origin,
        path: cached.path,
        headers: { ...this.defaultHeaders },
        body,
        signal,
        meta: {},
      } as InternalRequest;
    }

    const urlObj = new URL(rawUrl);

    if ((req as any).query) {
      this.appendQueryParams(urlObj, (req as any).query);
    }

    const headers = (req.headers ?? {}) as Record<string, any>;

    return this.createInternalRequestObject(req as any, {
      method,
      url: urlObj.href,
      origin: urlObj.origin,
      path: urlObj.pathname + urlObj.search,
      headers: mergeHeadersFast(this.defaultHeaders, headers),
      body: normalizeBody(method, (req as any).body ?? body),
      signal: req.signal ?? signal,
      meta: (req as any).meta ?? {},
    });
  }

  /**
   * @ru Создаёт объект запроса, сохраняя прототип исходного объекта (если есть).
   * @en Creates a request object preserving the prototype of the source object (if any).
   * @param source - Original request object (may have a custom prototype).
   * @param overrides - Properties to override or add.
   * @returns New object with merged properties and inherited prototype.
   */
  private createInternalRequestObject(source: any, overrides: any) {
    const proto = Object.getPrototypeOf(source);
    const target =
      proto && proto !== Object.prototype ? Object.create(proto) : {};

    return Object.assign(target, source, overrides);
  }

  /**
   * @ru Добавляет параметры запроса к URL-объекту.
   * @en Appends query parameters to a URL object.
   * @param url - URL object to mutate.
   * @param query - Record of query parameters (supports arrays).
   */
  private appendQueryParams(url: URL, query?: Record<string, any>) {
    if (!query) return;

    for (const k in query) {
      const v = query[k];
      if (v == null) continue;

      if (Array.isArray(v)) {
        for (const i of v) url.searchParams.append(k, String(i));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }

  /**
   * @ru Упрощённый метод для текстовых/JSON-запросов, определяющий метод из объекта запроса.
   * @en Shortcut method for text/JSON requests, determining method from the request object.
   * @param req - Request URL or configuration object.
   * @param signal - Optional AbortSignal.
   * @returns Promise resolving to HttpResponse.
   */
  private async dispatchShortcut(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ) {
    const method =
      typeof req === "string" ? "GET" : ((req as any).method ?? "GET");

    return this.dispatch(
      this.buildInternalRequest(method, req, undefined, signal),
    );
  }
}
