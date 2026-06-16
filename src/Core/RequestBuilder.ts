import type {
  HttpClientOptions,
  InternalRequest,
  RequestInterface,
  RequestBodyData,
  Method,
  ResponseType,
} from "@hyperttp/types";
import { normalizeBody, normalizeUrl } from "../utils/normalize.js";
import { mergeHeadersFast } from "../utils/response.js";

function combineSignals(userSignal: AbortSignal, timeoutMs: number): AbortSignal {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([userSignal, AbortSignal.timeout(timeoutMs)]);
  }

  const controller = new AbortController();
  let cleanup: (() => void) | undefined;

  const onUserAbort = () => {
    cleanup?.();
    controller.abort(userSignal.reason);
  };

  const onTimeout = () => {
    controller.abort(new DOMException("Timeout", "TimeoutError"));
  };

  const timeoutId = setTimeout(onTimeout, timeoutMs);
  cleanup = () => {
    clearTimeout(timeoutId);
  };

  userSignal.addEventListener("abort", onUserAbort);

  controller.signal.addEventListener("abort", () => {
    userSignal.removeEventListener("abort", onUserAbort);
    clearTimeout(timeoutId);
  });

  return controller.signal;
}

function applyTimeout(
  signal: AbortSignal | undefined,
  timeout: number | undefined,
): AbortSignal | undefined {
  if (timeout == null || timeout <= 0) return signal;
  if (!signal) return AbortSignal.timeout(timeout);
  return combineSignals(signal, timeout);
}

export class RequestBuilder {
  private urlCache: Record<string, string> = Object.create(null);
  private urlCacheCount = 0;
  private readonly MAX_CACHE_SIZE = 512;

  build(
    method: Method,
    req: RequestInterface | string,
    body: RequestBodyData | undefined,
    signal: AbortSignal | undefined,
    responseType: "stream" | undefined,
    defaultHeaders: Record<string, string | string[]>,
    config: HttpClientOptions,
    pooled?: InternalRequest,
  ): InternalRequest {
    const internalReq = pooled ?? {
      method: "GET" as Method,
      url: "",
      headers: defaultHeaders,
      body: undefined,
      signal: undefined,
      meta: {
        responseType: undefined as ResponseType | undefined,
        timings: {
          networkMs: undefined as number | undefined,
        },
      },
      stealth: undefined,
    };

    const metaObj = internalReq.meta as {
      responseType: ResponseType | undefined;
      timings: {
        networkMs: number | undefined;
      };
    };

    if (typeof req === "string") {
      internalReq.method = method;
      internalReq.url = this.resolveUrl(req, config.baseURL);
      internalReq.headers = { ...defaultHeaders };
      internalReq.body = body !== undefined ? normalizeBody(method, body) : undefined;
      internalReq.signal = applyTimeout(signal, config.network?.timeout);

      metaObj.responseType = responseType;

      internalReq.stealth = config.network?.stealth;
      return internalReq;
    }

    const rawUrl = normalizeUrl(req);
    if (!rawUrl) throw new Error(`[HyperCore] URL is undefined for ${method}`);

    let finalUrl: string;

    if (req.query) {
      const cacheKey = rawUrl + "_base";
      let baseUrl = this.urlCache[cacheKey];

      if (!baseUrl) {
        baseUrl = config.baseURL ? new URL(rawUrl, config.baseURL).href : new URL(rawUrl).href;

        this.ensureCacheSpace();
        this.urlCache[cacheKey] = baseUrl;
        this.urlCacheCount++;
      }

      const urlObj = new URL(baseUrl);
      this.appendQueryParams(urlObj, req.query);
      finalUrl = urlObj.href;
    } else {
      let cachedUrl = this.urlCache[rawUrl];
      if (!cachedUrl) {
        cachedUrl = config.baseURL ? new URL(rawUrl, config.baseURL).href : new URL(rawUrl).href;

        if (this.urlCacheCount >= this.MAX_CACHE_SIZE) {
          this.urlCache = Object.create(null);
          this.urlCacheCount = 0;
        }
        this.urlCache[rawUrl] = cachedUrl;
        this.urlCacheCount++;
      }
      finalUrl = cachedUrl;
    }

    internalReq.method = method;
    internalReq.url = finalUrl;
    internalReq.headers = req.headers
      ? mergeHeadersFast({ ...defaultHeaders }, req.headers)
      : { ...defaultHeaders };
    internalReq.body = normalizeBody(method, req.body ?? body);
    internalReq.signal = applyTimeout(req.signal ?? signal, config.network?.timeout);

    metaObj.responseType =
      responseType ?? (req.meta as { responseType?: ResponseType })?.responseType;

    if (req.stealth) {
      internalReq.stealth = config.network?.stealth
        ? { ...config.network.stealth, ...req.stealth }
        : req.stealth;
    } else {
      internalReq.stealth = config.network?.stealth;
    }

    return internalReq;
  }

  private resolveUrl(url: string, baseURL?: string): string {
    if (!url) throw new Error("[HyperCore] URL is undefined");

    let finalUrl = this.urlCache[url];
    if (finalUrl) return finalUrl;

    const isAbsolute = url.startsWith("http://") || url.startsWith("https://");

    if (isAbsolute && !url.includes("?")) {
      finalUrl = url;
    } else {
      finalUrl = baseURL ? new URL(url, baseURL).href : new URL(url).href;
    }

    if (this.urlCacheCount >= this.MAX_CACHE_SIZE) {
      this.urlCache = Object.create(null);
      this.urlCacheCount = 0;
    }
    this.urlCache[url] = finalUrl;
    this.urlCacheCount++;

    return finalUrl;
  }

  private ensureCacheSpace(): void {
    if (this.urlCacheCount >= this.MAX_CACHE_SIZE) {
      this.urlCache = Object.create(null);
      this.urlCacheCount = 0;
    }
  }

  private appendQueryParams(url: URL, query: Record<string, unknown>): void {
    for (const k in query) {
      if (Object.prototype.hasOwnProperty.call(query, k)) {
        const v = query[k];
        if (v == null) continue;
        if (Array.isArray(v)) {
          for (let j = 0; j < v.length; j++) url.searchParams.append(k, String(v[j]));
        } else {
          url.searchParams.set(k, String(v));
        }
      }
    }
  }
}
