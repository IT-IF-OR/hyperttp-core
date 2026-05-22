import { CookieAgent } from "http-cookie-agent/undici";
import { RequestExecutor } from "../Core/RequestExecutor.js";
import type {
  HyperTransport,
  TransportRequest,
  TransportResponse,
} from "../types/transport.js";
import type { HttpClientOptions } from "../types/options.js";
import type { RetryOptions } from "../types/retry.js";

export class NodeTransport implements HyperTransport {
  private agent: CookieAgent;
  private executor: RequestExecutor;

  constructor(config: HttpClientOptions) {
    const concurrency =
      config.network?.maxConcurrent === 0
        ? Infinity
        : (config.network?.maxConcurrent ?? 500);

    const allowH2 = config.network?.allowHttp2 ?? true;
    const pipelining =
      config.network?.pipelining !== undefined
        ? config.network.pipelining === 0
          ? 256
          : config.network.pipelining
        : allowH2
          ? 1
          : 10;

    this.agent = new CookieAgent({
      connections: concurrency === Infinity ? null : concurrency,
      pipelining,
      keepAliveTimeout: config.network?.keepAliveTimeout ?? 30000,
      keepAliveMaxTimeout: config.network?.keepAliveTimeout ?? 30000,
      clientTtl: 60000,
      connect: { rejectUnauthorized: config.network?.rejectUnauthorized },
      allowH2,
    });

    const retryOptions: RetryOptions = {
      maxRetries: config.retry?.maxRetries ?? 3,
      ...config.retry,
    };

    this.executor = new RequestExecutor(this.agent, {
      timeout: config.network?.timeout ?? 30000,
      maxRetries: retryOptions.maxRetries ?? 3,
      followRedirects: config.network?.followRedirects ?? true,
      maxRedirects: config.network?.maxRedirects ?? 5,
      retryOptions: retryOptions,
      verbose: config.verbose ?? false,
      logger: config.logger,
    });
  }

  public async execute(req: TransportRequest): Promise<TransportResponse> {
    const rawResponse = await this.executor.execute(
      req.method,
      req.url,
      req.headers,
      req.body,
      req.signal,
    );

    const normalizedHeaders: Record<string, string> = {};
    const rawHeaders = rawResponse.headers;
    const keys = Object.keys(rawHeaders);

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const value = rawHeaders[key];
      if (value === undefined) continue;

      if (Array.isArray(value)) {
        const lowerKey = key.toLowerCase();
        normalizedHeaders[key] =
          lowerKey === "set-cookie" ? value.join("\n") : value.join(", ");
      } else {
        normalizedHeaders[key] = value as string;
      }
    }

    return {
      status: rawResponse.status,
      headers: normalizedHeaders,
      body: rawResponse.body,
      url: rawResponse.url,
    };
  }

  public async destroy() {
    await new Promise((resolve) => setImmediate(resolve));

    try {
      const anyAgent = this.agent as any;
      if (typeof anyAgent.close === "function") {
        await anyAgent.close();
      } else if (typeof anyAgent.destroy === "function") {
        await anyAgent.destroy();
      }
    } catch (err) {
      if (this.executor.verbose) {
        console.warn("Transport destroy error (likely race condition):", err);
      }
    }
  }
}
