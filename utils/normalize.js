/**
 * @ru Карта заголовков, которые должны содержать только одно значение (не массив).
 * Использует `Object.create(null)` для быстрого доступа без прототипа.
 * @en Map of headers that should contain only a single value (not an array).
 * Uses `Object.create(null)` for fast prototype-less access.
 */
const SINGLE_VALUE_HEADERS = Object.create(null);
for (const h of [
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
]) {
    SINGLE_VALUE_HEADERS[h] = 1;
}
/**
 * @ru Кэш нормализованных HTTP-методов для избежания повторных вызовов `toUpperCase()`.
 * @en Cache of normalized HTTP methods to avoid repeated `toUpperCase()` calls.
 */
const METHOD_CACHE = {
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
 * @ru Кэш для нормализации ключей заголовков (lowercase).
 * Ограничен размером HEADER_CACHE_LIMIT для предотвращения утечек памяти.
 * @en Cache for header key normalization (lowercase).
 * Limited by HEADER_CACHE_LIMIT to prevent memory leaks.
 */
const HEADER_CACHE_LIMIT = 2048;
const HEADER_KEY_CACHE = Object.create(null);
/**
 * @ru Список наиболее распространённых HTTP-заголовков для предзаполнения кэша.
 * @en List of most common HTTP headers for cache pre-population.
 */
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
];
for (let i = 0; i < COMMON_HEADERS.length; i++) {
    const lower = COMMON_HEADERS[i];
    HEADER_KEY_CACHE[lower] = lower;
}
let cacheSize = COMMON_HEADERS.length;
/**
 * @ru Быстрая нормализация ключа заголовка в нижний регистр с кэшированием.
 * @en Fast header key normalization to lowercase with caching.
 * @param key - The header key to normalize.
 * @returns The lowercase version of the key.
 */
function fastLowercaseKey(key) {
    const cached = HEADER_KEY_CACHE[key];
    if (cached !== undefined)
        return cached;
    const lower = key.toLowerCase();
    if (cacheSize < HEADER_CACHE_LIMIT) {
        HEADER_KEY_CACHE[key] = lower;
        cacheSize++;
    }
    return lower;
}
/**
 * @ru Нормализует HTTP-метод в верхний регистр с кэшированием.
 * @en Normalizes HTTP method to uppercase with caching.
 * @param method - The HTTP method string (e.g., 'get', 'POST').
 * @returns The normalized HTTP method in uppercase.
 */
export function normalizeMethod(method) {
    const cached = METHOD_CACHE[method];
    return cached !== undefined ? cached : method.toUpperCase();
}
/**
 * @ru Извлекает URL из объекта запроса или строки.
 * Поддерживает различные форматы: строка, объект с полем `url`, `_url`, или `scheme/host/path`.
 * @en Extracts URL from a request object or string.
 * Supports various formats: string, object with `url`, `_url`, or `scheme/host/path` fields.
 * @param req - The request object or URL string.
 * @returns The extracted URL string.
 * @throws Error if URL is missing in the request.
 */
export function normalizeUrl(req) {
    if (typeof req === "string")
        return req;
    if (req && typeof req === "object") {
        const r = req;
        const url = r.url;
        if (typeof url === "string")
            return url;
        if (url != null)
            return String(url);
        const u = r._url;
        if (typeof u === "string")
            return u;
        if (u != null)
            return String(u);
        const scheme = r.scheme;
        const host = r.host;
        const path = r.path;
        if (typeof scheme === "string" && typeof host === "string" && typeof path === "string") {
            return `${scheme}://${host}${path}`;
        }
    }
    throw new Error("URL missing in request");
}
/**
 * @ru Добавляет значение заголовка к нормализованному объекту заголовков.
 * Учитывает специальные правила для `set-cookie`, `cookie`, и других заголовков.
 * @en Appends a header value to the normalized headers object.
 * Accounts for special rules for `set-cookie`, `cookie`, and other headers.
 * @param out - The normalized headers object to modify.
 * @param lowerKey - The lowercase header key.
 * @param value - The header value to append.
 */
function appendHeader(out, lowerKey, value) {
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
        }
        else {
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
/**
 * @ru Добавляет сырое значение заголовка к нормализованному объекту.
 * Обрабатывает массивы значений и преобразует нестроковые значения в строки.
 * @en Appends a raw header value to the normalized headers object.
 * Handles arrays of values and converts non-string values to strings.
 * @param out - The normalized headers object to modify.
 * @param lower - The lowercase header key.
 * @param raw - The raw header value (string, array, or other).
 */
function appendRawValue(out, lower, raw) {
    if (raw === undefined || raw === null)
        return;
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
 * @ru Нормализует заголовки запроса в единый формат с ключами в нижнем регистре.
 * Поддерживает различные входные форматы: объект, массив пар, плоский массив.
 *
 * Специальные правила:
 * - `set-cookie` всегда хранится как массив
 * - `cookie`/`cookie2` объединяются через `; `
 * - Остальные множественные заголовки объединяются через `, `
 * - Заголовки из SINGLE_VALUE_HEADERS перезаписываются (не объединяются)
 *
 * @en Normalizes request headers into a unified format with lowercase keys.
 * Supports various input formats: object, array of pairs, flat array.
 *
 * Special rules:
 * - `set-cookie` is always stored as an array
 * - `cookie`/`cookie2` are joined with `; `
 * - Other multiple headers are joined with `, `
 * - Headers from SINGLE_VALUE_HEADERS are overwritten (not merged)
 *
 * @param headers - The headers to normalize (object, array of pairs, or flat array).
 * @returns Normalized headers object with lowercase keys.
 */
export function normalizeHeaders(headers) {
    const out = Object.create(null);
    if (!headers || typeof headers !== "object")
        return out;
    if (!Array.isArray(headers)) {
        for (const key in headers) {
            const val = headers[key];
            if (val !== undefined && val !== null) {
                appendRawValue(out, fastLowercaseKey(key), val);
            }
        }
        return out;
    }
    const len = headers.length;
    if (len === 0)
        return out;
    if (Array.isArray(headers[0])) {
        for (let i = 0; i < len; i++) {
            const pair = headers[i];
            if (!Array.isArray(pair))
                continue;
            const key = pair[0];
            if (typeof key !== "string" || key.length === 0)
                continue;
            const rawValue = pair[1];
            if (rawValue === undefined || rawValue === null)
                continue;
            appendHeader(out, fastLowercaseKey(key), typeof rawValue === "string" ? rawValue : String(rawValue));
        }
    }
    else {
        for (let i = 0; i < len; i += 2) {
            const key = headers[i];
            if (typeof key !== "string" || key.length === 0)
                continue;
            const rawValue = headers[i + 1];
            if (rawValue === undefined || rawValue === null)
                continue;
            appendHeader(out, fastLowercaseKey(key), typeof rawValue === "string" ? rawValue : String(rawValue));
        }
    }
    return out;
}
/**
 * @ru Нормализует тело запроса, удаляя его для методов GET и HEAD.
 * @en Normalizes request body by removing it for GET and HEAD methods.
 * @param method - The HTTP method.
 * @param body - The request body data.
 * @returns The body for methods that support it, or undefined for GET/HEAD.
 */
export function normalizeBody(method, body) {
    return method === "GET" || method === "HEAD" ? undefined : body;
}
//# sourceMappingURL=normalize.js.map