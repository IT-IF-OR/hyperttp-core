import type { Method, RequestBodyData } from "@hyperttp/types";

type NormalizedHeaders = Record<string, string | string[]>;

const SINGLE_VALUE_HEADERS: Record<string, 1> = Object.create(null);
const singleHeaders = [
  "content-type",
  "content-length",
  "content-encoding",
  "content-disposition",
  "host",
  "authorization",
  "proxy-authorization",
  "user-agent",
  "referer",
  "origin",
  "location",
  "etag",
  "last-modified",
] as const;

for (let i = 0; i < singleHeaders.length; i++) {
  SINGLE_VALUE_HEADERS[singleHeaders[i]!] = 1;
}

const HEADER_KEY_CACHE: Record<string, string> = Object.create(null);

const COMMON_HEADERS = [
  "accept",
  "accept-encoding",
  "accept-language",
  "authorization",
  "cache-control",
  "connection",
  "content-encoding",
  "content-length",
  "content-type",
  "cookie",
  "date",
  "etag",
  "host",
  "if-modified-since",
  "if-none-match",
  "keep-alive",
  "location",
  "origin",
  "pragma",
  "proxy-authorization",
  "referer",
  "sec-ch-ua",
  "server",
  "set-cookie",
  "transfer-encoding",
  "user-agent",
  "x-forwarded-for",
  "x-requested-with",
] as const;

for (let i = 0; i < COMMON_HEADERS.length; i++) {
  const lower = COMMON_HEADERS[i]!;
  HEADER_KEY_CACHE[lower] = lower;
}

function fastLowercaseKey(key: string): string {
  const cached = HEADER_KEY_CACHE[key];
  if (cached !== undefined) return cached;

  const lower = key.toLowerCase();
  HEADER_KEY_CACHE[key] = lower;
  return lower;
}

/**
 * @ru Извлекает URL из запроса (строка, объект с url/_url или схема+хост+путь).
 * @en Extracts the URL from a request (string, object with url/_url, or scheme+host+path).
 * @param req - URL string or request-like object.
 * @returns The extracted URL string.
 */
export function normalizeUrl(req: unknown): string {
  if (typeof req === "string") return req;

  if (req && typeof req === "object") {
    const r = req as Record<string, unknown>;

    const url = r.url;
    if (typeof url === "string") return url;
    if (url != null) return String(url);

    const u = r._url;
    if (typeof u === "string") return u;
    if (u != null) return String(u);

    const scheme = r.scheme;
    const host = r.host;
    const path = r.path;

    if (typeof scheme === "string" && typeof host === "string" && typeof path === "string") {
      return scheme + "://" + host + path;
    }
  }

  throw new Error("URL missing in request");
}

function hasNewline(str: string): boolean {
  const len = str.length;
  for (let i = 0; i < len; i++) {
    const code = str.charCodeAt(i);
    if (code === 10 || code === 13) return true;
  }
  return false;
}

function appendHeader(out: NormalizedHeaders, lowerKey: string, value: string): void {
  if (hasNewline(value)) {
    value = value.replace(/[\r\n]/g, "");
  }

  if (SINGLE_VALUE_HEADERS[lowerKey] === 1) {
    out[lowerKey] = value;
    return;
  }

  const existing = out[lowerKey];

  if (existing === undefined) {
    out[lowerKey] = lowerKey === "set-cookie" ? [value] : value;
    return;
  }

  if (lowerKey === "set-cookie") {
    if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[lowerKey] = [existing, value];
    }
    return;
  }

  if (lowerKey === "cookie" || lowerKey === "cookie2") {
    out[lowerKey] = existing + "; " + value;
    return;
  }

  out[lowerKey] = existing + ", " + value;
}

function appendRawValue(out: NormalizedHeaders, lower: string, raw: unknown): void {
  if (raw === undefined || raw === null) return;

  if (Array.isArray(raw)) {
    const len = raw.length;
    for (let i = 0; i < len; i++) {
      const item = raw[i];
      if (item !== undefined && item !== null) {
        appendHeader(out, lower, typeof item === "string" ? item : String(item));
      }
    }
    return;
  }

  appendHeader(out, lower, typeof raw === "string" ? raw : String(raw));
}

/**
 * @ru Нормализует заголовки в плоский объект с нижним регистром ключей и обработкой массива/парных форматов.
 * @en Normalizes headers into a flat object with lowercased keys, handling array/pair formats.
 * @param headers - Headers in any supported format (object, array of pairs, flat array).
 * @param out - Optional output object (reused for pooling).
 * @returns Normalized headers object.
 */
export function normalizeHeaders(headers: unknown, out: NormalizedHeaders = {}): NormalizedHeaders {
  if (!headers || typeof headers !== "object") return out;

  if (!Array.isArray(headers)) {
    for (const key in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, key)) {
        const val = (headers as Record<string, unknown>)[key];
        if (val !== undefined && val !== null) {
          appendRawValue(out, fastLowercaseKey(key), val);
        }
      }
    }
    return out;
  }

  const len = headers.length;
  if (len === 0) return out;

  if (Array.isArray(headers[0])) {
    for (let i = 0; i < len; i++) {
      const pair = headers[i];
      if (!Array.isArray(pair)) continue;

      const key = pair[0];
      if (typeof key !== "string" || key.length === 0) continue;

      const rawValue = pair[1];
      if (rawValue === undefined || rawValue === null) continue;

      appendHeader(
        out,
        fastLowercaseKey(key),
        typeof rawValue === "string" ? rawValue : String(rawValue),
      );
    }
  } else {
    for (let i = 0; i < len; i += 2) {
      const key = headers[i];
      if (typeof key !== "string" || key.length === 0) continue;

      const rawValue = headers[i + 1];
      if (rawValue === undefined || rawValue === null) continue;

      appendHeader(
        out,
        fastLowercaseKey(key),
        typeof rawValue === "string" ? rawValue : String(rawValue),
      );
    }
  }

  return out;
}

/**
 * @ru Возвращает undefined для GET/HEAD (тело запрещено), иначе тело как есть.
 * @en Returns undefined for GET/HEAD (body disallowed), otherwise the body as-is.
 * @param method - HTTP method.
 * @param body - Request body.
 * @returns Normalized body or undefined.
 */
export function normalizeBody(
  method: Method,
  body: RequestBodyData | undefined,
): RequestBodyData | undefined {
  return method === "GET" || method === "HEAD" ? undefined : body;
}

function getContentType(headers: Record<string, string | string[]>): string | undefined {
  const ct = headers["content-type"];
  if (typeof ct === "string") return ct;
  if (Array.isArray(ct)) return ct[0];
  return undefined;
}

/**
 * @ru Преобразует тело для транспорта: сериализует объекты в JSON, URLSearchParams в строку, проставляет Content-Type.
 * @en Transforms body for transport: serializes objects to JSON, URLSearchParams to string, sets Content-Type.
 * @param body - Request body.
 * @param headers - Headers object (may be mutated to add Content-Type).
 * @returns Body ready for transport.
 */
export function normalizeBodyForTransport(
  body: RequestBodyData,
  headers: Record<string, string | string[]>,
): RequestBodyData {
  if (body == null) return body;

  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    if (!getContentType(headers)) {
      headers["content-type"] = "application/x-www-form-urlencoded";
    }
    return body.toString();
  }

  const isSerializableObject =
    typeof body === "object" &&
    body !== null &&
    !(body instanceof Uint8Array) &&
    !(body instanceof ArrayBuffer) &&
    !(typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView?.(body)) &&
    !(typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) &&
    !(typeof FormData !== "undefined" && body instanceof FormData) &&
    !(typeof Blob !== "undefined" && body instanceof Blob) &&
    !(typeof ReadableStream !== "undefined" && body instanceof ReadableStream) &&
    !("pipe" in body && typeof (body as any).pipe === "function");

  if (isSerializableObject) {
    if (!getContentType(headers)) {
      headers["content-type"] = "application/json";
    }
    return JSON.stringify(body);
  }

  return body;
}
