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
    controller.abort(new DOMException("Timeout", "TimeoutError"));
    cleanup();
  }, timeoutMs);

  const onUserAbort = () => {
    controller.abort(userSignal?.reason);
    cleanup();
  };

  if (userSignal) {
    userSignal.addEventListener("abort", onUserAbort);
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

/**
 * @ru Строитель внутренних запросов с кэшированием URL и пулом объектов.
 * @en Internal request builder with URL caching and object pooling.
 */
export class RequestBuilder {
  private readonly urlCache = new CacheManager<string>({ maxSize: 512, ttl: 60_000 });

  /**
   * @ru Собирает InternalRequest из публичного API-вызова, переиспользуя пулированный объект.
   * @en Builds an InternalRequest from a public API call, reusing a pooled object.
   * @param method - HTTP method.
   * @param req - URL string or RequestInterface object.
   * @param body - Optional request body.
   * @param signal - Optional abort signal.
   * @param responseType - Response type hint ("stream" or undefined).
   * @param defaultHeaders - Default headers to apply.
   * @param config - Client configuration.
   * @param pooled - Optional pre-allocated InternalRequest to reuse.
   * @returns The built InternalRequest.
   */
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
        internalReq.headers = Object.create(null);
        for (const k in defaultHeaders) {
          internalReq.headers[k] = defaultHeaders[k]!;
        }
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

      const urlObj = new URL(baseUrl);
      this.appendQueryParams(urlObj, req.query);
      finalUrl = urlObj.href;
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

    if (req.headers) {
      const targetHeaders = Object.create(null);
      for (const k in defaultHeaders) {
        targetHeaders[k] = defaultHeaders[k]!;
      }
      internalReq.headers = mergeHeadersFast(targetHeaders, req.headers);
    } else {
      internalReq.headers = defaultHeaders;
    }

    internalReq.body = normalizeBody(method, req.body ?? body);
    internalReq.signal = applyTimeout(req.signal ?? signal, config.network?.timeout, metaObj);

    metaObj.responseType =
      responseType ?? (req.meta as { responseType?: ResponseType })?.responseType;

    if (req.stealth) {
      if (config.network?.stealth) {
        const nextStealth = Object.create(null);
        for (const k in config.network.stealth) {
          nextStealth[k] = (config.network.stealth as any)[k];
        }
        for (const k in req.stealth) {
          nextStealth[k] = (req.stealth as any)[k];
        }
        internalReq.stealth = nextStealth;
      } else {
        internalReq.stealth = req.stealth;
      }
    } else {
      internalReq.stealth = config.network?.stealth;
    }

    return internalReq;
  }

  /**
   * @ru Разрешает URL относительно baseURL с кэшированием результата.
   * @en Resolves a URL against baseURL with result caching.
   * @param url - URL to resolve (absolute or relative).
   * @param baseURL - Optional base URL.
   * @returns The resolved absolute URL.
   */
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
