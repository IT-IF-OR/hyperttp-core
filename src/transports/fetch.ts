import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import type {
  HyperTransport,
  LogLevel,
  SenderProtocol,
  TransportListenOptions,
  TransportRequest,
  TransportResponse,
  TransportServer,
} from "@hyperttp/types";

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface FetchTransportOptions {
  /**
   * @ru Кастомный список поддерживаемых протоколов.
   * @en Custom list of supported protocols.
   */
  protocols?: SenderProtocol[];
  /**
   * @ru Максимальный размер входящего серверного тела в байтах. Превышение
   * возвращает HTTP 413 до передачи тела обработчику.
   * @en Maximum incoming server request body size in bytes. Exceeding it returns
   * HTTP 413 before the body reaches the handler.
   */
  maxBodyBytes?: number;
  /**
   * @ru Обработчик ошибок входящих серверных запросов.
   * @en Error hook for incoming server requests.
   */
  onError?: (error: unknown, request: TransportRequest) => void;
  logger?: (level: LogLevel, message: string, meta?: unknown) => void;
}

type ExtendedTransportRequest = TransportRequest & {
  stream?: boolean;
  followRedirects?: boolean;
};

async function loadNodeHttp(): Promise<typeof import("node:http")> {
  if (typeof process === "undefined" || !process.versions?.node) {
    throw new Error("[FetchTransport] listen() is only available in Node.js.");
  }

  const specifier = "node:http";
  return import(/* @vite-ignore */ specifier);
}

/**
 * @ru Минимальный транспорт на базе нативного fetch. Гарантированный fallback,
 * когда ни один пакетный транспорт (@hyperttp/transport-undici/bun) не установлен.
 * @en Minimal native fetch-based transport. A guaranteed fallback used when no
 * packaged transport (@hyperttp/transport-undici/bun) is installed.
 */
export class FetchTransport implements HyperTransport {
  public readonly protocols: readonly SenderProtocol[];
  private readonly maxBodyBytes: number;
  private readonly onError?: FetchTransportOptions["onError"];
  private readonly logger?: FetchTransportOptions["logger"];

  /**
   * @ru Создаёт fallback-транспорт на базе глобального `fetch`.
   * @en Creates a fallback transport based on global `fetch`.
   * @param options - Поддерживаемые протоколы и серверный лимит тела. @en Supported protocols and server body limit.
   */
  constructor(options: FetchTransportOptions = {}) {
    this.protocols = Object.freeze(options.protocols ?? ["rest"]);
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this.onError = options.onError;
    this.logger = options.logger;
  }

  public async execute(req: TransportRequest): Promise<TransportResponse> {
    const extendedRequest = req as ExtendedTransportRequest;
    const isBodyAllowed = req.method !== "GET" && req.method !== "HEAD";

    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: isBodyAllowed ? ((req.body ?? null) as BodyInit | null) : null,
      signal: req.signal,
      redirect: extendedRequest.followRedirects === false ? "manual" : "follow",
    });

    const body = extendedRequest.stream ? res.body : new Uint8Array(await res.arrayBuffer());
    const headers: Record<string, string | string[]> = {};

    if (typeof res.headers.getSetCookie === "function") {
      const cookies = res.headers.getSetCookie();
      if (cookies.length > 0) {
        headers["set-cookie"] = cookies;
      }
    }

    res.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();

      if (lowerKey === "set-cookie" && headers["set-cookie"]) {
        return;
      }

      if (headers[lowerKey]) {
        const existing = headers[lowerKey];
        headers[lowerKey] = Array.isArray(existing) ? [...existing, value] : [existing, value];
      } else {
        headers[lowerKey] = value;
      }
    });

    return {
      status: res.status,
      statusText: res.statusText,
      headers,
      url: res.url,
      body,
    };
  }

  public async listen(options: TransportListenOptions): Promise<TransportServer> {
    const { host, port, signal, onRequest } = options;
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
    }

    const { createServer } = await loadNodeHttp();

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const requestController = new AbortController();
      const abortRequest = () => {
        if (!requestController.signal.aborted) {
          requestController.abort(new DOMException("Client disconnected", "AbortError"));
        }
      };
      const abortIncompleteRequest = () => {
        if (!req.complete) abortRequest();
      };
      const abortIncompleteResponse = () => {
        if (!res.writableEnded) abortRequest();
      };

      req.once("aborted", abortRequest);
      req.once("close", abortIncompleteRequest);
      res.once("close", abortIncompleteResponse);

      try {
        const contentLength = Number(req.headers["content-length"] ?? 0);
        if (Number.isFinite(contentLength) && contentLength > this.maxBodyBytes) {
          res.writeHead(413);
          res.end("Payload Too Large");
          return;
        }

        const chunks: Uint8Array[] = [];
        let receivedBytes = 0;

        for await (const chunk of req) {
          receivedBytes += chunk.byteLength;
          if (receivedBytes > this.maxBodyBytes) {
            res.writeHead(413);
            res.end("Payload Too Large");
            return;
          }
          chunks.push(chunk);
        }

        const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
        const headers: Record<string, string | string[]> = {};

        for (const [key, value] of Object.entries(req.headers)) {
          if (value !== undefined) {
            headers[key] = value;
          }
        }

        const transportRequest: TransportRequest = {
          method: req.method ?? "GET",
          url: req.url ?? "/",
          headers,
          body,
          signal: requestController.signal,
          protocol: this.protocols[0] ?? "rest",
        };

        if (!onRequest) {
          res.writeHead(501);
          res.end("Not Implemented");
          return;
        }

        const response = await onRequest(transportRequest);
        const outgoingHeaders: OutgoingHttpHeaders = {};

        for (const [key, value] of Object.entries(response.headers)) {
          outgoingHeaders[key] = value;
        }

        res.writeHead(response.status, response.statusText ?? "", outgoingHeaders);

        if (response.body != null) {
          if (response.body instanceof Uint8Array) {
            res.end(response.body);
          } else if (typeof response.body === "string") {
            res.end(response.body);
          } else {
            res.end(JSON.stringify(response.body));
          }
        } else {
          res.end();
        }
      } catch (error) {
        this.onError?.(error, {
          method: req.method ?? "GET",
          url: req.url ?? "/",
          headers: req.headers as Record<string, string | string[]>,
          signal: requestController.signal,
          protocol: this.protocols[0] ?? "rest",
        });
        if (!res.headersSent) {
          res.writeHead(500);
          res.end("Internal Server Error");
        } else {
          res.destroy();
        }
      } finally {
        req.removeListener("aborted", abortRequest);
        req.removeListener("close", abortIncompleteRequest);
        res.removeListener("close", abortIncompleteResponse);
      }
    });

    let closed = false;
    const close = (): Promise<void> => {
      if (closed) return Promise.resolve();
      closed = true;
      signal?.removeEventListener("abort", closeOnAbort);
      server.removeListener("error", reportRuntimeError);

      if (!server.listening) return Promise.resolve();
      return new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) rejectClose(error);
          else resolveClose();
        });
      });
    };
    const closeOnAbort = () => {
      void close();
    };
    const reportRuntimeError = (error: Error) => {
      const message = "[FetchTransport] HTTP server error";
      if (this.logger) {
        this.logger("error", message, error);
      } else {
        console.error(`${message}:`, error);
      }
    };

    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
    }
    signal?.addEventListener("abort", closeOnAbort, { once: true });

    return new Promise<TransportServer>((resolve, reject) => {
      const rejectStartup = (error: Error) => {
        signal?.removeEventListener("abort", closeOnAbort);
        reject(error);
      };

      server.once("error", rejectStartup);
      server.listen({ host, port }, () => {
        server.removeListener("error", rejectStartup);
        server.on("error", reportRuntimeError);
        resolve({ close });
      });
    });
  }

  public async close(): Promise<void> {}
}
