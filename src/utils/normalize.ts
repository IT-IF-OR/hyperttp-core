import type { Method, RequestBodyData } from "@hyperttp/types";

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
 * @ru Нормализует строку HTTP-метода в стандартную заглавную форму (например, "get" → "GET").
 * @en Normalizes an HTTP method string to its standard uppercase form (e.g., "get" → "GET").
 * @param method - Raw method string.
 * @returns Normalized method (e.g., "GET", "POST", etc.).
 */
export function normalizeMethod(method: string): Method {
  const cached = METHOD_CACHE[method];
  return cached !== undefined ? cached : (method.toUpperCase() as Method);
}

/**
 * @ru Извлекает и нормализует URL из строки или объекта запроса (поддерживает поля url, _url, или комбинацию scheme/host/path).
 * @en Extracts and normalizes a URL from a string or request object (supports url, _url fields, or scheme/host/path combination).
 * @param req - Request object or plain URL string.
 * @returns Normalized URL string.
 * @throws If URL cannot be determined.
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
 * @ru Вспомогательная функция для добавления заголовка в результирующий объект с учётом правил объединения (одиночные, множественные, cookie, set-cookie).
 * @en Helper function to append a header to the result object, respecting merging rules (single-value, multi-value, cookie, set-cookie).
 * @param out - Target object accumulating headers.
 * @param lowerKey - Header name in lower case.
 * @param value - Header value as a string.
 */
function appendHeader(
  out: Record<string, string | string[]>,
  lowerKey: string,
  value: string,
): void {
  if (SINGLE_VALUE_HEADERS[lowerKey] !== undefined) {
    out[lowerKey] = value;
    return;
  }

  const existing = out[lowerKey];
  if (existing === undefined) {
    out[lowerKey] = value;
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
    out[lowerKey] = `${existing}; ${value}`;
    return;
  }

  out[lowerKey] = `${existing}, ${value}`;
}

/**
 * @ru Нормализует входные заголовки (объект, массив пар) в стандартный объект с ключами в нижнем регистре и правильным объединением значений.
 * @en Normalizes input headers (object, array of pairs) into a standard object with lower‑case keys and proper value merging.
 * @param headers - Raw headers (plain object, array of [key, value] pairs, or null/undefined).
 * @returns Normalized headers object (keys are lower‑case, values are strings or arrays for set-cookie).
 */
export function normalizeHeaders(
  headers: unknown,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = Object.create(null);
  if (!headers || typeof headers !== "object") return out;

  if (Array.isArray(headers)) {
    const len = headers.length;
    for (let i = 0; i < len; i += 2) {
      const key = headers[i];
      if (typeof key !== "string" || !key) continue;
      const rawValue = headers[i + 1];
      if (rawValue === undefined || rawValue === null) continue;

      appendHeader(
        out,
        key.toLowerCase(),
        typeof rawValue === "string" ? rawValue : String(rawValue),
      );
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
        const vLen = val.length;
        for (let i = 0; i < vLen; i++) {
          const rawValue = val[i];
          if (rawValue !== undefined && rawValue !== null) {
            appendHeader(
              out,
              lower,
              typeof rawValue === "string" ? rawValue : String(rawValue),
            );
          }
        }
      } else {
        appendHeader(out, lower, typeof val === "string" ? val : String(val));
      }
    }
  }

  return out;
}

/**
 * @ru Возвращает тело запроса только для методов, поддерживающих тело (не GET/HEAD), иначе undefined.
 * @en Returns the request body only for methods that support a body (not GET/HEAD), otherwise undefined.
 * @param method - HTTP method.
 * @param body - Original request body (if any).
 * @returns The body for allowed methods, or undefined for GET/HEAD.
 */
export function normalizeBody(
  method: Method,
  body: RequestBodyData | undefined,
): RequestBodyData | undefined {
  return method === "GET" || method === "HEAD" ? undefined : body;
}
