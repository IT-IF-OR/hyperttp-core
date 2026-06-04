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

export class HyperCore implements IHyperCore {
  public config: HttpClientOptions;
  private readonly transportManager: TransportManager;
  private readonly defaultHeaders: Record<string, string | string[]>;
  private readonly pluginCtx: PluginContext;
  private readonly pipelines = createPipelines();

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

  /**
   * Центральный метод обработки запросов
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

      req.headers = normalizeHeaders(req.headers);

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

  public async dispatch<T = unknown>(
    req: InternalRequest,
  ): Promise<HttpResponse<T>> {
    return this.dispatchInternal<T>(req) as Promise<HttpResponse<T>>;
  }

  /**
   * Регистрация плагинов
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
   * Публичные HTTP методы-помощники
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

  public async postStream<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): Promise<StreamResponse<T>> {
    const internalReq = this.buildInternalRequest("POST", req, body, signal);
    internalReq.meta = { ...internalReq.meta, responseType: "stream" };
    return this.dispatchInternal(internalReq) as Promise<StreamResponse<T>>;
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
    await this.transportManager.destroy(graceful);
  }

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

  /**
   * ПРИВАТНЫЕ МЕТОДЫ-ПОМОЩНИКИ (РЕФАКТОРИНГ)
   */

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

  /**
   * Изолированная обработка ошибок пайплайна ответа
   */
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

  /**
   * Применение встроенной декомпрессии на основе заголовков ответа транспорта
   */
  private applyDecompression(rawResponse: any): void {
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

  /**
   * Сборка внутреннего объекта запроса InternalRequest
   */
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

  /**
   * Фабрика сохранения прототипа исходного запроса с подменой дескрипторов базовых свойств
   */
  private createInternalRequestObject(
    sourceReq: Record<string, unknown>,
    overrides: Record<string, unknown>,
  ): InternalRequest {
    const proto = Object.getPrototypeOf(sourceReq);
    const target =
      proto && proto !== Object.prototype ? Object.create(proto) : {};

    Object.defineProperties(
      target,
      Object.getOwnPropertyDescriptors(sourceReq),
    );

    const propertyDescriptors: PropertyDescriptorMap = {};
    for (const [key, value] of Object.entries(overrides)) {
      propertyDescriptors[key] = {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      };
    }

    Object.defineProperties(target, propertyDescriptors);
    return target as InternalRequest;
  }

  private appendQueryParams(url: URL, query?: Record<string, unknown>): void {
    if (!query) return;

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;

      if (Array.isArray(value)) {
        for (const item of value) {
          if (item === undefined || item === null) continue;
          url.searchParams.append(key, String(item));
        }
      } else {
        url.searchParams.set(key, String(value));
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
