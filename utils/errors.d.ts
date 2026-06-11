/**
 * @ru Базовый класс ошибок клиента Hyperttp, агрегирующий контекст неудачного сетевого запроса.
 * @en Base error class for the Hyperttp client, providing explicit layout context for failed requests.
 */
export declare class HttpClientError extends Error {
    code: string;
    statusCode?: number | undefined;
    originalError?: Error | undefined;
    url?: string | undefined;
    method?: string | undefined;
    /**
     * @ru Создает новый экземпляр HttpClientError.
     * @en Creates a new HttpClientError instance.
     */
    constructor(message: string, code?: string, statusCode?: number | undefined, originalError?: Error | undefined, url?: string | undefined, method?: string | undefined);
}
/**
 * @ru Ошибка, возникающая при превышении лимита времени ожидания ответа от сервера.
 * @en Error thrown when a network request exceeds its allocated execution timeout threshold.
 */
export declare class TimeoutError extends HttpClientError {
    /**
     * @ru Создает новый экземпляр TimeoutError.
     * @en Creates a new TimeoutError instance.
     */
    constructor(url: string, timeout: number);
}
/**
 * @ru Ошибка, генерируемая при получении HTTP-статуса 429 (превышение лимита частоты запросов).
 * @en Error triggered when encountering an HTTP 429 status code indicating rate limit exhaustion.
 */
export declare class RateLimitError extends HttpClientError {
    /**
     * @ru Создает новый экземпляр RateLimitError.
     * @en Creates a new RateLimitError instance.
     */
    constructor(url: string, retryAfter?: number);
}
//# sourceMappingURL=errors.d.ts.map