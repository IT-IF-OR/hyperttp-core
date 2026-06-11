import type { HttpClientOptions, HyperTransport, TransportRequest, TransportResponse } from "@hyperttp/types";
export interface NodeTransportConfig extends HttpClientOptions {
    baseUrl?: string;
}
/**
 * @ru Реализация транспорта для Node.js с использованием fetch.
 * @en Node.js transport implementation using fetch.
 */
export declare class NodeTransport implements HyperTransport {
    config: NodeTransportConfig;
    private readonly isProduction;
    private readonly cleanBaseUrl;
    constructor(config: NodeTransportConfig);
    execute(req: TransportRequest): Promise<TransportResponse>;
}
//# sourceMappingURL=node.d.ts.map