import type {
  Fingerprint,
  HttpClientOptions,
  HyperTransport,
  StealthOptions,
  TransportRequest,
  TransportResponse,
  TransportResponsePayload,
} from "@hyperttp/types";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Readable, Transform } from "node:stream";
import tls from "node:tls";
import zlib from "node:zlib";

/**
 * @ru Конфигурация транспорта для Node.js с использованием нативных http/https модулей.
 * @en Node.js transport configuration using native http/https modules.
 */
export interface NodeTransportConfig extends HttpClientOptions {
  /**
   * @ru Базовый URL для относительных путей.
   * @en Base URL for relative paths.
   */
  baseUrl?: string;
  /**
   * @ru Настройки stealth-маскировки на уровне транспорта.
   * @en Stealth masking settings at the transport level.
   */
  stealth?: StealthOptions;
}

/**
 * @ru Статические пресеты браузерных заголовков для маскировки под реальных пользователей.
 * Используются stealth-режимом для обхода fingerprint-защит.
 * @en Static presets of browser headers for masking as real users.
 * Used by stealth mode to bypass fingerprint protections.
 */
const STEALTH_HEADER_PRESETS: Record<string, Record<string, string>> = {
  chrome: {
    "sec-ch-ua": '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Linux"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "accept-language": "en-US,en;q=0.9",
  },
  firefox: {
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "accept-language": "en-US,en;q=0.5",
    "upgrade-insecure-requests": "1",
  },
};

/**
 * @ru Пресеты User-Agent, соответствующие TLS-отпечаткам (JA3/JA4).
 * @en User-Agent presets matching the TLS fingerprints (JA3/JA4).
 */
const STEALTH_UA_PRESETS: Record<string, string> = {
  chrome:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  firefox: "Mozilla/5.0 (X11; Linux; rv:126.0) Gecko/20100101 Firefox/126.0",
  safari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  edge: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
};

/**
 * @ru Возвращает строку шифров TLS для указанного профиля браузера.
 * @en Returns the TLS cipher suite string for the specified browser profile.
 * @param fingerprint - Browser fingerprint profile.
 * @returns Colon-separated cipher suite string, or empty string if not found.
 */
function getCiphersForProfile(fingerprint: Fingerprint | undefined): string {
  if (!fingerprint) return "";

  switch (fingerprint) {
    case "chrome":
    case "edge":
      return [
        "TLS_AES_128_GCM_SHA256",
        "TLS_AES_256_GCM_SHA384",
        "TLS_CHACHA20_POLY1305_SHA256",
        "ECDHE-ECDSA-AES128-GCM-SHA256",
        "ECDHE-RSA-AES128-GCM-SHA256",
      ].join(":");

    case "firefox":
      return [
        "TLS_AES_128_GCM_SHA256",
        "TLS_CHACHA20_POLY1305_SHA256",
        "TLS_AES_256_GCM_SHA384",
        "ECDHE-ECDSA-AES128-GCM-SHA256",
        "ECDHE-RSA-AES128-GCM-SHA256",
      ].join(":");

    case "safari":
      return [
        "TLS_AES_256_GCM_SHA384",
        "TLS_CHACHA20_POLY1305_SHA256",
        "TLS_AES_128_GCM_SHA256",
        "ECDHE-ECDSA-AES256-GCM-SHA384",
        "ECDHE-RSA-AES256-GCM-SHA384",
      ].join(":");

    default:
      return "";
  }
}

/**
 * @ru Безопасно применяет стелс-пресеты, отдавая абсолютный приоритет ручным заголовкам.
 * @en Safely applies stealth presets, giving absolute priority to manual headers.
 * @param headers - The headers object to modify.
 * @param stealth - Stealth configuration options.
 * @returns The modified headers object.
 */
function applyStealthHeaders(
  headers: Record<string, string>,
  stealth: StealthOptions,
): Record<string, string> {
  if (!stealth || !stealth.fingerprint) return headers;

  const presetName = stealth.fingerprint;
  const presetHeaders = STEALTH_HEADER_PRESETS[presetName];

  if (presetHeaders) {
    for (const key in presetHeaders) {
      if (headers[key] === undefined) {
        headers[key] = presetHeaders[key]!;
      }
    }
  }

  const currentUA = headers["user-agent"];
  if (currentUA === undefined || currentUA === "hyperttp/2.0" || currentUA === "Hyperttp/2.0") {
    const browserUA = STEALTH_UA_PRESETS[presetName];
    if (browserUA) {
      headers["user-agent"] = browserUA;
    }
  }

  return headers;
}

/**
 * @ru Создаёт нативный HTTP/HTTPS агент с учётом stealth-настроек.
 * @en Creates a native HTTP/HTTPS agent considering stealth settings.
 * @param isHttps - Whether the connection is HTTPS.
 * @param stealth - Optional stealth configuration.
 * @param cache - The agent cache map to use (per-instance).
 * @returns The HTTP or HTTPS agent.
 */
function getNativeAgent(
  isHttps: boolean,
  stealth: StealthOptions | undefined,
  cache: Map<string, http.Agent | https.Agent>,
  rejectUnauthorized?: boolean,
): http.Agent | https.Agent {
  const fingerprint = stealth?.fingerprint ?? "none";
  const fragment = stealth?.fragment ?? "none";
  const needHttp2 = stealth?.http2 === true;
  const cacheKey = `${isHttps ? "https" : "http"}:${fingerprint}:${fragment}:${needHttp2 ? "h2" : "1.1"}`;

  let agent = cache.get(cacheKey);
  if (agent) return agent;

  const agentOpts: any = {
    keepAlive: true,
    maxSockets: 256,
  };

  if (rejectUnauthorized !== undefined) {
    agentOpts.rejectUnauthorized = rejectUnauthorized;
  }

  if (isHttps) {
    agentOpts.ciphers = getCiphersForProfile(stealth?.fingerprint);

    const needCustomConnect = fragment === "split" || needHttp2;

    if (needCustomConnect) {
      const alpnProtocols: string[] | undefined = needHttp2 ? ["h2", "http/1.1"] : undefined;

      agentOpts.createConnection = (
        options: any,
        callback: (err: Error | null, socket?: any) => void,
      ) => {
        let alpnFallback = false;

        const createTlsConnection = (
          alpn: string[] | undefined,
          cb: (err: Error | null, socket?: any) => void,
        ) => {
          const socket = net.connect(options);

          if (fragment === "split") {
            const originalWrite = socket.write;
            let isFirstWrite = true;

            socket.write = function (
              this: net.Socket,
              chunk: Uint8Array | string,
              encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
              cb?: (err?: Error | null) => void,
            ): boolean {
              if (isFirstWrite && chunk instanceof Uint8Array && chunk.length > 5) {
                isFirstWrite = false;
                this.write = originalWrite;

                let encoding: BufferEncoding | undefined;
                let callbackRef: ((err?: Error | null) => void) | undefined;

                if (typeof encodingOrCb === "function") {
                  callbackRef = encodingOrCb;
                } else {
                  encoding = encodingOrCb;
                  callbackRef = cb;
                }

                const part1 = chunk.subarray(0, 3);
                const part2 = chunk.subarray(3);

                const onError = (err: Error) => {
                  callbackRef?.(err);
                };

                try {
                  originalWrite.call(this, part1, encoding);
                } catch (err) {
                  onError(err as Error);
                  return false;
                }
                return originalWrite.call(this, part2, encoding, callbackRef);
              }

              this.write = originalWrite;
              return originalWrite.call(this, chunk, encodingOrCb as any, cb as any);
            } as any;
          }

          const tlsOpts: any = {
            ...options,
            socket,
            ciphers: agentOpts.ciphers,
          };
          if (alpn) tlsOpts.ALPNProtocols = alpn;

          const tlsSocket = tls.connect(tlsOpts);

          tlsSocket.once("secureConnect", () => {
            if (alpn && tlsSocket.alpnProtocol === "h2" && !alpnFallback) {
              alpnFallback = true;
              tlsSocket.destroy();
              createTlsConnection(["http/1.1"], cb);
              return;
            }
            cb(null, tlsSocket);
          });
          tlsSocket.once("error", (err) => cb(err));
        };

        return createTlsConnection(alpnProtocols, callback);
      };
    }

    agent = new https.Agent(agentOpts);
  } else {
    agent = new http.Agent(agentOpts);
  }

  cache.set(cacheKey, agent);
  return agent;
}

function isAbsoluteHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function resolveUrl(baseUrl: string, url: string): string {
  if (!url) throw new Error("URL is empty");
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

function normalizeHeaders(headers: TransportRequest["headers"]): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!headers) return out;

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }

  if (Array.isArray(headers)) {
    for (let i = 0; i < headers.length; i++) {
      const pair = headers[i] as unknown as [string, string] | undefined;
      if (!pair || typeof pair[0] !== "string") continue;
      out[pair[0].toLowerCase()] = String(pair[1]);
    }
    return out;
  }

  const src = headers as Record<string, unknown>;
  for (const key in src) {
    const value = src[key];
    if (value == null) continue;

    const lKey = key.toLowerCase();
    if (Array.isArray(value)) {
      out[lKey] = lKey === "cookie" ? value.join("; ") : value.join(", ");
      continue;
    }

    out[lKey] = String(value);
  }

  return out;
}

function createSizeLimitTransform(maxBytes: number): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) {
        callback(new Error(`[Hyperttp] Response size exceeded limit of ${maxBytes} bytes`));
        return;
      }
      callback(null, chunk);
    },
  });
}

/**
 * @ru Реализация транспорта для Node.js с использованием нативных http/https модулей.
 * Поддерживает stealth-маскировку, фрагментацию TLS Client Hello и автоматическую декомпрессию.
 */
export class NodeTransport implements HyperTransport {
  public config: NodeTransportConfig;
  private readonly isProduction: boolean;
  private readonly cleanBaseUrl: string;
  private readonly agentCache = new Map<string, http.Agent | https.Agent>();

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

    let headers = normalizeHeaders(req.headers);

    if (headers["accept-encoding"] === undefined) {
      headers["accept-encoding"] = "gzip, deflate, br";
    }

    const stealthOpts = req.stealth ?? this.config.stealth ?? this.config.network?.stealth;
    if (stealthOpts) {
      headers = applyStealthHeaders(headers, stealthOpts);
    }

    const body = req.body;
    const urlObj = new URL(fullUrl);
    const isHttps = urlObj.protocol === "https:";
    const agent = getNativeAgent(isHttps, stealthOpts, this.agentCache, this.config.network?.rejectUnauthorized);

    return new Promise((resolve, reject) => {
      const reqOpts: http.RequestOptions | https.RequestOptions = {
        method: req.method,
        headers,
        agent,
        signal: req.signal,
      };

      let settled = false;

      const clientReq = (isHttps ? https : http).request(fullUrl, reqOpts, (res) => {
        const resHeaders: Record<string, string> = Object.create(null);
        for (const key in res.headers) {
          const val = res.headers[key];
          if (val !== undefined) {
            resHeaders[key] = Array.isArray(val) ? val.join(", ") : val;
          }
        }

        let responseStream: Readable = res;
        const encoding = resHeaders["content-encoding"]?.toLowerCase();

        if (encoding === "gzip") {
          const gunzip = zlib.createGunzip();
          gunzip.on("error", (err) => {
            res.destroy(err);
            if (!settled) reject(err);
          });
          responseStream = res.pipe(gunzip);
          delete resHeaders["content-encoding"];
          delete resHeaders["content-length"];
        } else if (encoding === "deflate") {
          const inflate = zlib.createInflate();
          inflate.on("error", (err) => {
            res.destroy(err);
            if (!settled) reject(err);
          });
          responseStream = res.pipe(inflate);
          delete resHeaders["content-encoding"];
          delete resHeaders["content-length"];
        } else if (encoding === "br") {
          const brotli = zlib.createBrotliDecompress();
          brotli.on("error", (err) => {
            res.destroy(err);
            if (!settled) reject(err);
          });
          responseStream = res.pipe(brotli);
          delete resHeaders["content-encoding"];
          delete resHeaders["content-length"];
        }

        const maxBytes = this.config.network?.maxResponseBytes;
        if (maxBytes != null && maxBytes > 0) {
          const limiter = createSizeLimitTransform(maxBytes);
          limiter.on("error", (err) => {
            res.destroy(err);
            if (!settled) reject(err);
          });
          responseStream = responseStream.pipe(limiter);
        }

        responseStream.on("error", (err) => {
          if (!settled) reject(err);
        });

        settled = true;
        resolve({
          status: res.statusCode ?? 200,
          headers: resHeaders,
          url: fullUrl,
          body: Readable.toWeb(responseStream) as unknown as TransportResponsePayload,
        });
      });

      clientReq.on("error", (err) => {
        if (!settled) reject(err);
      });

      if (body !== undefined && body !== null) {
        if (typeof body === "string" || body instanceof Uint8Array || ArrayBuffer.isView(body)) {
          clientReq.write(body);
          clientReq.end();
        } else if (body instanceof ArrayBuffer) {
          clientReq.write(Buffer.from(body));
          clientReq.end();
        } else if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
          Readable.fromWeb(body as any).pipe(clientReq);
        } else {
          clientReq.end();
        }
      } else {
        clientReq.end();
      }
    });
  }

  public async close(): Promise<void> {
    for (const agent of this.agentCache.values()) {
      agent.destroy();
    }
    this.agentCache.clear();
  }

  public async destroy(): Promise<void> {
    for (const agent of this.agentCache.values()) {
      agent.destroy();
    }
    this.agentCache.clear();
  }
}
