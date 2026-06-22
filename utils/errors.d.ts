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
//# sourceMappingURL=errors.d.ts.map