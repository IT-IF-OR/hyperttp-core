import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import type {
  HttpClientOptions,
  HyperTransport,
  RetryOptions,
  TransportRequest,
  TransportResponse,
  TransportResponsePayload,
} from "@hyperttp/types";

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_RETRY_STATUS_CODES = [502, 503, 504];

export function isRedirect(status: number): boolean {
  return REDIRECT_STATUS_CODES.has(status);
}

export function combineSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal?: AbortSignal;
  cancelTimer: () => void;
  isTimeoutAbort: () => boolean;
} {
  if (timeoutMs <= 0) {
    return {
      signal,
      cancelTimer: () => {},
      isTimeoutAbort: () => false,
    };
  }

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

  let combinedSignal: AbortSignal;
  if (signal) {
    if (typeof AbortSignal.any === "function") {
      combinedSignal = AbortSignal.any([signal, timeoutController.signal]);
    } else {
      const onAbort = () => timeoutController.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      combinedSignal = timeoutController.signal;
    }
  } else {
    combinedSignal = timeoutController.signal;
  }

  return {
    signal: combinedSignal,
    cancelTimer: () => clearTimeout(timer),
    isTimeoutAbort: () => timeoutController.signal.aborted,
  };
}

export function shouldRetry(
  status: number,
  retryOptions: RetryOptions,
): boolean {
  const codes = retryOptions.retryStatusCodes;
  if (codes && codes.length > 0) {
    return codes.includes(status);
  }
  return DEFAULT_RETRY_STATUS_CODES.includes(status);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function calcDelay(attempt: number, retryOptions: RetryOptions): number {
  const { baseDelay = 1000, maxDelay = 10000, jitter = true } = retryOptions;
  const base = Math.min(baseDelay * 2 ** attempt, maxDelay);
  return jitter ? base * (0.75 + Math.random() * 0.5) : base;
}

/**
 * @ru Реализация ответа для стандартного Node.js транспорта.
 */
class NodeTransportResponse implements TransportResponse {
  public readonly status: number;
  public readonly headers: Record<string, string | string[]>;
  public readonly url: string;
  public readonly body: TransportResponsePayload;
  public readonly baseUrl: string;

  private readonly _rawBody: Buffer;
  private _cachedText?: string;
  private _cachedJson?: unknown;
  private _cachedJsonReady = false;

  constructor(
    status: number,
    headers: http.IncomingHttpHeaders,
    url: string,
    rawBody: Buffer,
  ) {
    this.status = status;
    this.headers = headers as Record<string, string | string[]>;
    this.url = url;
    this._rawBody = rawBody;
    this.baseUrl = url;

    const stream = Readable.from([rawBody]);

    Object.defineProperty(stream, "dump", {
      value: () => Promise.resolve(),
      writable: false,
      enumerable: false,
      configurable: true,
    });

    this.body = stream as unknown as TransportResponsePayload;
  }

  public async text(): Promise<string> {
    if (this._cachedText === undefined) {
      this._cachedText = this._rawBody.toString("utf-8");
    }
    return this._cachedText;
  }

  public async json<T>(): Promise<T> {
    if (this._cachedJsonReady) {
      return this._cachedJson as T;
    }

    const text = await this.text();
    if (!text.trim()) {
      this._cachedJson = null;
      this._cachedJsonReady = true;
      return null as unknown as T;
    }

    this._cachedJson = JSON.parse(text);
    this._cachedJsonReady = true;
    return this._cachedJson as T;
  }
}

/**
 * @ru Высокопроизводительный транспорт на базе классических модулей http/https Node.js.
 */
export class NodeTransport implements HyperTransport {
  public config: HttpClientOptions;
  private readonly httpAgent: http.Agent;
  private readonly httpsAgent: https.Agent;

  constructor(config: HttpClientOptions) {
    this.config = config;

    const agentOptions: http.AgentOptions = {
      keepAlive: true,
      keepAliveMsecs: config.network?.keepAliveTimeout ?? 30000,
      maxSockets: config.network?.maxConcurrent ?? 500,
      maxFreeSockets: Math.min(
        256,
        Math.floor((config.network?.maxConcurrent ?? 500) / 2),
      ),
      scheduling: "lifo",
    };

    this.httpAgent = new http.Agent(agentOptions);
    this.httpsAgent = new https.Agent(agentOptions);
  }

  private get timeout(): number {
    return this.config.network?.timeout ?? 30000;
  }

  public async execute(req: TransportRequest): Promise<TransportResponse> {
    let currentUrl = req.url;
    let currentMethod = req.method;
    let currentHeaders = { ...req.headers };
    let currentBody = req.body;

    let redirects = 0;
    let attempt = 0;
    const maxRedirects = this.config.network?.maxRedirects ?? 5;
    const maxRetries = this.config.retry?.maxRetries ?? 3;

    const isStreamBody = currentBody instanceof Readable;

    while (true) {
      const { signal, cancelTimer, isTimeoutAbort } = combineSignal(
        req.signal,
        this.timeout,
      );

      try {
        const fullUrl = new URL(currentUrl);

        const result = await this.dispatchOnce(fullUrl, {
          method: currentMethod,
          headers: currentHeaders as Record<string, string>,
          body: currentBody,
          signal,
        });

        if (
          (this.config.network?.followRedirects ?? true) &&
          isRedirect(result.status)
        ) {
          if (redirects >= maxRedirects) {
            throw new Error("Too many redirects");
          }

          const location = result.headers["location"];
          if (location && typeof location === "string") {
            const nextUrl = new URL(location, fullUrl.toString()).toString();
            let nextMethod = currentMethod;

            if (
              result.status === 303 ||
              ((result.status === 301 || result.status === 302) &&
                currentMethod === "POST")
            ) {
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
        }

        if (
          !isStreamBody &&
          shouldRetry(result.status, this.config.retry ?? {})
        ) {
          if (attempt < maxRetries) {
            await sleep(calcDelay(attempt, this.config.retry ?? {}));
            attempt += 1;
            continue;
          }
        }

        return new NodeTransportResponse(
          result.status,
          result.headers,
          fullUrl.toString(),
          result.body,
        );
      } catch (err: any) {
        if (err.name === "AbortError" || isTimeoutAbort()) {
          if (req.signal?.aborted) throw err;
          if (isTimeoutAbort()) {
            throw new Error(`Request timeout after ${this.timeout}ms`, {
              cause: err,
            });
          }
          throw new Error("Transport closed or aborted", { cause: err });
        }

        const retryableCodes = [
          "ECONNREFUSED",
          "ETIMEDOUT",
          "ECONNRESET",
          "EPIPE",
        ];
        if (
          !isStreamBody &&
          attempt < maxRetries &&
          retryableCodes.includes(err.code)
        ) {
          await sleep(calcDelay(attempt, this.config.retry ?? {}));
          attempt += 1;
          continue;
        }

        throw err;
      } finally {
        cancelTimer();
      }
    }
  }

  private dispatchOnce(
    url: URL,
    options: {
      method: string;
      headers: Record<string, string>;
      body: unknown;
      signal?: AbortSignal;
    },
  ): Promise<{
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
  }> {
    return new Promise((resolve, reject) => {
      const isHttps = url.protocol === "https:";
      const requestFn = isHttps ? https.request : http.request;
      const agent = isHttps ? this.httpsAgent : this.httpAgent;

      const reqOptions: http.RequestOptions = {
        method: options.method,
        headers: options.headers,
        agent,
        signal: options.signal,
      };

      if (options.signal?.aborted) {
        const abortError = new Error("The operation was aborted.");
        abortError.name = "AbortError";
        return reject(abortError);
      }

      const req = requestFn(url, reqOptions, (res) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on("end", () => {
          const body =
            chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks);
          resolve({
            status: res.statusCode ?? 200,
            headers: res.headers,
            body,
          });
        });

        res.on("error", (err) => {
          reject(err);
        });
      });

      req.on("error", (err) => {
        reject(err);
      });

      if (options.body !== undefined && options.body !== null) {
        if (Buffer.isBuffer(options.body) || typeof options.body === "string") {
          req.write(options.body);
        } else if (options.body instanceof Readable) {
          options.body.pipe(req);
          return; // Управление потоком передано pipe
        } else {
          req.write(JSON.stringify(options.body));
        }
      }

      req.end();
    });
  }

  public async close(): Promise<void> {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
  }

  public async destroy(): Promise<void> {
    await this.close();
  }
}
