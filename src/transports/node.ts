import { pipeline, Readable, type Transform } from "node:stream";
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
            if (this.destroyed || this.readableEnded || this.closed) {
              return resolve();
            }

            if (typeof this.resume === "function") {
              this.on("data", () => {});
              this.on("end", resolve);
              this.on("error", reject);
              this.resume();
            } else {
              resolve();
            }
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

    if (!decompressor) {
      return body;
    }

    const decompressedStream = pipeline(body, decompressor, (err) => {
      if (err) {
        decompressedStream.emit("error", err);

        if (this.executor.verbose) {
          console.error?.(`[Hyperttp] Decompression failed: ${err.message}`);
        }
      }
    });

    return decompressedStream;
  }

  public async destroy(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));

    try {
      const structuralAgent = this.agent as unknown as {
        close?: () => Promise<void>;
        destroy?: () => Promise<void>;
      };

      if (typeof structuralAgent.close === "function") {
        await structuralAgent.close();
      } else if (typeof structuralAgent.destroy === "function") {
        await structuralAgent.destroy();
      }
    } catch (err) {
      if (this.executor.verbose) {
        console.warn("Transport destroy error (likely race condition):", err);
      }
    }
  }
}
