import type {
  HyperReceiver,
  ServerRequestContext,
  TransportRequest,
  TransportResponse,
} from "@hyperttp/types";
import type { RestServerHandler, RestServerInput, RestServerResponse } from "./type.js";
import { HyperClientError } from "../../utils/errors.js";

const JSON_TYPE = "application/json";
const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();
const HAS_BUFFER = typeof Buffer !== "undefined";

function decodeUtf8(bytes: Uint8Array): string {
  if (HAS_BUFFER) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");
  }
  return TEXT_DECODER.decode(bytes);
}

function decodeArrayBuffer(ab: ArrayBuffer): string {
  if (HAS_BUFFER) {
    return Buffer.from(ab).toString("utf8");
  }
  return TEXT_DECODER.decode(ab);
}

function encodeUtf8(str: string): Uint8Array {
  if (HAS_BUFFER) {
    return Buffer.from(str);
  }
  return TEXT_ENCODER.encode(str);
}

const defaultStatusTexts: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  500: "Internal Server Error",
};

/**
 * @ru Разбирает query-строку URL в словарь (поддерживает повторные ключи как массивы).
 * @en Parses a URL query string into a dictionary (supports repeated keys as arrays).
 */
function parseQuery(queryString: string): Record<string, string | string[]> {
  if (!queryString) return {};
  const out: Record<string, string | string[]> = {};

  for (const [key, value] of new URLSearchParams(queryString)) {
    const existing = out[key];
    if (existing === undefined) {
      out[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[key] = [existing, value];
    }
  }

  return out;
}

/**
 * @ru Регистронезависимое получение значения заголовка.
 * @en Case-insensitive header value lookup.
 */
function getHeaderValue(
  headers: Readonly<Record<string, string | string[]>>,
  name: string,
): string | undefined {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (direct !== undefined) {
    return Array.isArray(direct) ? direct[0] : direct;
  }
  const targetKey = name.toLowerCase();
  for (const key in headers) {
    if (key.toLowerCase() === targetKey) {
      const val = headers[key];
      return Array.isArray(val) ? val[0] : val;
    }
  }
  return undefined;
}

/**
 * @ru Декодирует тело запроса по content-type.
 * @en Decodes the request body based on content-type.
 */
function parseTextBody(
  headers: Readonly<Record<string, string | string[]>>,
  text: string,
): unknown {
  const contentType = getHeaderValue(headers, "content-type") ?? "";
  if (contentType.includes(JSON_TYPE)) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function decodeBody(raw: TransportRequest): unknown {
  const body = raw.body;
  if (body == null) return undefined;
  if (body instanceof Uint8Array) {
    return parseTextBody(raw.headers, decodeUtf8(body));
  }
  if (body instanceof ArrayBuffer) {
    return parseTextBody(raw.headers, decodeArrayBuffer(body));
  }
  if (typeof body === "string") return parseTextBody(raw.headers, body);
  return body;
}

/**
 * @ru REST/HTTP серверный адаптер. Зеркальная к `RestSender` реализация
 * трёхфазного цикла receive → handle → respond.
 * @en REST/HTTP server adapter. Mirror implementation of `RestSender` for the
 * three-phase receive → handle → respond cycle.
 */
export class RestReceiver implements HyperReceiver<
  RestServerInput,
  RestServerResponse,
  TransportRequest,
  TransportResponse
> {
  readonly protocol = "rest";
  protected readonly handler?: RestServerHandler;

  constructor(options: { handler?: RestServerHandler } = {}) {
    this.handler = options.handler;
  }

  /**
   * @ru Фаза приёма: разбирает сырой запрос транспорта в REST-структуру.
   * @en Receive phase: parses raw transport request into REST input structure.
   */
  receive(raw: TransportRequest, _ctx: ServerRequestContext): RestServerInput {
    const url = new URL(raw.url, "http://hyperttp.local");

    return {
      method: raw.method,
      path: url.pathname,
      headers: raw.headers,
      query: parseQuery(url.search.slice(1)),
      body: decodeBody(raw),
    };
  }

  /**
   * @ru Фаза обработки: вызывает зарегистрированный handler.
   * @en Handle phase: executes the registered application handler.
   */
  handle(
    request: RestServerInput,
    ctx: ServerRequestContext,
  ): RestServerResponse | Promise<RestServerResponse> {
    if (ctx.signal?.aborted) {
      throw ctx.signal.reason ?? new Error("Request aborted");
    }

    if (!this.handler) {
      throw new HyperClientError(
        '[RestReceiver] No application handler registered for protocol "rest".',
      );
    }

    return this.handler(request, ctx);
  }

  /**
   * @ru Фаза ответа: сериализует протокольный ответ в транспортный формат.
   * @en Respond phase: serializes protocol response to raw transport format.
   */
  respond(response: RestServerResponse, _ctx: ServerRequestContext): TransportResponse {
    const headers: Record<string, string> = { ...response.headers };
    const status = response.status ?? 200;

    let body: unknown = response.body;
    if (body instanceof ArrayBuffer) {
      body = new Uint8Array(body);
    } else if (ArrayBuffer.isView(body) && !(body instanceof Uint8Array)) {
      body = new Uint8Array(body.buffer, body.byteOffset, body.byteLength).slice();
    } else if (body != null && typeof body === "object" && !(body instanceof Uint8Array)) {
      body = JSON.stringify(body);
      const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
      if (!hasContentType) headers["content-type"] = JSON_TYPE;
    }

    return {
      status,
      statusText: defaultStatusTexts[status] ?? "",
      headers,
      body: body == null ? undefined : body instanceof Uint8Array ? body : encodeUtf8(String(body)),
    };
  }
}
