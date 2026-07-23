import type {
  HttpClientOptions,
  InternalRequest,
  RequestInterface,
  RequestBodyData,
  Method,
  ResponseType,
} from "@hyperttp/types";
import { CacheManager } from "hcacher";
import { normalizeBody, normalizeUrl } from "../utils/normalize.js";
import { mergeHeadersFast } from "../utils/response.js";

/**
 * @ru Создаёт AbortSignal с тайм-аутом и привязкой к пользовательскому сигналу отмены.
 * @en Creates an AbortSignal with timeout and user abort signal binding.
 * @param userSignal - Optional external abort signal.
 * @param timeoutMs - Timeout in milliseconds.
 * @param meta - Metadata object receiving cleanup function.
 * @returns AbortSignal bound to the timeout and user signal.
 */
function createTimeoutSignal(
  userSignal: AbortSignal | undefined,
  timeoutMs: number,
  meta: any,
): AbortSignal {
  const controller = new AbortController();

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;

    if (userSignal) {
      userSignal.removeEventListener("abort", onUserAbort);
    }
    clearTimeout(timeoutId);
  };

  const timeoutId = setTimeout(() => {
    (controller.signal as any).isTimeout = true;
    controller.abort(new DOMException("Timeout", "TimeoutError"));
    cleanup();
  }, timeoutMs);

  const onUserAbort = () => {
    controller.abort(userSignal?.reason);
    cleanup();
  };

  if (userSignal) {
    if (userSignal.aborted) {
      onUserAbort();
    } else {
      userSignal.addEventListener("abort", onUserAbort);
    }
  }

  meta.cleanupSignal = cleanup;

  return controller.signal;
}

/**
 * @ru Применяет тайм-аут к сигналу отмены.
 * @en Applies a timeout to the abort signal.
 * @param signal - Optional external abort signal.
 * @param timeout - Timeout in milliseconds (skip if null/<=0).
 * @param meta - Metadata object receiving cleanup function.
 * @returns New abort signal with timeout, or the original signal.
 */
function applyTimeout(
  signal: AbortSignal | undefined,
  timeout: number | undefined,
  meta: any,
): AbortSignal | undefined {
  if (timeout == null || timeout <= 0) return signal;
  return createTimeoutSignal(signal, timeout, meta);
}

export class RequestBuilder {
  private readonly urlCache = new CacheManager<string>({ maxSize: 512, ttl: 60_000 });

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
      cleanupSignal?: () => void;
    };

    if (typeof req === "string") {
      internalReq.method = method;
      internalReq.url = this.resolveUrl(req, config.baseURL);

      if (body !== undefined) {
        internalReq.headers = Object.assign({}, defaultHeaders);
      } else {
        internalReq.headers = defaultHeaders;
      }

      internalReq.body = body !== undefined ? normalizeBody(method, body) : undefined;
      internalReq.signal = applyTimeout(signal, config.network?.timeout, metaObj);
      metaObj.responseType = responseType;
      internalReq.stealth = config.network?.stealth;
      return internalReq;
    }

    const rawUrl = normalizeUrl(req);
    if (!rawUrl) throw new Error(`[HyperCore] URL is undefined for ${method}`);

    let finalUrl: string;

    if (req.query) {
      const cacheKey = rawUrl + "_base";
      let baseUrl = this.urlCache.get(cacheKey);

      if (!baseUrl) {
        baseUrl = config.baseURL ? new URL(rawUrl, config.baseURL).href : new URL(rawUrl).href;
        this.urlCache.set(cacheKey, baseUrl);
      }

      finalUrl = this.appendQueryString(baseUrl, req.query);
    } else {
      let cachedUrl = this.urlCache.get(rawUrl);
      if (!cachedUrl) {
        cachedUrl = config.baseURL ? new URL(rawUrl, config.baseURL).href : new URL(rawUrl).href;
        this.urlCache.set(rawUrl, cachedUrl);
      }
      finalUrl = cachedUrl;
    }

    internalReq.method = method;
    internalReq.url = finalUrl;

    const finalBody = req.body ?? body;

    if (req.headers || finalBody !== undefined) {
      const targetHeaders = Object.assign({}, defaultHeaders);
      internalReq.headers = req.headers
        ? mergeHeadersFast(targetHeaders, req.headers)
        : targetHeaders;
    } else {
      internalReq.headers = defaultHeaders;
    }

    internalReq.body = normalizeBody(method, finalBody);
    internalReq.signal = applyTimeout(req.signal ?? signal, config.network?.timeout, metaObj);

    metaObj.responseType =
      responseType ?? (req.meta as { responseType?: ResponseType })?.responseType;

    if (req.stealth) {
      if (config.network?.stealth) {
        const nextStealth = Object.assign({}, config.network.stealth, req.stealth);
        internalReq.stealth = nextStealth;
      } else {
        internalReq.stealth = req.stealth;
      }
    } else {
      internalReq.stealth = config.network?.stealth;
    }

    return internalReq;
  }

  public resolveUrl(url: string, baseURL?: string): string {
    if (!url) throw new Error("[HyperCore] URL is undefined");

    let finalUrl = this.urlCache.get(url);
    if (finalUrl) return finalUrl;

    const isAbsolute = url.startsWith("http://") || url.startsWith("https://");
    if (isAbsolute && !url.includes("?")) {
      finalUrl = url;
    } else {
      finalUrl = baseURL ? new URL(url, baseURL).href : new URL(url).href;
    }

    this.urlCache.set(url, finalUrl);
    return finalUrl;
  }

  private appendQueryString(baseUrl: string, query: Record<string, unknown>): string {
    let qs = "";
    for (const k in query) {
      if (!Object.prototype.hasOwnProperty.call(query, k)) continue;
      const v = query[k];
      if (v == null) continue;
      if (Array.isArray(v)) {
        for (let j = 0; j < v.length; j++) {
          if (qs) qs += "&";
          qs += encodeURIComponent(k) + "=" + encodeURIComponent(String(v[j]));
        }
      } else {
        if (qs) qs += "&";
        qs += encodeURIComponent(k) + "=" + encodeURIComponent(String(v));
      }
    }
    if (!qs) return baseUrl;
    return baseUrl + (baseUrl.includes("?") ? "&" : "?") + qs;
  }
}
