import type { HttpClientOptions, HyperTransport, TransportRequest, TransportResponse } from "@hyperttp/types";
/**
 * @ru Конфигурация транспорта для браузера.
 * @en Browser transport configuration.
 */
export interface BrowserTransportConfig extends HttpClientOptions {
    /**
     * @ru Базовый URL для относительных путей. По умолчанию — window.location.origin.
     * @en Base URL for relative paths. Defaults to window.location.origin.
     */
    baseUrl?: string;
}
/**
 * @ru Реализация транспорта для браузера с использованием глобального fetch API.
 * Оптимизирован для минимального размера и максимальной совместимости.
 * @en Browser transport implementation using the global fetch API.
 * Optimized for minimal size and maximum compatibility.
 */
export declare class BrowserTransport implements HyperTransport {
    config: BrowserTransportConfig;
    private readonly isProduction;
    private readonly cleanBaseUrl;
    /**
     * @ru Создаёт экземпляр BrowserTransport.
     * @en Creates a BrowserTransport instance.
     * @param config - Transport configuration.
     */
    constructor(config: BrowserTransportConfig);
    /**
     * @ru Выполняет HTTP-запрос через глобальный fetch.
     * @en Executes an HTTP request via the global fetch.
     * @param req - The normalized transport request.
     * @returns Promise resolving to the transport response.
     */
    execute(req: TransportRequest): Promise<TransportResponse>;
}
//# sourceMappingURL=browser.d.ts.map