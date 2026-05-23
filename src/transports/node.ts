import { pipeline } from "node:stream";
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

    // Примешиваем высокопроизводительный метод .dump() прямо в инстанс стрима
    if (decompressedBody) {
      Object.defineProperty(decompressedBody, "dump", {
        value: function (this: any) {
          return new Promise<void>((resolve, reject) => {
            if (this.destroyed || this.readableEnded || this.closed) {
              return resolve();
            }

            if (typeof this.resume === "function") {
              this.on("data", () => {});
              this.on("end", resolve);
              this.on("error", reject);
              this.resume(); // Переводим в flowing mode для моментального слива данных
            } else {
              resolve();
            }
          });
        },
        writable: true,
        configurable: true,
        enumerable: false, // Метод скрыт от сериализации и перебора ключей
      });
    }

    return {
      status: rawResponse.status,
      headers: normalizedHeaders,
      body: decompressedBody,
      url: rawResponse.url,
    };
  }

  /**
   * Защищенная обертка для потоковой декомпрессии.
   * Гарантирует отсутствие утечек сокетов при ошибках или ручном закрытии стрима.
   */
  private wrapDecompress(body: any, contentEncoding: string | undefined): any {
    if (!body) return body;

    const encoding = contentEncoding?.toLowerCase().trim();
    if (!encoding || encoding === "none" || encoding === "identity") {
      return body;
    }

    let decompressor: any = null;

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

    /**
     * Используем встроенный метод pipeline вместо .pipe().
     * Если zlib стрим выбросит ошибку парсинга данных (Z_DATA_ERROR) или пользователь
     * прервет чтение, pipeline автоматически вызовет .destroy() на исходном сетевом
     * потоке undici, освобождая сокет и возвращая его в пул CookieAgent.
     */
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
