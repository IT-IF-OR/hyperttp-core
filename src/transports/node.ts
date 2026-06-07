/**
 * @ru Транспорт на основе глобального fetch (Node.js 18+). Обрабатывает нормализацию URL, сериализацию тела и очистку потока.
 * @en Transport based on the global fetch API (Node.js 18+). Handles URL normalisation, body serialisation, and stream cleanup.
 */

import type {
  HttpClientOptions,
  HyperTransport,
  TransportRequest,
  TransportResponse,
  TransportResponsePayload,
} from "@hyperttp/types";

export interface NodeTransportConfig extends HttpClientOptions {
  baseUrl?: string;
}

/**
 * @ru Реализация транспорта для Node.js с использованием fetch.
 * @en Node.js transport implementation using fetch.
 */
export class NodeTransport implements HyperTransport {
  /**
   * @ru Конфигурация клиента.
   * @en Client configuration.
   */
  public config: NodeTransportConfig;

  private readonly isProduction: boolean;
  private readonly cleanBaseUrl: string;

  /**
   * @ru Создаёт экземпляр NodeTransport.
   * @en Creates a NodeTransport instance.
   * @param config - Transport configuration (may include baseUrl).
   */
  constructor(config: NodeTransportConfig) {
    this.config = config;
    this.isProduction = process.env.NODE_ENV === "production";

    const base = config.baseUrl ?? "http://localhost:3000";
    this.cleanBaseUrl = base.endsWith("/") ? base.slice(0, -1) : base;
  }

  /**
   * @ru Выполняет HTTP-запрос через fetch.
   * @en Executes an HTTP request via fetch.
   * @param req - Transport request object (method, url, headers, body, signal).
   * @returns Promise resolving to a TransportResponse.
   * @throws If a localhost URL is requested in production environment.
   */
  public async execute(req: TransportRequest): Promise<TransportResponse> {
    const urlStr = req.url;

    const fullUrl = urlStr.startsWith("http")
      ? urlStr
      : urlStr.charCodeAt(0) === 47
        ? this.cleanBaseUrl + urlStr
        : this.cleanBaseUrl + "/" + urlStr;

    if (this.isProduction && fullUrl.includes("//localhost")) {
      throw new Error("Localhost URL detected in production environment");
    }

    let finalBody: any = req.body;
    if (
      finalBody !== undefined &&
      finalBody !== null &&
      typeof finalBody === "object" &&
      !Buffer.isBuffer(finalBody) &&
      !(finalBody instanceof ReadableStream)
    ) {
      finalBody = JSON.stringify(finalBody);
    }

    const res = await globalThis.fetch(fullUrl, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: finalBody,
      signal: req.signal,
    });

    const webStream = res.body || new ReadableStream();

    (webStream as any).dump = async function () {
      if (res.body && !res.body.locked) {
        await res.body.cancel();
      }
    };

    const resHeaders: Record<string, string> = {};
    for (const [key, value] of res.headers) {
      resHeaders[key] = value;
    }

    return {
      status: res.status,
      headers: resHeaders,
      url: res.url,
      body: webStream as unknown as TransportResponsePayload,
    };
  }
}
