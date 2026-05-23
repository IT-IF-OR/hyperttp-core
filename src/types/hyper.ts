import type { Method, ResponseType } from "./http.js";
import type { RequestBodyData } from "./request.js";

export interface InternalRequest {
  method: Method;

  url: string;

  headers: Record<string, string | string[]>;

  body?: RequestBodyData;

  signal?: AbortSignal;

  meta?: {
    timings?: {
      networkMs?: number;
    };
    responseType?: ResponseType;
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
