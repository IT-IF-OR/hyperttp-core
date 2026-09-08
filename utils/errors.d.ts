/**
 * @ru Базовый класс ошибок клиента Hyperttp, агрегирующий контекст неудачного сетевого запроса.
 * @en Base error class for the Hyperttp client, providing explicit layout context for failed requests.
 */
export declare class HyperClientError extends Error {
    code: string;
    statusCode?: number | undefined;
    originalError?: Error | undefined;
    url?: string | undefined;
    method?: string | undefined;
    /**
     * @ru Создает ошибку Hyperttp с дополнительным сетевым контекстом.
     * @en Creates a Hyperttp error with optional network context.
     * @param message - Человекочитаемое описание ошибки. @en Human-readable error description.
     * @param code - Машиночитаемый код ошибки. @en Machine-readable error code.
     * @param statusCode - Связанный HTTP-статус, если есть. @en Associated HTTP status, when available.
     * @param originalError - Исходная ошибка как `cause`. @en Original error exposed as `cause`.
     * @param url - URL, связанный с ошибкой. @en URL associated with the error.
     * @param method - HTTP-метод, связанный с ошибкой. @en HTTP method associated with the error.
     */
    constructor(message: string, code?: string, statusCode?: number | undefined, originalError?: Error | undefined, url?: string | undefined, method?: string | undefined);
    /**
     * @ru Проверяет, является ли ошибка экземпляром HttpClientError (безопасно для разрозненных бандлов).
     * @en Checks if an error is an HttpClientError instance (bundle boundary safe).
     */
    static isHyperClientError(err: unknown): err is HyperClientError;
}
/**
 * @ru Ошибка, возникающая при превышении лимита времени ожидания ответа от сервера.
 * @en Error thrown when a network request exceeds its allocated execution timeout threshold.
 */
export declare class TimeoutError extends HyperClientError {
    /**
     * @ru Создает ошибку таймаута для указанного URL.
     * @en Creates a timeout error for the given URL.
     * @param url - URL запроса с истекшим таймаутом. @en URL of the timed-out request.
     * @param timeout - Лимит времени в миллисекундах. @en Time limit in milliseconds.
     */
    constructor(url: string, timeout: number);
    /**
     * @ru Проверяет, является ли ошибка экземпляром TimeoutError.
     * @en Checks if an error is a TimeoutError instance.
     */
    static isTimeoutError(err: unknown): err is TimeoutError;
}
//# sourceMappingURL=errors.d.ts.map