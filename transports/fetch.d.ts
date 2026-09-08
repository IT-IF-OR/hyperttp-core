import type { HyperTransport, LogLevel, SenderProtocol, TransportListenOptions, TransportRequest, TransportResponse, TransportServer } from "@hyperttp/types";
export interface FetchTransportOptions {
    /**
     * @ru Кастомный список поддерживаемых протоколов.
     * @en Custom list of supported protocols.
     */
    protocols?: SenderProtocol[];
    /**
     * @ru Максимальный размер входящего серверного тела в байтах. Превышение
     * возвращает HTTP 413 до передачи тела обработчику.
     * @en Maximum incoming server request body size in bytes. Exceeding it returns
     * HTTP 413 before the body reaches the handler.
     */
    maxBodyBytes?: number;
    /**
     * @ru Обработчик ошибок входящих серверных запросов.
     * @en Error hook for incoming server requests.
     */
    onError?: (error: unknown, request: TransportRequest) => void;
    logger?: (level: LogLevel, message: string, meta?: unknown) => void;
}
/**
 * @ru Минимальный транспорт на базе нативного fetch. Гарантированный fallback,
 * когда ни один пакетный транспорт (@hyperttp/transport-undici/bun) не установлен.
 * @en Minimal native fetch-based transport. A guaranteed fallback used when no
 * packaged transport (@hyperttp/transport-undici/bun) is installed.
 */
export declare class FetchTransport implements HyperTransport {
    readonly protocols: readonly SenderProtocol[];
    private readonly maxBodyBytes;
    private readonly onError?;
    private readonly logger?;
    /**
     * @ru Создаёт fallback-транспорт на базе глобального `fetch`.
     * @en Creates a fallback transport based on global `fetch`.
     * @param options - Поддерживаемые протоколы и серверный лимит тела. @en Supported protocols and server body limit.
     */
    constructor(options?: FetchTransportOptions);
    execute(req: TransportRequest): Promise<TransportResponse>;
    listen(options: TransportListenOptions): Promise<TransportServer>;
    close(): Promise<void>;
}
//# sourceMappingURL=fetch.d.ts.map