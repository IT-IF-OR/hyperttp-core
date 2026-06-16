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
 * @en Interface for safe access to bundler meta-environment (Vite, Webpack, etc.).
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

    const isAbsolute =
      urlStr.startsWith("http://") || urlStr.startsWith("https://") || urlStr.startsWith("//");

    const fullUrl = isAbsolute
      ? urlStr
      : urlStr.charCodeAt(0) === 47
        ? this.cleanBaseUrl + urlStr
        : this.cleanBaseUrl + "/" + urlStr;

    if (this.isProduction && fullUrl.includes("//localhost")) {
      throw new Error("Localhost URL detected in production environment");
    }

    const finalHeaders: Record<string, string> = Object.create(null);
    if (req.headers) {
      if (req.headers instanceof Headers) {
        req.headers.forEach((value, key) => {
          finalHeaders[key.toLowerCase()] = value;
        });
      } else if (Array.isArray(req.headers)) {
        for (let i = 0; i < req.headers.length; i++) {
          const pair = req.headers[i] as unknown as [string, string] | undefined;
          if (pair && typeof pair[0] === "string") {
            finalHeaders[pair[0].toLowerCase()] = String(pair[1]);
          }
        }
      } else {
        const src = req.headers as Record<string, unknown>;
        for (const key in src) {
          const value = src[key];
          if (value != null) {
            finalHeaders[key.toLowerCase()] = Array.isArray(value)
              ? value.join(", ")
              : String(value);
          }
        }
      }
    }

    const res = await globalThis.fetch(fullUrl, {
      method: req.method,
      headers: finalHeaders as HeadersInit,
      body: req.body as BodyInit | null,
      signal: req.signal,
    });

    const resHeaders: Record<string, string> = Object.create(null);
    res.headers.forEach((value, key) => {
      resHeaders[key] = value;
    });

    return {
      status: res.status,
      url: res.url,
      body: res.body as unknown as TransportResponsePayload,
      headers: resHeaders,
      _raw: res,
    } as TransportResponse;
  }
}
