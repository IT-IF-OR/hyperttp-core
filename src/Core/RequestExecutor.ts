import { request, Agent } from "undici";
import type { RetryOptions } from "../types/retry.js";
import type { LogLevel, Method, ResponseType } from "../types/http.js";
import type { RequestMetrics } from "../types/metrics.js";
import { HttpClientError, TimeoutError } from "../types/errors.js";

export type LowLevelResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  url: string;
};

export interface InterceptorRequestConfig {
  url: string;
  method: string;
  headers: Record<string, string | string[]>;
  body: string | Buffer | undefined;
}

export interface DynamicInterceptor {
  applyRequest(
    config: InterceptorRequestConfig,
  ): Promise<InterceptorRequestConfig>;
  applyResponse(response: LowLevelResponse): Promise<LowLevelResponse>;
}

/**
 * @private
 * Статический интерцептор-заглушка. Исключает аллокацию объекта на каждый запрос.
 */
const defaultInterceptorManager: DynamicInterceptor = {
  applyRequest: (config) => Promise.resolve(config),
  applyResponse: (response) => Promise.resolve(response),
};

/**
 * @private
 * Статический парсер тела ответа. Исключает создание замыканий внутри execute().
 */
const defaultBodyParser = (res: LowLevelResponse): Promise<unknown> =>
  Promise.resolve(res.body);

/**
 * @en Low-level request executor responsible for handling the actual HTTP lifecycle.
 * @ru Низкоуровневый исполнитель запросов, отвечающий за полный цикл HTTP-жизни.
 */
export class RequestExecutor {
  private readonly redirectStatusCodes = new Set([301, 302, 303, 307, 308]);

  constructor(
    private agent: Agent,
    private options: {
      timeout: number;
      maxRetries: number;
      followRedirects: boolean;
      maxRedirects: number;
      retryOptions: RetryOptions;
      verbose?: boolean;
      logger?: (level: LogLevel, message: string, meta?: unknown) => void;
    },
  ) {}

  /**
   * @en Executes a raw HTTP request.
   * @ru Выполняет "сырой" HTTP-запрос.
   */
  public async execute(
    method: string,
    url: string,
    headers: Record<string, string | string[]>,
    body: string | Buffer | undefined,
    signal?: AbortSignal,
    metrics?: RequestMetrics,
    interceptors?: DynamicInterceptor,
    meta?: { responseType?: ResponseType },
  ): Promise<LowLevelResponse> {
    return this.executeCore(
      method,
      url,
      headers,
      body,
      metrics,
      signal,
      defaultBodyParser,
      interceptors,
      meta?.responseType === "stream",
    );
  }

  public get verbose(): boolean {
    return this.options.verbose ?? false;
  }

  /**
   * @en Calculates the delay for the next retry attempt using exponential backoff.
   * @ru Вычисляет задержку для следующей попытки повтора.
   */
  private calcDelay(attempt: number): number {
    const {
      baseDelay = 1000,
      maxDelay = 10000,
      jitter = true,
    } = this.options.retryOptions;
    const base = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    return jitter ? base * (0.75 + Math.random() * 0.5) : base;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * @en Ensures that the response body stream is properly closed to prevent memory leaks.
   * @ru Гарантирует, что поток тела ответа корректно закрыт.
   */
  private async drainBody(body: unknown): Promise<void> {
    if (!body || typeof body !== "object") return;

    try {
      const stream = body as Record<string, unknown>;
      if (typeof stream.dump === "function") {
        await (stream.dump as () => Promise<void>)();
        return;
      }
      if (typeof stream.resume === "function") {
        (stream.resume as () => void)();
        return;
      }
      if (typeof stream.destroy === "function") {
        (stream.destroy as () => void)();
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * @en Checks if the status code should trigger a retry attempt.
   * @ru Проверяет, должен ли данный статус-код вызывать повтор запроса.
   */
  private shouldRetry(status: number): boolean {
    const codes = this.options.retryOptions.retryStatusCodes;
    if (codes && codes.length > 0) {
      return codes.includes(status);
    }
    return status === 502 || status === 503 || status === 504;
  }

  private async executeCore<TBody>(
    method: string,
    url: string,
    headers: Record<string, string | string[]>,
    body: string | Buffer | undefined,
    metrics: RequestMetrics | undefined,
    signal: AbortSignal | undefined,
    parser: (res: LowLevelResponse) => Promise<TBody>,
    interceptors?: DynamicInterceptor,
    isStreaming: boolean = false,
  ): Promise<LowLevelResponse> {
    let currentUrl = url;
    let currentMethod = method;
    let currentHeaders = headers;
    let currentBody = body;

    let redirects = 0;
    let attempt = 0;

    const manager = interceptors ?? defaultInterceptorManager;

    const timeoutValue = isStreaming ? 0 : this.options.timeout;
    let timeoutController: AbortController | undefined = undefined;
    let timer: NodeJS.Timeout | undefined = undefined;
    let combinedSignal = signal;

    if (timeoutValue > 0) {
      timeoutController = new AbortController();
      timer = setTimeout(() => timeoutController?.abort(), timeoutValue);
      combinedSignal = signal
        ? AbortSignal.any([signal, timeoutController.signal])
        : timeoutController.signal;
    }

    try {
      while (true) {
        try {
          const config = await manager.applyRequest({
            url: currentUrl,
            method: currentMethod,
            headers: currentHeaders,
            body: currentBody,
          });

          const res = await request(config.url, {
            method: config.method as Method,
            headers: config.headers,
            body: config.body,
            dispatcher: this.agent,
            signal: combinedSignal,
          });

          const status = res.statusCode;
          const resHeaders = res.headers as Record<
            string,
            string | string[] | undefined
          >;

          if (
            this.options.followRedirects &&
            this.redirectStatusCodes.has(status)
          ) {
            if (redirects >= this.options.maxRedirects) {
              await this.drainBody(res.body);
              throw new HttpClientError(
                "Too many redirects",
                "TOO_MANY_REDIRECTS",
                status,
              );
            }
            const location = resHeaders.location as string | undefined;
            if (location) {
              await this.drainBody(res.body);
              const nextUrl = new URL(location, config.url).toString();

              let nextMethod = currentMethod;
              if (
                status === 303 ||
                ((status === 301 || status === 302) && currentMethod === "POST")
              ) {
                nextMethod = "GET";
              }

              currentUrl = nextUrl;
              currentMethod = nextMethod;
              currentBody = nextMethod === "GET" ? undefined : currentBody;

              if (nextMethod === "GET") {
                const nextHeaders = { ...currentHeaders };
                delete nextHeaders["content-type"];
                delete nextHeaders["Content-Type"];
                delete nextHeaders["content-length"];
                delete nextHeaders["Content-Length"];
                currentHeaders = nextHeaders;
              }
              redirects++;
              continue;
            }
          }

          if (this.shouldRetry(status)) {
            if (attempt < this.options.maxRetries) {
              if (metrics) metrics.retries += 1;
              await this.drainBody(res.body);
              await this.sleep(this.calcDelay(attempt));
              attempt++;
              continue;
            }
            throw new HttpClientError(
              `HTTP ${status}`,
              "HTTP_ERROR",
              status,
              undefined,
              config.url,
              currentMethod,
            );
          }

          const transformed = await manager.applyResponse({
            status,
            headers: resHeaders,
            body: res.body,
            url: config.url,
          });

          const parsed = await parser(transformed);
          return {
            status: transformed.status,
            headers: transformed.headers,
            body: parsed,
            url: transformed.url,
          };
        } catch (err: unknown) {
          const errorTarget = err as Record<string, unknown> | null;
          const errorName = errorTarget?.name as string | undefined;
          const errorCode = errorTarget?.code as string | undefined;

          if (errorName === "AbortError") {
            if (signal?.aborted) {
              throw new HttpClientError(
                "Request aborted by user",
                "ABORTED",
                0,
                err instanceof Error ? err : undefined,
                url,
                method,
              );
            }
            if (timeoutController?.signal.aborted) {
              throw new TimeoutError(url, this.options.timeout);
            }

            throw new HttpClientError(
              "Request aborted due to transport closure or internal state reset",
              "TRANSPORT_CLOSED",
              0,
              err instanceof Error ? err : undefined,
              url,
              method,
            );
          }

          if (
            attempt < this.options.maxRetries &&
            (errorCode === "ECONNREFUSED" ||
              errorCode === "ETIMEDOUT" ||
              errorCode === "ECONNRESET" ||
              errorCode === "EPIPE" ||
              errorCode === "UND_ERR_SOCKET")
          ) {
            if (metrics) metrics.retries += 1;
            await this.sleep(this.calcDelay(attempt));
            attempt++;
            continue;
          }
          throw err;
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
