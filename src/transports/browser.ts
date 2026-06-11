import type {
  HttpClientOptions,
  HyperTransport,
  TransportRequest,
  TransportResponse,
  TransportResponsePayload,
} from "@hyperttp/types";

/**
 * @ru Конфигурация транспорта для браузера.
 * @en Browser transport configuration.
 */
export interface BrowserTransportConfig extends HttpClientOptions {
  /**
   * @ru Базовый URL для относительных путей. По умолчанию — window.location.origin.
   * @en Base URL for relative paths. Defaults to window.location.origin.
   */
  baseUrl?: string;
}

/**
 * @ru Интерфейс для безопасного доступа к мета-окружению сборщиков (Vite, Webpack и др.).
 */
interface ImportMetaEnv {
  env?: {
    PROD?: boolean;
    [key: string]: unknown;
  };
}

/**
 * @ru Реализация транспорта для браузера с использованием глобального fetch API.
 * Оптимизирован для минимального размера и максимальной совместимости.
 * @en Browser transport implementation using the global fetch API.
 * Optimized for minimal size and maximum compatibility.
 */
export class BrowserTransport implements HyperTransport {
  private readonly isProduction: boolean;
  private readonly cleanBaseUrl: string;

  /**
   * @ru Создаёт экземпляр BrowserTransport.
   * @en Creates a BrowserTransport instance.
   * @param config - Transport configuration.
   */
  constructor(public config: BrowserTransportConfig) {
    const isLocalhost =
      typeof window !== "undefined" &&
      ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

    const hasProcess = typeof process !== "undefined" && process.env;
    const hasMeta = typeof import.meta !== "undefined";

    this.isProduction =
      !isLocalhost &&
      ((hasProcess && process.env.NODE_ENV === "production") ||
        (hasMeta && (import.meta as unknown as ImportMetaEnv).env?.PROD === true));

    const base = config.baseUrl ?? (typeof window !== "undefined" ? window.location.origin : "");
    this.cleanBaseUrl = base.endsWith("/") ? base.slice(0, -1) : base;
  }

  /**
   * @ru Выполняет HTTP-запрос через глобальный fetch.
   * @en Executes an HTTP request via the global fetch.
   * @param req - The normalized transport request.
   * @returns Promise resolving to the transport response.
   */
  public async execute(req: TransportRequest): Promise<TransportResponse> {
    const urlStr = req.url;

    const isAbsolute = urlStr.charCodeAt(0) === 104 && urlStr.charCodeAt(1) === 116; // 'h' = 104, 't' = 116

    const fullUrl = isAbsolute
      ? urlStr
      : urlStr.charCodeAt(0) === 47 // '/' = 47
        ? this.cleanBaseUrl + urlStr
        : this.cleanBaseUrl + "/" + urlStr;

    if (this.isProduction && fullUrl.includes("//localhost")) {
      throw new Error("Localhost URL detected in production environment");
    }

    let body: unknown = req.body;

    let headers = (req.headers as Record<string, string> | undefined) ?? {};

    if (body !== null && typeof body === "object") {
      const proto = Object.getPrototypeOf(body) as unknown;
      if (proto === Object.prototype || proto === null) {
        body = JSON.stringify(body);
        if (!headers["Content-Type"]) {
          headers = { ...headers, "Content-Type": "application/json" };
        }
      }
    }

    const res = await globalThis.fetch(fullUrl, {
      method: req.method,
      headers: headers as HeadersInit,
      body: body as BodyInit | null,
      signal: req.signal,
    });

    const headersObj: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headersObj[key] = value;
    });

    return {
      status: res.status,
      headers: headersObj,
      url: res.url,
      body: res.body as unknown as TransportResponsePayload,
      _raw: res,
    } as TransportResponse;
  }
}
