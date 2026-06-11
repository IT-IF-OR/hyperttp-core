import type { IHyperCore, HyperTransport, HttpClientOptions, HyperPlugin, InternalRequest, HttpResponse, RequestInterface, StreamResponse, RequestBodyData } from "@hyperttp/types";
/**
 * @ru Ядро HTTP-клиента Hyperttp. Обеспечивает диспетчеризацию запросов через
 * конвейер плагинов, пулинг объектов запросов и кэширование URL.
 * @en Hyperttp HTTP client core. Provides request dispatching through the
 * plugin pipeline, request object pooling, and URL caching.
 */
export declare class HyperCore implements IHyperCore {
    config: HttpClientOptions;
    private readonly transportManager;
    private readonly transportReady;
    private readonly defaultHeaders;
    private readonly pluginCtx;
    private readonly pipelines;
    private hasRequestPlugins;
    private hasResponseDataPlugins;
    private hasResponsePlugins;
    private hasErrorPlugins;
    /**
     * @ru Создаёт новый экземпляр ядра HTTP-клиента.
     * @en Creates a new HTTP client core instance.
     * @param config - Client configuration options.
     * @param transport - Optional custom transport implementation.
     */
    constructor(config?: HttpClientOptions, transport?: HyperTransport);
    /**
     * @ru Возвращает имя класса текущего активного транспорта.
     * @en Returns the class name of the currently active transport.
     * @returns Promise resolving to the transport class name.
     */
    getTransportName(): Promise<string>;
    /**
     * @ru Отправляет внутренний запрос через полный конвейер обработки:
     * плагины запроса → транспорт → плагины данных ответа → маппинг → плагины ответа.
     * @en Dispatches an internal request through the full processing pipeline:
     * request plugins → transport → response data plugins → mapping → response plugins.
     * @template T - Expected response body type.
     * @param req - The normalized internal request object.
     * @returns Promise resolving to the HTTP response.
     */
    dispatch<T = unknown>(req: InternalRequest): Promise<HttpResponse<T>>;
    /**
     * @ru Регистрирует плагин в экземпляре клиента. Плагины выполняются в порядке приоритета.
     * @en Registers a plugin into the client instance. Plugins are executed in priority order.
     * @param plugin - The plugin instance to register.
     * @returns The current instance for chaining.
     */
    use(plugin: HyperPlugin): this;
    /**
     * @ru Выполняет GET-запрос.
     * @en Performs a GET request.
     * @template T - Expected response body type.
     * @param req - Request URL or RequestInterface object.
     * @param signal - Optional abort signal.
     * @returns Promise resolving to the HTTP response.
     */
    get<T = unknown>(req: RequestInterface | string, signal?: AbortSignal): Promise<HttpResponse<T>>;
    /**
     * @ru Выполняет POST-запрос с телом.
     * @en Performs a POST request with a body.
     * @template T - Expected response body type.
     * @param req - Request URL or RequestInterface object.
     * @param body - Request body data.
     * @param signal - Optional abort signal.
     * @returns Promise resolving to the HTTP response.
     */
    post<T = unknown>(req: RequestInterface | string, body?: RequestBodyData, signal?: AbortSignal): Promise<HttpResponse<T>>;
    /**
     * @ru Выполняет PUT-запрос с телом.
     * @en Performs a PUT request with a body.
     * @template T - Expected response body type.
     * @param req - Request URL or RequestInterface object.
     * @param body - Request body data.
     * @param signal - Optional abort signal.
     * @returns Promise resolving to the HTTP response.
     */
    put<T = unknown>(req: RequestInterface | string, body?: RequestBodyData, signal?: AbortSignal): Promise<HttpResponse<T>>;
    /**
     * @ru Выполняет PATCH-запрос с телом.
     * @en Performs a PATCH request with a body.
     * @template T - Expected response body type.
     * @param req - Request URL or RequestInterface object.
     * @param body - Request body data.
     * @param signal - Optional abort signal.
     * @returns Promise resolving to the HTTP response.
     */
    patch<T = unknown>(req: RequestInterface | string, body?: RequestBodyData, signal?: AbortSignal): Promise<HttpResponse<T>>;
    /**
     * @ru Выполняет DELETE-запрос.
     * @en Performs a DELETE request.
     * @template T - Expected response body type.
     * @param req - Request URL or RequestInterface object.
     * @param signal - Optional abort signal.
     * @returns Promise resolving to the HTTP response.
     */
    delete<T = unknown>(req: RequestInterface | string, signal?: AbortSignal): Promise<HttpResponse<T>>;
    /**
     * @ru Выполняет OPTIONS-запрос.
     * @en Performs an OPTIONS request.
     * @template T - Expected response body type.
     * @param req - Request URL or RequestInterface object.
     * @param body - Optional request body data.
     * @param signal - Optional abort signal.
     * @returns Promise resolving to the HTTP response.
     */
    options<T = unknown>(req: RequestInterface | string, body?: RequestBodyData, signal?: AbortSignal): Promise<HttpResponse<T>>;
    /**
     * @ru Выполняет HEAD-запрос (без тела ответа).
     * @en Performs a HEAD request (no response body).
     * @param req - Request URL or RequestInterface object.
     * @param signal - Optional abort signal.
     * @returns Promise resolving to the HTTP response with null body.
     */
    head(req: RequestInterface | string, signal?: AbortSignal): Promise<HttpResponse<null>>;
    /**
     * @ru Инициирует потоковый GET-запрос. Тело ответа возвращается как ReadableStream.
     * @en Initiates a streaming GET request. Response body is returned as a ReadableStream.
     * @param req - Request URL or RequestInterface object.
     * @param signal - Optional abort signal.
     * @returns Promise resolving to the stream response.
     */
    stream(req: RequestInterface | string, signal?: AbortSignal): Promise<StreamResponse<unknown>>;
    /**
     * @ru Инициирует потоковый POST-запрос с телом. Тело ответа возвращается как ReadableStream.
     * @en Initiates a streaming POST request with a body. Response body is returned as a ReadableStream.
     * @template T - Expected response body type.
     * @param req - Request URL or RequestInterface object.
     * @param body - Request body data.
     * @param signal - Optional abort signal.
     * @returns Promise resolving to the stream response.
     */
    postStream<T = unknown>(req: RequestInterface | string, body?: RequestBodyData, signal?: AbortSignal): Promise<StreamResponse<T>>;
    /**
     * @ru Создаёт новый экземпляр клиента, объединяя текущую конфигурацию с переданными опциями.
     * @en Creates a new client instance by merging the current configuration with provided options.
     * @param options - Partial configuration options to extend.
     * @returns A new HyperCore instance.
     */
    extend(options: Partial<HttpClientOptions>): HyperCore;
    /**
     * @ru Создаёт полностью новый экземпляр клиента на основе переданных опций.
     * @en Creates a completely new client instance based on provided options.
     * @param options - Partial configuration options for the new instance.
     * @returns A new HyperCore instance.
     */
    create(options: Partial<HttpClientOptions>): HyperCore;
    /**
     * @ru Завершает работу клиента и освобождает ресурсы (соединения, пулы).
     * @en Shuts down the client and releases resources (connections, pools).
     * @param graceful - If true, waits for active requests to complete before closing.
     * @returns Promise that resolves when shutdown is complete.
     */
    destroy(graceful?: boolean): Promise<void>;
    /**
     * @ru Выполняет GET-запрос и возвращает распарсенное JSON-тело ответа.
     * @en Performs a GET request and returns the parsed JSON response body.
     * @template T - Expected type of the parsed JSON.
     * @param req - Request URL or RequestInterface object.
     * @param signal - Optional abort signal.
     * @returns Promise resolving to the parsed JSON data.
     */
    json<T = unknown>(req: RequestInterface | string, signal?: AbortSignal): Promise<T>;
    /**
     * @ru Выполняет GET-запрос и возвращает тело ответа как текст.
     * @en Performs a GET request and returns the response body as text.
     * @param req - Request URL or RequestInterface object.
     * @param signal - Optional abort signal.
     * @returns Promise resolving to the response text.
     */
    text(req: RequestInterface | string, signal?: AbortSignal): Promise<string>;
    /**
     * @ru Выполняет GET-запрос и немедленно отбрасывает тело ответа для освобождения ресурсов.
     * @en Performs a GET request and immediately discards the response body to free resources.
     * @param req - Request URL or RequestInterface object.
     * @param signal - Optional abort signal.
     * @returns Promise that resolves when the stream is drained.
     */
    dump(req: RequestInterface | string, signal?: AbortSignal): Promise<void>;
    /**
     * @ru Обрабатывает ошибку диспетчеризации через конвейер плагинов обработки ошибок.
     * @en Handles dispatch errors through the error handling plugin pipeline.
     * @template T - Expected response body type.
     * @param error - The error that occurred.
     * @param req - The original internal request.
     * @returns Promise resolving to a recovered HTTP response, or throws if unrecoverable.
     */
    private handleDispatchError;
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
    private acquireReq;
    /**
     * @ru Возвращает объект запроса в пул для переиспользования, очищая ссылки для GC.
     * @en Returns the request object to the pool for reuse, clearing references for GC.
     * @param req - The internal request object to recycle.
     */
    private recycleRequest;
    /**
     * @ru Разрешает и кэширует URL, нормализуя его через URL API при необходимости.
     * @en Resolves and caches the URL, normalizing it via the URL API when necessary.
     * @param url - The raw URL string.
     * @returns The resolved and cached URL string.
     */
    private resolveUrl;
    /**
     * @ru Добавляет query-параметры к объекту URL, поддерживая массивы значений.
     * @en Appends query parameters to the URL object, supporting arrays of values.
     * @param url - The URL object to modify.
     * @param query - Record of query parameter key-value pairs.
     */
    private appendQueryParams;
    /**
     * @ru Выполняет быстрый запрос с автоматическим определением HTTP-метода.
     * @en Performs a shortcut request with automatic HTTP method detection.
     * @param req - Request URL or RequestInterface object.
     * @param signal - Optional abort signal.
     * @returns Promise resolving to the HTTP response.
     */
    private shortcut;
}
//# sourceMappingURL=HyperCore.d.ts.map