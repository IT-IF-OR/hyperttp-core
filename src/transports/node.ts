import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { ReadableStream } from "node:stream/web";
import type {
  HttpClientOptions,
  HyperTransport,
  TransportRequest,
  TransportResponse,
  TransportResponsePayload,
} from "@hyperttp/types";

export interface NodeTransportConfig extends HttpClientOptions {
  baseUrl?: string;
  network?: {
    maxConcurrent?: number;
    keepAliveTimeout?: number;
  };
}

export class NodeTransport implements HyperTransport {
  public config: NodeTransportConfig;
  private readonly httpAgent: http.Agent;
  private readonly httpsAgent: https.Agent;

  constructor(config: NodeTransportConfig) {
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

  private get baseUrl(): string {
    return this.config.baseUrl ?? "http://localhost:3000";
  }

  public async execute(req: TransportRequest): Promise<TransportResponse> {
    const fullUrl = new URL(req.url, this.baseUrl);

    if (
      process.env.NODE_ENV === "production" &&
      fullUrl.hostname === "localhost"
    ) {
      throw new Error("Localhost URL detected in production environment");
    }

    if (req.signal?.aborted) {
      const abortError =
        req.signal.reason || new Error("The operation was aborted.");
      if (abortError instanceof Error && !abortError.name)
        abortError.name = "AbortError";
      throw abortError;
    }

    // Клонируем заголовки, чтобы не мутировать исходный объект запроса
    const headers = { ...req.headers } as Record<string, string | string[]>;

    // Хелпер для регистронезависимой проверки заголовков
    const hasHeader = (name: string) =>
      Object.keys(headers).some((k) => k.toLowerCase() === name.toLowerCase());

    let finalBody: any = req.body;

    // Автоматический расчет Content-Length для не-стримовых данных
    if (finalBody !== undefined && finalBody !== null) {
      if (Buffer.isBuffer(finalBody)) {
        if (!hasHeader("content-length")) {
          headers["Content-Length"] = String(finalBody.byteLength);
        }
      } else if (typeof finalBody === "string") {
        if (!hasHeader("content-length")) {
          headers["Content-Length"] = String(
            Buffer.byteLength(finalBody, "utf-8"),
          );
        }
      } else if (!(finalBody instanceof ReadableStream)) {
        // Сериализуем объект один раз здесь
        finalBody = JSON.stringify(finalBody);
        if (!hasHeader("content-length")) {
          headers["Content-Length"] = String(
            Buffer.byteLength(finalBody, "utf-8"),
          );
        }
      }
    }

    return new Promise<TransportResponse>((resolve, reject) => {
      const isHttps = fullUrl.protocol === "https:";
      const requestFn = isHttps ? https.request : http.request;
      const agent = isHttps ? this.httpsAgent : this.httpAgent;

      let isDone = false;
      let nodeResInstance: http.IncomingMessage | null = null;

      const reqOptions: http.RequestOptions = {
        method: req.method,
        headers: headers as http.OutgoingHttpHeaders,
        agent,
      };

      const nodeReq = requestFn(fullUrl, reqOptions, (nodeRes) => {
        nodeResInstance = nodeRes;

        nodeRes.on("end", () => {
          isDone = true;
          cleanupSignal();
        });

        nodeRes.on("close", () => {
          isDone = true;
          cleanupSignal();
        });

        const webStream = Readable.toWeb(nodeRes) as ReadableStream<Uint8Array>;

        const dump = async (): Promise<void> => {
          isDone = true;
          cleanupSignal();
          nodeRes.destroy();
        };

        const bodyPayload = Object.assign(webStream, {
          dump,
        }) as unknown as TransportResponsePayload;

        resolve({
          status: nodeRes.statusCode ?? 200,
          headers: nodeRes.headers as Record<string, string | string[]>,
          url: fullUrl.toString(),
          body: bodyPayload,
        });
      });

      let onAbort: (() => void) | undefined;
      if (req.signal) {
        onAbort = () => {
          if (isDone) return;
          isDone = true;

          nodeReq.destroy();
          if (nodeResInstance) {
            nodeResInstance.destroy();
          }

          const err =
            req.signal?.reason || new Error("The operation was aborted.");
          if (err instanceof Error && !err.name) err.name = "AbortError";
          reject(err);
        };
        req.signal.addEventListener("abort", onAbort, { once: true });
      }

      function cleanupSignal(): void {
        if (req.signal && onAbort) {
          req.signal.removeEventListener("abort", onAbort);
        }
      }

      nodeReq.on("error", (err: Error) => {
        if (isDone) return;
        isDone = true;
        cleanupSignal();
        reject(err);
      });

      if (finalBody !== undefined && finalBody !== null) {
        if (Buffer.isBuffer(finalBody) || typeof finalBody === "string") {
          nodeReq.end(finalBody);
        } else if (finalBody instanceof ReadableStream) {
          Readable.fromWeb(finalBody).pipe(nodeReq);
        }
      } else {
        nodeReq.end();
      }
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
