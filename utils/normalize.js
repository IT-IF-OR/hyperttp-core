const SINGLE_VALUE_HEADERS = new Set([
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
]);
const MULTI_VALUE_HEADERS = new Set([
    "set-cookie",
    "accept",
    "accept-encoding",
    "accept-language",
    "cache-control",
    "pragma",
    "vary",
    "warning",
    "www-authenticate",
    "proxy-authenticate",
]);
export function normalizeHeaders(headers) {
    const out = Object.create(null);
    if (!headers)
        return out;
    const appendHeader = (key, rawValue) => {
        const lower = key.toLowerCase();
        if (!lower)
            return;
        if (rawValue === undefined || rawValue === null)
            return;
        const value = typeof rawValue === "string" ? rawValue : String(rawValue);
        if (SINGLE_VALUE_HEADERS.has(lower)) {
            out[lower] = value;
            return;
        }
        const existing = out[lower];
        if (existing === undefined) {
            out[lower] = value;
            return;
        }
        if (lower === "cookie" || lower === "cookie2") {
            out[lower] = `${existing}; ${value}`;
            return;
        }
        if (lower === "set-cookie") {
            out[lower] = `${existing}\n${value}`;
            return;
        }
        if (MULTI_VALUE_HEADERS.has(lower)) {
            out[lower] = `${existing}, ${value}`;
            return;
        }
        out[lower] = value;
    };
    if (Array.isArray(headers)) {
        for (let i = 0; i < headers.length; i += 2) {
            const key = headers[i];
            const value = headers[i + 1];
            if (typeof key !== "string" || !key)
                continue;
            appendHeader(key, value);
        }
        return out;
    }
    const headerObj = headers;
    for (const [key, val] of Object.entries(headerObj)) {
        if (val === undefined)
            continue;
        if (Array.isArray(val)) {
            for (const item of val)
                appendHeader(key, item);
        }
        else {
            appendHeader(key, val);
        }
    }
    return out;
}
export function normalizeMethod(method) {
    return method.toUpperCase();
}
export function normalizeBody(method, body) {
    const upper = method.toUpperCase();
    if (upper === "GET" || upper === "HEAD") {
        return undefined;
    }
    return body ?? undefined;
}
//# sourceMappingURL=normalize.js.map