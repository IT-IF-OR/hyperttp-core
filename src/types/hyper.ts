import type { Method } from "./http.js";
import type { RequestBodyData, RequestInterface } from "./request.js";

export interface InternalRequest {
  method: Method;
  url: RequestInterface | string;
  headers: Record<string, string>;
  body?: RequestBodyData;
  signal?: AbortSignal;
  isGet: boolean;
  meta?: {
    timings?: {
      serializationMs?: number;
      networkMs?: number;
      parsingMs?: number;
    };
    [key: string]: any;
  };
}

export interface HttpResponse<T = any> {
  status: number;
  headers: Record<string, any>;
  url?: string;
  body: T;
}

export interface HyperStats {
  inflightRequests?: number;
  cacheSize?: number;
  queuedRequests?: number;
  activeQueue?: number;
  rateLimitHits?: number;
  [key: string]: any;
}
