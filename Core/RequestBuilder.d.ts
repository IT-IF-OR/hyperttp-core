import type { HttpClientOptions, InternalRequest, RequestInterface, RequestBodyData, Method } from "@hyperttp/types";
export declare class RequestBuilder {
    private urlCache;
    private urlCacheCount;
    private readonly MAX_CACHE_SIZE;
    build(method: Method, req: RequestInterface | string, body: RequestBodyData | undefined, signal: AbortSignal | undefined, responseType: "stream" | undefined, defaultHeaders: Record<string, string | string[]>, config: HttpClientOptions, pooled?: InternalRequest): InternalRequest;
    private resolveUrl;
    private ensureCacheSpace;
    private appendQueryParams;
}
//# sourceMappingURL=RequestBuilder.d.ts.map