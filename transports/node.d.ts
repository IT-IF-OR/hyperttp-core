import type { HttpClientOptions, HyperTransport, RetryOptions, TransportRequest, TransportResponse } from "@hyperttp/types";
export declare function isRedirect(status: number): boolean;
export declare function shouldRetry(status: number, retryOptions: RetryOptions): boolean;
export declare function sleep(ms: number): Promise<void>;
export declare function calcDelay(attempt: number, retryOptions: RetryOptions): number;
export declare class NodeTransport implements HyperTransport {
    config: HttpClientOptions;
    private readonly httpAgent;
    private readonly httpsAgent;
    constructor(config: HttpClientOptions);
    private get timeout();
    private logRetry;
    execute(req: TransportRequest): Promise<TransportResponse>;
    private dispatchOnce;
    close(): Promise<void>;
    destroy(): Promise<void>;
}
//# sourceMappingURL=node.d.ts.map