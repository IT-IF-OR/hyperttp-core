import { defaultConfig } from "../defaultConfig.js";
import { mapResponseFast, mapStreamFast, mergeHeadersFast } from "../utils/response.js";
import { TransportManager } from "../transports/manager.js";
import { createPipelines, executeErrorPipeline, executeRequestPipeline, executeResponsePipeline, executeResponseDataPipeline, insertHookSorted, } from "../utils/pipeline.js";
import { normalizeBody, normalizeHeaders, normalizeUrl } from "../utils/normalize.js";
/**
 * @ru Глобальный кэш URL для избежания повторного парсинга через `new URL()`.
 * Использует `Object.create(null)` для быстрого доступа без прототипа.
 * @en Global URL cache to avoid repeated parsing via `new URL()`.
 * Uses `Object.create(null)` for fast prototype-less access.
 */
const urlCache = Object.create(null);
let urlCacheCount = 0;
const MAX_CACHE_SIZE = 512;
/**
 * @ru Пул переиспользуемых объектов InternalRequest для zero-allocation в горячем пути.
 * @en Pool of reusable InternalRequest objects for zero-allocation in the hot path.
 */
const requestPool = [];
const MAX_POOL_SIZE = 64;
/**
 * @ru Ядро HTTP-клиента Hyperttp. Обеспечивает диспетчеризацию запросов через
 * конвейер плагинов, пулинг объектов запросов и кэширование URL.
 * @en Hyperttp HTTP client core. Provides request dispatching through the
 * plugin pipeline, request object pooling, and URL caching.
 */
export class HyperCore {
    config;
    transportManager;
    transportReady;
    defaultHeaders;
    pluginCtx;
    pipelines = createPipelines();
    hasRequestPlugins = false;
    hasResponseDataPlugins = false;
    hasResponsePlugins = false;
    hasErrorPlugins = false;
    /**
     * @ru Создаёт новый экземпляр ядра HTTP-клиента.
     * @en Creates a new HTTP client core instance.
     * @param config - Client configuration options.
     * @param transport - Optional custom transport implementation.
     */
    constructor(config = defaultConfig, transport) {
        this.config = {
            ...defaultConfig,
            ...config,
            network: { ...defaultConfig.network, ...config.network },
        };
        this.transportManager = new TransportManager(this.config, transport);
        this.transportReady = this.transportManager.getSync()
            ? Promise.resolve(this.transportManager.getSync())
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
    async getTransportName() {
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
    async dispatch(req) {
        try {
            if (this.hasRequestPlugins) {
                const syncResult = executeRequestPipeline(this.pipelines.request, req, this.pluginCtx);
                const shortCircuit = syncResult instanceof Promise ? await syncResult : syncResult;
                if (shortCircuit != null) {
                    this.recycleRequest(req);
                    return shortCircuit;
                }
            }
            const transport = this.transportManager.getSync() ?? (await this.transportReady);
            const networkStart = performance.now();
            let rawResponse = await transport.execute(req);
            const networkMs = performance.now() - networkStart;
            const meta = (req.meta ??= {});
            meta.timings = { ...meta.timings, networkMs };
            if (this.hasResponseDataPlugins) {
                const syncResult = executeResponseDataPipeline(this.pipelines.responseData, rawResponse, this.pluginCtx);
                rawResponse = syncResult instanceof Promise ? await syncResult : syncResult;
            }
            const response = req.meta?.responseType === "stream"
                ? mapStreamFast(rawResponse)
                : mapResponseFast(rawResponse);
            if (this.hasResponsePlugins) {
                const syncResult = executeResponsePipeline(this.pipelines.responseMutators, this.pipelines.responseSideEffects, response, req, this.pluginCtx, this.config.logger);
                if (syncResult instanceof Promise) {
                    await syncResult;
                }
            }
            this.recycleRequest(req);
            return response;
        }
        catch (error) {
            this.recycleRequest(req);
            return this.handleDispatchError(error, req);
        }
    }
    /**
     * @ru Регистрирует плагин в экземпляре клиента. Плагины выполняются в порядке приоритета.
     * @en Registers a plugin into the client instance. Plugins are executed in priority order.
     * @param plugin - The plugin instance to register.
     * @returns The current instance for chaining.
     */
    use(plugin) {
        const isEnabled = plugin.enabled ? plugin.enabled(this.config) : true;
        if (!isEnabled)
            return this;
        plugin.setup?.(this.pluginCtx);
        const priority = plugin.priority ?? 0;
        const hook = { name: plugin.name, priority };
        if (plugin.onRequest) {
            insertHookSorted(this.pipelines.request, {
                ...hook,
                run: plugin.onRequest,
            });
            this.hasRequestPlugins = true;
        }
        if (plugin.onResponse) {
            const target = plugin.mode === "background"
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
    get(req, signal) {
        return this.dispatch(this.acquireReq("GET", req, undefined, signal));
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
    post(req, body, signal) {
        return this.dispatch(this.acquireReq("POST", req, body, signal));
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
    put(req, body, signal) {
        return this.dispatch(this.acquireReq("PUT", req, body, signal));
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
    patch(req, body, signal) {
        return this.dispatch(this.acquireReq("PATCH", req, body, signal));
    }
    /**
     * @ru Выполняет DELETE-запрос.
     * @en Performs a DELETE request.
     * @template T - Expected response body type.
     * @param req - Request URL or RequestInterface object.
     * @param signal - Optional abort signal.
     * @returns Promise resolving to the HTTP response.
     */
    delete(req, signal) {
        return this.dispatch(this.acquireReq("DELETE", req, undefined, signal));
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
    options(req, body, signal) {
        return this.dispatch(this.acquireReq("OPTIONS", req, body, signal));
    }
    /**
     * @ru Выполняет HEAD-запрос (без тела ответа).
     * @en Performs a HEAD request (no response body).
     * @param req - Request URL or RequestInterface object.
     * @param signal - Optional abort signal.
     * @returns Promise resolving to the HTTP response with null body.
     */
    head(req, signal) {
        return this.dispatch(this.acquireReq("HEAD", req, undefined, signal));
    }
    /**
     * @ru Инициирует потоковый GET-запрос. Тело ответа возвращается как ReadableStream.
     * @en Initiates a streaming GET request. Response body is returned as a ReadableStream.
     * @param req - Request URL or RequestInterface object.
     * @param signal - Optional abort signal.
     * @returns Promise resolving to the stream response.
     */
    stream(req, signal) {
        return this.dispatch(this.acquireReq("GET", req, undefined, signal, "stream"));
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
    postStream(req, body, signal) {
        return this.dispatch(this.acquireReq("POST", req, body, signal, "stream"));
    }
    /**
     * @ru Создаёт новый экземпляр клиента, объединяя текущую конфигурацию с переданными опциями.
     * @en Creates a new client instance by merging the current configuration with provided options.
     * @param options - Partial configuration options to extend.
     * @returns A new HyperCore instance.
     */
    extend(options) {
        return new HyperCore({
            ...this.config,
            ...options,
            network: { ...this.config.network, ...options.network },
        }, this.transportManager.transport ?? undefined);
    }
    /**
     * @ru Создаёт полностью новый экземпляр клиента на основе переданных опций.
     * @en Creates a completely new client instance based on provided options.
     * @param options - Partial configuration options for the new instance.
     * @returns A new HyperCore instance.
     */
    create(options) {
        return this.extend(options);
    }
    /**
     * @ru Завершает работу клиента и освобождает ресурсы (соединения, пулы).
     * @en Shuts down the client and releases resources (connections, pools).
     * @param graceful - If true, waits for active requests to complete before closing.
     * @returns Promise that resolves when shutdown is complete.
     */
    destroy(graceful = true) {
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
    async json(req, signal) {
        return ((await this.shortcut(req, signal)).json?.() ??
            Promise.reject(new Error("json() not supported")));
    }
    /**
     * @ru Выполняет GET-запрос и возвращает тело ответа как текст.
     * @en Performs a GET request and returns the response body as text.
     * @param req - Request URL or RequestInterface object.
     * @param signal - Optional abort signal.
     * @returns Promise resolving to the response text.
     */
    async text(req, signal) {
        return ((await this.shortcut(req, signal)).text?.() ??
            Promise.reject(new Error("text() not supported")));
    }
    /**
     * @ru Выполняет GET-запрос и немедленно отбрасывает тело ответа для освобождения ресурсов.
     * @en Performs a GET request and immediately discards the response body to free resources.
     * @param req - Request URL or RequestInterface object.
     * @param signal - Optional abort signal.
     * @returns Promise that resolves when the stream is drained.
     */
    async dump(req, signal) {
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
    async handleDispatchError(error, req) {
        if (this.hasErrorPlugins) {
            const recovered = await executeErrorPipeline(this.pipelines.error, error, req, this.pluginCtx);
            if (recovered != null) {
                if (this.hasResponsePlugins) {
                    await Promise.resolve(executeResponsePipeline(this.pipelines.responseMutators, this.pipelines.responseSideEffects, recovered, req, this.pluginCtx, this.config.logger));
                }
                return recovered;
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
    acquireReq(method, req, body, signal, responseType) {
        const pooled = requestPool.pop();
        const internalReq = pooled ?? {
            method: "GET",
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
        if (!rawUrl)
            throw new Error(`[HyperCore] URL is undefined for ${method}`);
        let finalUrl = urlCache[rawUrl];
        if (!finalUrl) {
            const urlObj = new URL(rawUrl);
            if (req.query)
                this.appendQueryParams(urlObj, req.query);
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
                    responseType: req.meta.responseType,
                }
                : undefined;
        return internalReq;
    }
    /**
     * @ru Возвращает объект запроса в пул для переиспользования, очищая ссылки для GC.
     * @en Returns the request object to the pool for reuse, clearing references for GC.
     * @param req - The internal request object to recycle.
     */
    recycleRequest(req) {
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
    resolveUrl(url) {
        if (!url)
            throw new Error("[HyperCore] URL is undefined");
        let finalUrl = urlCache[url];
        if (finalUrl)
            return finalUrl;
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
    appendQueryParams(url, query) {
        for (const k in query) {
            if (Object.prototype.hasOwnProperty.call(query, k)) {
                const v = query[k];
                if (v == null)
                    continue;
                if (Array.isArray(v)) {
                    for (let j = 0; j < v.length; j++)
                        url.searchParams.append(k, String(v[j]));
                }
                else {
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
    shortcut(req, signal) {
        const method = typeof req === "string" ? "GET" : (req.method ?? "GET");
        return this.dispatch(this.acquireReq(method, req, undefined, signal));
    }
}
//# sourceMappingURL=HyperCore.js.map