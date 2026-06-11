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

const fetchFn: typeof globalThis.fetch = globalThis.fetch;

function installReadableStreamDump(): void {
  if (typeof ReadableStream === "undefined") return;

  const proto = ReadableStream.prototype as ReadableStream & {
    dump?: () => Promise<void>;
  };

  if (typeof proto.dump === "function") return;

  Object.defineProperty(proto, "dump", {
    value: async function () {
      try {
        return await this.cancel();
      } catch {
        //
      }
    },
    writable: true,
    configurable: true,
  });
}

installReadableStreamDump();

function isAbsoluteHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function resolveUrl(baseUrl: string, url: string): string {
  if (isAbsoluteHttpUrl(url)) return url;
  return url.charCodeAt(0) === 47 ? baseUrl + url : baseUrl + "/" + url;
}

function isLocalhostUrl(url: string): boolean {
  const schemeIdx = url.indexOf("://");
  if (schemeIdx === -1) return false;

  const hostStart = schemeIdx + 3;
  let hostEnd = url.indexOf("/", hostStart);
  if (hostEnd === -1) hostEnd = url.length;

  const host = url.slice(hostStart, hostEnd);
  return host === "localhost" || host.startsWith("localhost:");
}

function normalizeHeaders(
  headers: TransportRequest["headers"],
): Record<string, string> | undefined {
  if (!headers) return undefined;

  if (headers instanceof Headers) {
    const out: Record<string, string> = Object.create(null);
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }

  if (Array.isArray(headers)) {
    const out: Record<string, string> = Object.create(null);
    for (let i = 0; i < headers.length; i++) {
      const pair = headers[i] as unknown as [string, string] | undefined;
      if (!pair) continue;
      out[pair[0]] = pair[1];
    }
    return out;
  }

  const out: Record<string, string> = Object.create(null);
  const src = headers as Record<string, unknown>;

  for (const key in src) {
    const value = src[key];
    if (value == null) continue;

    if (Array.isArray(value)) {
      out[key] = key.toLowerCase() === "cookie" ? value.join("; ") : value.join(", ");
      continue;
    }

    out[key] = String(value);
  }

  return out;
}

function normalizeBody(body: TransportRequest["body"]): BodyInit | undefined {
  if (body === undefined || body === null) return undefined;

  if (
    typeof body === "string" ||
    body instanceof Uint8Array ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) ||
    (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) ||
    (typeof FormData !== "undefined" && body instanceof FormData) ||
    (typeof Blob !== "undefined" && body instanceof Blob)
  ) {
    return body as BodyInit;
  }

  if (typeof body === "object") {
    return JSON.stringify(body);
  }

  return String(body);
}

/**
 * @ru Реализация транспорта для Node.js с использованием fetch.
 * @en Node.js transport implementation using fetch.
 */
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
    const fullUrl = resolveUrl(this.cleanBaseUrl, req.url);

    if (this.isProduction && isLocalhostUrl(fullUrl)) {
      throw new Error("Localhost URL detected in production environment");
    }

    const headers = normalizeHeaders(req.headers);
    const body = normalizeBody(req.body);

    const res = await fetchFn(fullUrl, {
      method: req.method,
      headers,
      body,
      signal: req.signal,
    });

    const stream = (res.body ?? new ReadableStream()) as TransportResponsePayload;

    const resHeaders: Record<string, string> = Object.create(null);
    res.headers.forEach((value, key) => {
      resHeaders[key] = value;
    });

    return {
      status: res.status,
      headers: resHeaders,
      url: res.url,
      body: stream,
    };
  }
}
