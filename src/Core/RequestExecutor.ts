import { request, Agent } from "undici";
import type { RetryOptions } from "../types/retry.js";
import type { LogLevel, Method } from "../types/http.js";
import type { RequestMetrics } from "../types/metrics.js";
import { HttpClientError, TimeoutError } from "../types/errors.js";

type LowLevelResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
  url: string;
};

interface DynamicInterceptor {
  applyRequest(config: any): Promise<any>;
  applyResponse(response: any): Promise<any>;
}

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
      logger?: (level: LogLevel, message: string, meta?: any) => void;
    },
  ) {}

  /**
   * @en Executes a raw HTTP request.
   * @ru Выполняет "сырой" HTTP-запрос.
   */
  async execute(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string | Buffer | undefined,
    signal?: AbortSignal,
    metrics?: RequestMetrics,
    interceptors?: DynamicInterceptor | any,
  ): Promise<LowLevelResponse> {
    return this.executeCore(
      method,
      url,
      headers,
      body,
      metrics,
      signal,
      async (res) => res.body,
      interceptors,
    );
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
  private async drainBody(body: any): Promise<void> {
    if (!body) return;

    try {
      if (typeof body.dump === "function") {
        await body.dump();
        return;
      }
      if (typeof body.resume === "function") {
        body.resume();
        return;
      }
      if (typeof body.destroy === "function") {
        body.destroy();
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
    headers: Record<string, string>,
    body: string | Buffer | undefined,
    metrics: RequestMetrics | undefined,
    signal: AbortSignal | undefined,
    parser: (res: LowLevelResponse) => Promise<TBody>,
    interceptors?: DynamicInterceptor | any,
  ): Promise<LowLevelResponse> {
    let currentUrl = url;
    let currentMethod = method;
    let currentHeaders = headers;
    let currentBody = body;

    let redirects = 0;
    let attempt = 0;

    const manager = interceptors ?? {
      applyRequest: async (c: any) => c,
      applyResponse: async (r: any) => r,
    };

    const timeoutController = new AbortController();
    const timer = setTimeout(
      () => timeoutController.abort(),
      this.options.timeout,
    );

    const abortHandler = () => timeoutController.abort();

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        throw new HttpClientError(
          "Request aborted by user",
          "ABORTED",
          0,
          undefined,
          url,
          method,
        );
      }
      signal.addEventListener("abort", abortHandler, { once: true });
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
            signal: timeoutController.signal,
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
              const nextMethod = status === 303 ? "GET" : currentMethod;

              currentUrl = nextUrl;
              currentMethod = nextMethod;
              currentBody = nextMethod === "GET" ? undefined : currentBody;

              if (nextMethod === "GET") {
                if (
                  currentHeaders["content-type"] ||
                  currentHeaders["Content-Type"] ||
                  currentHeaders["content-length"] ||
                  currentHeaders["Content-Length"]
                ) {
                  const nextHeaders = { ...currentHeaders };
                  delete nextHeaders["content-type"];
                  delete nextHeaders["Content-Type"];
                  delete nextHeaders["content-length"];
                  delete nextHeaders["Content-Length"];
                  currentHeaders = nextHeaders;
                }
              }

              redirects++;
              continue;
            }
          }

          if (this.shouldRetry(status)) {
            if (attempt < this.options.maxRetries) {
              if (metrics) metrics.retries += 1;

              await this.drainBody(res.body);
              const delay = this.calcDelay(attempt);
              if (delay > 0) await this.sleep(delay);

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

          const parsed = await parser(transformed as LowLevelResponse);

          return {
            status: transformed.status,
            headers: transformed.headers,
            body: parsed,
            url: transformed.url,
          };
        } catch (err: any) {
          if (err?.name === "AbortError") {
            if (signal?.aborted) {
              throw new HttpClientError(
                "Request aborted by user",
                "ABORTED",
                0,
                err,
                url,
                method,
              );
            }
            throw new TimeoutError(url, this.options.timeout);
          }

          if (
            attempt < this.options.maxRetries &&
            (err?.code === "ECONNREFUSED" ||
              err?.code === "ETIMEDOUT" ||
              err?.code === "UND_ERR_SOCKET")
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
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abortHandler);
    }
  }
}
