import { HttpClientOptions } from "../types/options.js";
import type {
  HyperTransport,
  TransportRequest,
  TransportResponse,
} from "../types/transport.js";

function fastGetHostname(url: string): string {
  const start = url.indexOf("//") + 2;
  if (start === 1) return "localhost";
  let end = url.indexOf("/", start);
  if (end === -1) end = url.indexOf("?", start);
  if (end === -1) end = url.length;

  const host = url.slice(start, end);
  const portIdx = host.indexOf(":");
  return portIdx !== -1 ? host.slice(0, portIdx) : host;
}

export class BunTransport implements HyperTransport {
  private cookieJar = new Map<string, Map<string, string>>();
  private config: HttpClientOptions;

  private activeRequests = 0;
  private concurrencyQueue: (() => void)[] = [];

  constructor(config: HttpClientOptions) {
    this.config = config;
  }

  public async execute(req: TransportRequest): Promise<TransportResponse> {
    const netConfig = this.config.network;
    const maxConcurrent = netConfig?.maxConcurrent ?? 0;

    if (maxConcurrent > 0 && this.activeRequests >= maxConcurrent) {
      await new Promise<void>((resolve) => {
        this.concurrencyQueue.push(resolve);
      });
    }
    this.activeRequests++;

    try {
      const domain = fastGetHostname(req.url);
      let headers = req.headers;
      let hasCloned = false;

      if (
        netConfig?.userAgent &&
        !headers["User-Agent"] &&
        !headers["user-agent"]
      ) {
        headers = { ...headers, "User-Agent": netConfig.userAgent };
        hasCloned = true;
      }

      const savedCookies = this.getCookiesForDomain(domain);
      if (savedCookies) {
        if (!hasCloned) headers = { ...headers };
        headers["Cookie"] = headers["Cookie"]
          ? `${headers["Cookie"]}; ${savedCookies}`
          : savedCookies;
      }

      let signal = req.signal;
      if (netConfig?.timeout && netConfig.timeout > 0) {
        const timeoutSignal = AbortSignal.timeout(netConfig.timeout);
        signal = req.signal
          ? AbortSignal.any([req.signal, timeoutSignal])
          : timeoutSignal;
      }

      const response = await fetch(req.url, {
        method: req.method,
        headers: headers as Record<string, string>,
        body: req.body as any,
        signal: signal,
        keepalive: !!netConfig?.keepAliveTimeout,
        redirect: "manual",
      });

      const setCookies = response.headers.getSetCookie();
      if (setCookies && setCookies.length > 0) {
        this.updateCookies(domain, setCookies);
      }

      const responseHeaders = (response.headers as any).toJSON?.() ?? {};
      const body = response.body;

      if (body) {
        Object.defineProperty(body, "dump", {
          value: async function (this: ReadableStream) {
            if (this.locked) return;
            try {
              for await (const chunk of this) {
                void chunk;
              }
            } catch {
              //
            }
          },
          writable: true,
          configurable: true,
          enumerable: false,
        });
      }

      return {
        status: response.status,
        headers: responseHeaders,
        body: body,
        url: response.url,
      };
    } finally {
      this.activeRequests--;
      const nextResolver = this.concurrencyQueue.shift();
      if (nextResolver) nextResolver();
    }
  }

  private getCookiesForDomain(requestDomain: string): string {
    const matchedCookies: string[] = [];

    for (const [storedDomain, cookiesMap] of this.cookieJar) {
      if (
        requestDomain === storedDomain ||
        requestDomain.endsWith("." + storedDomain)
      ) {
        for (const [key, val] of cookiesMap) {
          matchedCookies.push(`${key}=${val}`);
        }
      }
    }

    return matchedCookies.length > 0 ? matchedCookies.join("; ") : "";
  }

  private updateCookies(requestDomain: string, setCookies: string[]): void {
    for (let i = 0; i < setCookies.length; i++) {
      const cookieStr = setCookies[i];
      const parts = cookieStr.split(";");

      const rawPair = parts[0];
      const equalIdx = rawPair.indexOf("=");
      if (equalIdx === -1) continue;

      const key = rawPair.slice(0, equalIdx).trim();
      const val = rawPair.slice(equalIdx + 1).trim();
      if (!key) continue;

      let targetDomain = requestDomain;
      for (let j = 1; j < parts.length; j++) {
        const attr = parts[j].trim();
        if (attr.toLowerCase().startsWith("domain=")) {
          let domVal = attr.slice(7).trim();
          if (domVal.startsWith(".")) {
            domVal = domVal.slice(1);
          }
          if (domVal) targetDomain = domVal;
          break;
        }
      }

      let domainMap = this.cookieJar.get(targetDomain);
      if (!domainMap) {
        domainMap = new Map<string, string>();
        this.cookieJar.set(targetDomain, domainMap);
      }

      domainMap.set(key, val);
    }
  }

  public async destroy(): Promise<void> {
    this.cookieJar.clear();
    this.concurrencyQueue = [];
  }
}
