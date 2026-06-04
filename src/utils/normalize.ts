import type { Method, RequestBodyData } from "@hyperttp/types";

export type NormalizedBody =
  | string
  | Uint8Array
  | ArrayBuffer
  | FormData
  | URLSearchParams
  | ReadableStream
  | Blob
  | null
  | undefined;

/**
 * @ru Множество заголовков, которые должны иметь только одно значение (не объединяются при повторении).
 * @en Set of headers that should have only a single value (not merged when repeated).
 */
const SINGLE_VALUE_HEADERS: Record<string, boolean> = Object.create(null);
const svh = [
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
];
for (let i = 0; i < svh.length; i++) {
  SINGLE_VALUE_HEADERS[svh[i]!] = true;
}

/**
 * @ru Кэш нормализованных методов HTTP для быстрого доступа.
 * @en Cache of normalized HTTP methods for fast lookup.
 */
const METHOD_CACHE: Record<string, Method> = {
  get: "GET",
  GET: "GET",
  post: "POST",
  POST: "POST",
  put: "PUT",
  PUT: "PUT",
  delete: "DELETE",
  DELETE: "DELETE",
  patch: "PATCH",
  PATCH: "PATCH",
  head: "HEAD",
  HEAD: "HEAD",
  options: "OPTIONS",
  OPTIONS: "OPTIONS",
};

/**
 * @ru Нормализует метод HTTP: приводит к верхнему регистру, использует кэш для часто встречающихся методов.
 * @en Normalizes an HTTP method: converts to uppercase, uses cache for common methods.
 * @param method - Raw method string (e.g., 'get', 'POST').
 * @returns Normalized uppercase method.
 */
export function normalizeMethod(method: string): Method {
  const cached = METHOD_CACHE[method];
  if (cached !== undefined) return cached;
  return method.toUpperCase() as Method;
}

/**
 * @ru Извлекает URL из объекта запроса или строки. Поддерживает поля url, _url, или комбинацию scheme/host/path.
 * @en Extracts a URL from a request object or string. Supports url, _url fields, or scheme/host/path combination.
 * @param req - Request object or URL string.
 * @returns Normalized URL string.
 * @throws If URL cannot be resolved.
 */
export function normalizeUrl(req: any): string {
  if (typeof req === "string") return req;

  if (req.url) return typeof req.url === "string" ? req.url : String(req.url);
  if (req._url)
    return typeof req._url === "string" ? req._url : String(req._url);

  if (req.scheme && req.host && req.path) {
    return `${req.scheme}://${req.host}${req.path}`;
  }

  throw new Error("URL missing in request");
}

/**
 * @ru Нормализует заголовки из различных форматов (массив, объект) в единый объект с правильной обработкой множественных значений (cookie, set-cookie).
 * @en Normalizes headers from various formats (array, object) into a single object with proper handling of multi-value headers (cookie, set-cookie).
 * @param headers - Raw headers in array or object format.
 * @returns Normalized headers object where values are strings or arrays of strings (for set-cookie).
 */
export function normalizeHeaders(
  headers: unknown,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = Object.create(null);

  if (!headers || typeof headers !== "object") return out;

  if (Array.isArray(headers)) {
    for (let i = 0; i < headers.length; i += 2) {
      const key = headers[i];
      if (typeof key !== "string" || !key) continue;
      const rawValue = headers[i + 1];
      if (rawValue === undefined || rawValue === null) continue;

      const lower = key.toLowerCase();
      const value = typeof rawValue === "string" ? rawValue : String(rawValue);

      if (SINGLE_VALUE_HEADERS[lower] !== undefined) {
        out[lower] = value;
        continue;
      }

      const existing = out[lower];
      if (existing === undefined) {
        out[lower] = value;
        continue;
      }

      if (lower === "set-cookie") {
        if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          out[lower] = [existing, value];
        }
        continue;
      }

      if (lower === "cookie" || lower === "cookie2") {
        out[lower] = `${existing}; ${value}`;
        continue;
      }

      out[lower] = Array.isArray(existing)
        ? `${existing.join(", ")}, ${value}`
        : `${existing}, ${value}`;
    }
    return out;
  }

  const headerObj = headers as Record<string, unknown>;
  for (const key in headerObj) {
    if (Object.prototype.hasOwnProperty.call(headerObj, key)) {
      const val = headerObj[key];
      if (val === undefined || val === null) continue;

      const lower = key.toLowerCase();

      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          const rawValue = val[i];
          if (rawValue === undefined || rawValue === null) continue;
          const value =
            typeof rawValue === "string" ? rawValue : String(rawValue);

          if (SINGLE_VALUE_HEADERS[lower] !== undefined) {
            out[lower] = value;
            continue;
          }

          const existing = out[lower];
          if (existing === undefined) {
            out[lower] = value;
            continue;
          }

          if (lower === "set-cookie") {
            if (Array.isArray(existing)) {
              existing.push(value);
            } else {
              out[lower] = [existing, value];
            }
            continue;
          }

          if (lower === "cookie" || lower === "cookie2") {
            out[lower] = `${existing}; ${value}`;
            continue;
          }

          out[lower] = Array.isArray(existing)
            ? `${existing.join(", ")}, ${value}`
            : `${existing}, ${value}`;
        }
      } else {
        const value = typeof val === "string" ? val : String(val);

        if (SINGLE_VALUE_HEADERS[lower] !== undefined) {
          out[lower] = value;
          continue;
        }

        const existing = out[lower];
        if (existing === undefined) {
          out[lower] = value;
          continue;
        }

        if (lower === "set-cookie") {
          if (Array.isArray(existing)) {
            existing.push(value);
          } else {
            out[lower] = [existing, value];
          }
          continue;
        }

        if (lower === "cookie" || lower === "cookie2") {
          out[lower] = `${existing}; ${value}`;
          continue;
        }

        out[lower] = Array.isArray(existing)
          ? `${existing.join(", ")}, ${value}`
          : `${existing}, ${value}`;
      }
    }
  }

  return out;
}

/**
 * @ru Нормализует тело запроса: для методов GET и HEAD тело всегда undefined, для остальных возвращает переданное тело.
 * @en Normalizes request body: for GET and HEAD methods body is always undefined, for others returns the provided body.
 * @param method - HTTP method.
 * @param body - Raw request body.
 * @returns Normalized body or undefined.
 */
export function normalizeBody(
  method: Method,
  body: RequestBodyData | undefined,
): RequestBodyData | undefined {
  if (method === "GET" || method === "HEAD") {
    return undefined;
  }
  return body ?? undefined;
}
