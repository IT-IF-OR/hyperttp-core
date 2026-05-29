const DEFAULT_RETRY_STATUS_CODES = [502, 503, 504];
export function calcDelay(attempt, retryOptions) {
    const { baseDelay = 1000, maxDelay = 10000, jitter = true } = retryOptions;
    const base = Math.min(baseDelay * 2 ** attempt, maxDelay);
    return jitter ? base * (0.75 + Math.random() * 0.5) : base;
}
export async function drainBody(body) {
    if (!body || typeof body !== "object")
        return;
    try {
        const stream = body;
        if (typeof stream.dump === "function") {
            await stream.dump();
            return;
        }
        if (typeof stream.resume === "function") {
            stream.resume();
            return;
        }
        if (typeof stream.destroy === "function") {
            stream.destroy();
        }
    }
    catch {
        //
    }
}
export function shouldRetry(status, retryOptions) {
    const codes = retryOptions.retryStatusCodes;
    if (codes && codes.length > 0) {
        return codes.includes(status);
    }
    return DEFAULT_RETRY_STATUS_CODES.includes(status);
}
//# sourceMappingURL=retryUtils.js.map