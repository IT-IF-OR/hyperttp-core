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

export class NodeTransport implements HyperTransport {
  public config: NodeTransportConfig;
  private readonly isProduction: boolean;
  private readonly cleanBaseUrl: string;

  constructor(config: NodeTransportConfig) {
    this.config = config;
    this.isProduction = process.env.NODE_ENV === "production";

    const base = config.baseUrl ?? "http://localhost:3000";
    this.cleanBaseUrl = base.endsWith("/") ? base.slice(0, -1) : base;
  }

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
