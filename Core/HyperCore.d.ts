import type { IHyperCore, HyperTransport, HttpClientOptions, HyperPlugin, InternalRequest, HttpResponse, RequestInterface, StreamResponse, RequestBodyData } from "@hyperttp/types";
declare module "@hyperttp/types" {
    interface HyperttpPluginsExtension {
        baseURL?: string;
    }
}
export type Runtime = "bun" | "node";
export declare function getRuntime(): Runtime;
type TransportDef = {
    name: string;
    runtime: Runtime[];
    pkg: string;
    export: string;
    priority: number;
};
export declare const TRANSPORTS: TransportDef[];
export declare function resolveTransport(config: HttpClientOptions): Promise<HyperTransport>;
export declare class HyperCore implements IHyperCore {
    config: HttpClientOptions;
    private transport;
    private transportPromise;
    private readonly defaultHeaders;
    private readonly pluginCtx;
    private readonly pipelines;
    constructor(config?: HttpClientOptions, transport?: HyperTransport);
    private createTransport;
    private ensureTransport;
    dispatch<T = unknown>(req: InternalRequest): Promise<HttpResponse<T>>;
    use(plugin: HyperPlugin): this;
    stream(req: RequestInterface | string, signal?: AbortSignal): Promise<StreamResponse<unknown>>;
    get<T = unknown>(req: RequestInterface | string, signal?: AbortSignal): Promise<HttpResponse<T>>;
    post<T = unknown>(req: RequestInterface | string, body?: RequestBodyData, signal?: AbortSignal): Promise<HttpResponse<T>>;
    postStream<T = unknown>(req: RequestInterface | string, body?: RequestBodyData, signal?: AbortSignal): Promise<StreamResponse<T>>;
    put<T = unknown>(req: RequestInterface | string, body?: RequestBodyData, signal?: AbortSignal): Promise<HttpResponse<T>>;
    patch<T = unknown>(req: RequestInterface | string, body?: RequestBodyData, signal?: AbortSignal): Promise<HttpResponse<T>>;
    delete<T = unknown>(req: RequestInterface | string, signal?: AbortSignal): Promise<HttpResponse<T>>;
    options<T = unknown>(req: RequestInterface | string, body?: RequestBodyData, signal?: AbortSignal): Promise<HttpResponse<T>>;
    head(req: RequestInterface | string, signal?: AbortSignal): Promise<HttpResponse<null>>;
    private buildInternalRequest;
    extend(options: Partial<HttpClientOptions>): this;
    create(options: Partial<HttpClientOptions>): HyperCore;
    destroy(graceful?: boolean): Promise<void>;
    json<T = unknown>(req: RequestInterface | string, signal?: AbortSignal): Promise<T>;
    text(req: RequestInterface | string, signal?: AbortSignal): Promise<string>;
    dump(req: RequestInterface | string, signal?: AbortSignal): Promise<void>;
}
export {};
//# sourceMappingURL=HyperCore.d.ts.map