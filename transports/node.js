import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { ReadableStream } from "node:stream/web";
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_RETRY_STATUS_CODES = [502, 503, 504];
const RETRYABLE_NETWORK_CODES = [
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ECONNRESET",
    "EPIPE",
];
export function isRedirect(status) {
    return REDIRECT_STATUS_CODES.has(status);
}
export function shouldRetry(status, retryOptions) {
    const codes = retryOptions.retryStatusCodes;
    if (codes && codes.length > 0) {
        return codes.includes(status);
    }
    return DEFAULT_RETRY_STATUS_CODES.includes(status);
}
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export function calcDelay(attempt, retryOptions) {
    const { baseDelay = 1000, maxDelay = 10000, jitter = true } = retryOptions;
    const base = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    return jitter ? base * (0.75 + Math.random() * 0.5) : base;
}
class NodeTransportResponse {
    status;
    headers;
    url;
    baseUrl;
    _decodedStream;
    _cachedBuffer;
    _cachedText;
    _cachedJson;
    _cachedJsonReady = false;
    _cachedWebStream;
    constructor(status, headers, url, rawStream) {
        this.status = status;
        this.headers = headers;
        this.url = url;
        this.baseUrl = url;
        let stream = rawStream;
        const contentEncoding = headers["content-encoding"];
        if (typeof contentEncoding === "string") {
            const encoding = contentEncoding.toLowerCase();
            if (encoding.includes("gzip")) {
                stream = stream.pipe(zlib.createGunzip());
            }
            else if (encoding.includes("deflate")) {
                stream = stream.pipe(zlib.createInflate());
            }
            else if (encoding.includes("br")) {
                stream = stream.pipe(zlib.createBrotliDecompress());
            }
        }
        this._decodedStream = stream;
    }
    get body() {
        if (!this._cachedWebStream) {
            let webStream;
            if (this._cachedBuffer) {
                const buf = this._cachedBuffer;
                webStream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
                        controller.close();
                    },
                });
            }
            else {
                webStream = Readable.toWeb(this._decodedStream);
            }
            Object.defineProperty(webStream, "dump", {
                value: () => this.dump(),
                writable: false,
                enumerable: false,
                configurable: true,
            });
            this._cachedWebStream = webStream;
        }
        return this._cachedWebStream;
    }
    async _getBuffer() {
        if (this._cachedBuffer)
            return this._cachedBuffer;
        if (this._cachedWebStream) {
            const reader = this._cachedWebStream.getReader();
            const chunks = [];
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                if (value)
                    chunks.push(value);
            }
            let totalLength = 0;
            for (const chunk of chunks)
                totalLength += chunk.byteLength;
            const merged = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                merged.set(chunk, offset);
                offset += chunk.byteLength;
            }
            this._cachedBuffer = Buffer.from(merged.buffer, merged.byteOffset, merged.byteLength);
            return this._cachedBuffer;
        }
        return new Promise((resolve, reject) => {
            const chunks = [];
            const onData = (chunk) => {
                chunks.push(chunk);
            };
            const onEnd = () => {
                cleanup();
                this._cachedBuffer = Buffer.concat(chunks);
                resolve(this._cachedBuffer);
            };
            const onError = (err) => {
                cleanup();
                reject(err);
            };
            const cleanup = () => {
                this._decodedStream.removeListener("data", onData);
                this._decodedStream.removeListener("end", onEnd);
                this._decodedStream.removeListener("error", onError);
            };
            this._decodedStream.on("data", onData);
            this._decodedStream.on("end", onEnd);
            this._decodedStream.on("error", onError);
        });
    }
    async text() {
        if (this._cachedText === undefined) {
            const buf = await this._getBuffer();
            this._cachedText = buf.toString("utf-8");
        }
        return this._cachedText;
    }
    async json() {
        if (this._cachedJsonReady) {
            return this._cachedJson;
        }
        const text = await this.text();
        if (!text.trim()) {
            this._cachedJson = null;
            this._cachedJsonReady = true;
            return null;
        }
        this._cachedJson = JSON.parse(text);
        this._cachedJsonReady = true;
        return this._cachedJson;
    }
    async dump() {
        if (this._cachedBuffer)
            return;
        this._decodedStream.resume();
    }
}
export class NodeTransport {
    config;
    httpAgent;
    httpsAgent;
    constructor(config) {
        this.config = config;
        const agentOptions = {
            keepAlive: true,
            keepAliveMsecs: config.network?.keepAliveTimeout ?? 30000,
            maxSockets: config.network?.maxConcurrent ?? 500,
            maxFreeSockets: Math.min(256, Math.floor((config.network?.maxConcurrent ?? 500) / 2)),
            scheduling: "lifo",
        };
        this.httpAgent = new http.Agent(agentOptions);
        this.httpsAgent = new https.Agent(agentOptions);
    }
    get timeout() {
        return this.config.network?.timeout ?? 30000;
    }
    logRetry(reason, attempt, maxRetries) {
        this.config.logger?.("warn", `Retrying request: ${reason}. Attempt ${attempt}/${maxRetries}`);
    }
    async execute(req) {
        let currentUrl = req.url;
        let currentMethod = req.method;
        let currentHeaders = { ...req.headers };
        let currentBody = req.body;
        let redirects = 0;
        const startTime = Date.now();
        let attempt = 1;
        const maxRedirects = this.config.network?.maxRedirects ?? 5;
        const maxRetries = this.config.retry?.maxRetries ?? 3;
        const isStreamBody = currentBody instanceof ReadableStream;
        while (true) {
            try {
                const fullUrl = new URL(currentUrl);
                const result = await this.dispatchOnce(fullUrl, {
                    method: currentMethod,
                    headers: currentHeaders,
                    body: currentBody,
                    externalSignal: req.signal,
                    timeoutMs: this.timeout,
                });
                if ((this.config.network?.followRedirects ?? true) &&
                    isRedirect(result.status)) {
                    result.body.resume();
                    if (redirects >= maxRedirects) {
                        throw new Error("Too many redirects");
                    }
                    const location = result.headers["location"];
                    const locationStr = Array.isArray(location) ? location[0] : location;
                    if (typeof locationStr !== "string") {
                        throw new Error("Invalid redirect location");
                    }
                    const nextUrl = new URL(locationStr, fullUrl.toString()).toString();
                    let nextMethod = currentMethod;
                    if (result.status === 303 ||
                        ((result.status === 301 || result.status === 302) &&
                            currentMethod === "POST")) {
                        nextMethod = "GET";
                    }
                    currentUrl = nextUrl;
                    currentMethod = nextMethod;
                    currentBody =
                        nextMethod === "GET" || isStreamBody ? undefined : currentBody;
                    const nextHeaders = { ...currentHeaders };
                    if (nextMethod === "GET") {
                        delete nextHeaders["content-type"];
                        delete nextHeaders["content-length"];
                    }
                    currentHeaders = nextHeaders;
                    redirects += 1;
                    continue;
                }
                if (!isStreamBody &&
                    shouldRetry(result.status, this.config.retry ?? {})) {
                    if (attempt < maxRetries) {
                        result.body.resume();
                        await sleep(calcDelay(attempt, this.config.retry ?? {}));
                        attempt += 1;
                        continue;
                    }
                }
                return new NodeTransportResponse(result.status, result.headers, fullUrl.toString(), result.body);
            }
            catch (err) {
                const error = err;
                if (error.name === "AbortError") {
                    if (req.signal?.aborted) {
                        throw error;
                    }
                    const msg = `Request timeout after ${this.timeout}ms`;
                    this.config.logger?.("error", msg);
                    const timeoutErr = new Error(msg);
                    timeoutErr.name = "AbortError";
                    timeoutErr.code = "TIMEOUT";
                    timeoutErr.request = {
                        url: req.url,
                        method: req.method,
                        headers: req.headers,
                    };
                    timeoutErr.meta = {
                        retryCount: attempt - 1,
                        isRetryable: false,
                        duration: Date.now() - startTime,
                    };
                    throw timeoutErr;
                }
                if (!isStreamBody &&
                    attempt < maxRetries &&
                    error.code &&
                    RETRYABLE_NETWORK_CODES.includes(error.code)) {
                    this.logRetry(`due to ${error.code}`, attempt, maxRetries);
                    await sleep(calcDelay(attempt, this.config.retry ?? {}));
                    attempt += 1;
                    continue;
                }
                error.code = error.code ?? "NETWORK_ERROR";
                error.request = {
                    url: req.url,
                    method: req.method,
                    headers: req.headers,
                };
                error.meta = {
                    retryCount: attempt - 1,
                    isRetryable: false,
                    duration: Date.now() - startTime,
                };
                throw error;
            }
        }
    }
    dispatchOnce(url, options) {
        return new Promise((resolve, reject) => {
            const isHttps = url.protocol === "https:";
            const requestFn = isHttps ? https.request : http.request;
            const agent = isHttps ? this.httpsAgent : this.httpAgent;
            let isDone = false;
            let timer;
            const reqOptions = {
                method: options.method,
                headers: options.headers,
                agent,
            };
            if (options.externalSignal?.aborted) {
                const abortError = new Error("The operation was aborted.");
                abortError.name = "AbortError";
                return reject(abortError);
            }
            const req = requestFn(url, reqOptions, (res) => {
                if (timer)
                    clearTimeout(timer);
                cleanupExternalSignal();
                isDone = true;
                resolve({
                    status: res.statusCode ?? 200,
                    headers: res.headers,
                    body: res,
                });
            });
            if (options.timeoutMs > 0) {
                timer = setTimeout(() => {
                    if (isDone)
                        return;
                    isDone = true;
                    cleanupExternalSignal();
                    req.destroy();
                    const err = new Error("The operation was aborted.");
                    err.name = "AbortError";
                    reject(err);
                }, options.timeoutMs);
            }
            let onExternalAbort;
            if (options.externalSignal) {
                onExternalAbort = () => {
                    if (isDone)
                        return;
                    isDone = true;
                    if (timer)
                        clearTimeout(timer);
                    req.destroy();
                    const err = new Error("The operation was aborted.");
                    err.name = "AbortError";
                    reject(err);
                };
                options.externalSignal.addEventListener("abort", onExternalAbort, {
                    once: true,
                });
            }
            function cleanupExternalSignal() {
                if (options.externalSignal && onExternalAbort) {
                    options.externalSignal.removeEventListener("abort", onExternalAbort);
                }
            }
            req.on("error", (err) => {
                if (isDone)
                    return;
                isDone = true;
                if (timer)
                    clearTimeout(timer);
                cleanupExternalSignal();
                reject(err);
            });
            if (options.body !== undefined && options.body !== null) {
                if (Buffer.isBuffer(options.body) || typeof options.body === "string") {
                    req.end(options.body);
                }
                else if (options.body instanceof ReadableStream) {
                    Readable.fromWeb(options.body).pipe(req);
                }
                else {
                    req.end(JSON.stringify(options.body));
                }
            }
            else {
                req.end();
            }
        });
    }
    async close() {
        this.httpAgent.destroy();
        this.httpsAgent.destroy();
    }
    async destroy() {
        await this.close();
    }
}
//# sourceMappingURL=node.js.map