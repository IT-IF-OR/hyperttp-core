/**
 * @ru Базовый класс ошибок клиента Hyperttp, агрегирующий контекст неудачного сетевого запроса.
 * @en Base error class for the Hyperttp client, providing explicit layout context for failed requests.
 */
export class HttpClientError extends Error {
    code;
    statusCode;
    originalError;
    url;
    method;
    /**
     * @ru Создает новый экземпляр HttpClientError.
     * @en Creates a new HttpClientError instance.
     */
    constructor(message, code = "HTTP_ERROR", statusCode, originalError, url, method) {
        super(message, originalError ? { cause: originalError } : undefined);
        this.code = code;
        this.statusCode = statusCode;
        this.originalError = originalError;
        this.url = url;
        this.method = method;
        this.name = "HttpClientError";
    }
}
/**
 * @ru Ошибка, возникающая при превышении лимита времени ожидания ответа от сервера.
 * @en Error thrown when a network request exceeds its allocated execution timeout threshold.
 */
export class TimeoutError extends HttpClientError {
    /**
     * @ru Создает новый экземпляр TimeoutError.
     * @en Creates a new TimeoutError instance.
     */
    constructor(url, timeout) {
        super(`Timeout after ${timeout}ms`, "TIMEOUT", 408, undefined, url);
        this.name = "TimeoutError";
    }
}
/**
 * @ru Ошибка, генерируемая при получении HTTP-статуса 429 (превышение лимита частоты запросов).
 * @en Error triggered when encountering an HTTP 429 status code indicating rate limit exhaustion.
 */
export class RateLimitError extends HttpClientError {
    /**
     * @ru Создает новый экземпляр RateLimitError.
     * @en Creates a new RateLimitError instance.
     */
    constructor(url, retryAfter) {
        super(`Rate limited${retryAfter ? ` retry in ${retryAfter}ms` : ""}`, "RATE_LIMIT", 429, undefined, url);
        this.name = "RateLimitError";
    }
}
//# sourceMappingURL=errors.js.map