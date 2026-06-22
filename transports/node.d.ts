import type { HttpClientOptions, HyperTransport, StealthOptions, TransportRequest, TransportResponse } from "@hyperttp/types";
/**
 * @ru Конфигурация транспорта для Node.js с использованием нативных http/https модулей.
 * @en Node.js transport configuration using native http/https modules.
 */
export interface NodeTransportConfig extends HttpClientOptions {
    /**
     * @ru Базовый URL для относительных путей.
     * @en Base URL for relative paths.
     */
    baseUrl?: string;
    /**
     * @ru Настройки stealth-маскировки на уровне транспорта.
     * @en Stealth masking settings at the transport level.
     */
    stealth?: StealthOptions;
}
/**
 * @ru Реализация транспорта для Node.js с использованием нативных http/https модулей.
 * Поддерживает stealth-маскировку, фрагментацию TLS Client Hello и автоматическую декомпрессию.
 */
export declare class NodeTransport implements HyperTransport {
    config: NodeTransportConfig;
    private readonly isProduction;
    private readonly cleanBaseUrl;
    private readonly agentCache;
    constructor(config: NodeTransportConfig);
    execute(req: TransportRequest): Promise<TransportResponse>;
    close(): Promise<void>;
    destroy(): Promise<void>;
}
//# sourceMappingURL=node.d.ts.map