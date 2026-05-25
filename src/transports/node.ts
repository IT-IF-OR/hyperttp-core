import { compose, Readable, type Transform } from "node:stream";
import zlib from "node:zlib";
import { CookieAgent } from "http-cookie-agent/undici";
import { RequestExecutor } from "../Core/RequestExecutor.js";
import type {
  HyperTransport,
  TransportRequest,
  TransportResponse,
} from "../types/transport.js";
import type { HttpClientOptions } from "../types/options.js";
import type { RetryOptions } from "../types/retry.js";

type ExtendedReadableStream = Readable & {
  destroyed?: boolean;
  readableEnded?: boolean;
  closed?: boolean;
  dump?: () => Promise<void>;
};

export class NodeTransport implements HyperTransport {
  private agent: CookieAgent;
  private executor: RequestExecutor;
  private isClosed = false;

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
          ? 100
          : 1;

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

    let contentEncoding: string | undefined = undefined;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const value = rawHeaders[key];
      if (value === undefined) continue;

      const lowerKey = key.toLowerCase();

      if (lowerKey === "content-encoding") {
        contentEncoding = Array.isArray(value) ? value[0] : (value as string);
      }

      if (Array.isArray(value)) {
        normalizedHeaders[key] =
          lowerKey === "set-cookie" ? value.join("\n") : value.join(", ");
      } else {
        normalizedHeaders[key] = value as string;
      }
    }

    const decompressedBody = this.wrapDecompress(
      rawResponse.body,
      contentEncoding,
    );

    if (decompressedBody instanceof Readable) {
      Object.defineProperty(decompressedBody, "dump", {
        value: function (this: ExtendedReadableStream) {
          return new Promise<void>((resolve, reject) => {
            const cleanup = () => {
              this.removeListener("data", onData);
              this.removeListener("end", resolve);
              this.removeListener("error", reject);
            };
            const onData = () => {};

            this.on("data", onData);
            this.on("end", () => {
              cleanup();
              resolve();
            });
            this.on("error", (err) => {
              cleanup();
              reject(err);
            });
            this.resume();
          });
        },
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }

    return {
      status: rawResponse.status,
      headers: normalizedHeaders,
      body: decompressedBody,
      url: rawResponse.url,
    };
  }

  private wrapDecompress(
    body: unknown,
    contentEncoding: string | undefined,
  ): unknown {
    if (!(body instanceof Readable)) return body;

    const encoding = contentEncoding?.toLowerCase().trim();
    if (!encoding || encoding === "none" || encoding === "identity") {
      return body;
    }

    let decompressor: Transform | null = null;

    if (encoding === "gzip") {
      decompressor = zlib.createGunzip({ flush: zlib.constants.Z_SYNC_FLUSH });
    } else if (encoding === "deflate") {
      decompressor = zlib.createInflate();
    } else if (encoding === "br") {
      decompressor = zlib.createBrotliDecompress();
    }

    if (!decompressor) return body;

    return compose(body, decompressor);
  }

  public async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;

    try {
      const structuralAgent = this.agent as unknown as {
        close?: () => Promise<void>;
      };
      if (typeof structuralAgent.close === "function") {
        await structuralAgent.close();
      } else {
        await this.destroy();
      }
    } catch (err) {
      this.logWarning("Transport close error:", err);
    }
  }

  public async destroy(): Promise<void> {
    this.isClosed = true;
    await new Promise((resolve) => setImmediate(resolve));

    try {
      const structuralAgent = this.agent as unknown as {
        destroy?: () => Promise<void>;
      };
      if (typeof structuralAgent.destroy === "function") {
        await structuralAgent.destroy();
      }
    } catch (err) {
      this.logWarning("Transport destroy error:", err);
    }
  }

  private logWarning(msg: string, err: unknown) {
    if (this.executor["verbose"]) {
      // обращение к приватному полю через bracket notation если нужно
      console.warn(msg, err);
    }
  }
}
