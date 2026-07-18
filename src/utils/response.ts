import type { HttpResponse, HyperTransport, HyperBody } from "@hyperttp/types";
import { CURRENT_RUNTIME } from "../transports/manager.js";

type TransportResponse = Awaited<ReturnType<HyperTransport["execute"]>>;

interface InternalTransportResponse extends TransportResponse {
  _raw?: FetchResponseLike;
}

interface FetchResponseLike {
  body: unknown;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

const RAW_CACHE = Symbol("hyperttp.rawCache");
const TEXT_CACHE = Symbol("hyperttp.textCache");
const JSON_CACHE = Symbol("hyperttp.jsonCache");

type CacheHolder = {
  [RAW_CACHE]?: Uint8Array;
  [TEXT_CACHE]?: string;
  [JSON_CACHE]?: unknown;
};

const STATIC_DECODER = new TextDecoder();
const STATIC_ENCODER = new TextEncoder();
const EMPTY_HEADERS: Readonly<Record<string, never>> = Object.freeze({});

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    typeof value === "object" &&
    value !== null &&
    "getReader" in value &&
    typeof (value as Record<string, unknown>).getReader === "function"
  );
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

/**
 * @ru Быстрое клонирование тела ответа с поддержкой structuredClone, JSON и ручного копирования.
 * @en Fast response body clone supporting structuredClone, JSON, and manual copy.
 * @param body - The body value to clone.
 * @returns Cloned body.
 */
export const cloneBodyFast = <T>(body: T): T => {
  if (typeof body !== "object" || body === null) return body;
  const obj = body as Record<string, unknown>;

  if (
    body instanceof Uint8Array ||
    typeof obj.pipe === "function" ||
    typeof obj.getReader === "function"
  ) {
    return body;
  }

  const proto = Object.getPrototypeOf(body);
  if (proto === Object.prototype || proto === null) {
    const target = Object.create(proto);
    for (const key in body) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        target[key] = body[key];
      }
    }
    return target as T;
  }

  try {
    return structuredClone(body);
  } catch {
    try {
      return JSON.parse(JSON.stringify(body)) as T;
    } catch {
      const target = Object.create(proto);
      for (const key in body) {
        if (Object.prototype.hasOwnProperty.call(body, key)) {
          target[key] = body[key];
        }
      }
      return target as T;
    }
  }
};

/**
 * @ru Реализация HttpResponse с ленивым потреблением тела, кэшированием raw/text/json и поддержкой пулинга.
 * @en HttpResponse implementation with lazy body consumption, raw/text/json caching, and pooling support.
 */
export class HyperHttpResponse<T = unknown> implements HttpResponse<T>, CacheHolder {
  public status!: number;
  public headers!: Record<string, string | string[]>;
  public body!: T | HyperBody | Uint8Array | null;
  public url!: string;
  public data!: T | null;

  public [RAW_CACHE]!: Uint8Array | undefined;
  public [TEXT_CACHE]!: string | undefined;
  public [JSON_CACHE]!: unknown | undefined;

  private _bodyConsumed!: boolean;
  private _raw!: FetchResponseLike | undefined;

  constructor(rawResponse?: TransportResponse) {
    this.status = 0;
    this.headers = EMPTY_HEADERS;
    this.body = null;
    this.url = "";
    this.data = null;
    this[RAW_CACHE] = undefined;
    this[TEXT_CACHE] = undefined;
    this[JSON_CACHE] = undefined;
    this._bodyConsumed = false;
    this._raw = undefined;
    if (rawResponse) this.init(rawResponse);
  }

  /**
   * @ru Инициализирует ответ из транспортного ответа. Сбрасывает все кэши.
   * @en Initializes the response from a transport response. Resets all caches.
   * @param rawResponse - The raw transport response.
   * @returns This instance for chaining.
   */
  public init(rawResponse: TransportResponse): this {
    this.status = rawResponse.status;
    this.headers = rawResponse.headers || EMPTY_HEADERS;
    this.body = rawResponse.body as T | HyperBody | Uint8Array | null;
    this.url = rawResponse.url ?? "";
    this.data = null;
    this[RAW_CACHE] = undefined;
    this[TEXT_CACHE] = undefined;
    this[JSON_CACHE] = undefined;
    this._bodyConsumed = false;
    this._raw = (rawResponse as InternalTransportResponse)._raw;
    return this;
  }

  private async _consumeBody(): Promise<void> {
    if (this[RAW_CACHE] !== undefined) return;

    const body = this.body;
    if (!body) return;

    if (body instanceof Uint8Array) {
      this[RAW_CACHE] = body;
      this._bodyConsumed = true;
      return;
    }

    if (typeof body === "string") {
      this[RAW_CACHE] = STATIC_ENCODER.encode(body);
      this._bodyConsumed = true;
      return;
    }

    if (body instanceof ArrayBuffer) {
      this[RAW_CACHE] = new Uint8Array(body);
      this._bodyConsumed = true;
      return;
    }

    if (this._raw && body === this._raw.body && typeof this._raw.arrayBuffer === "function") {
      const buf = await this._raw.arrayBuffer();
      this[RAW_CACHE] = new Uint8Array(buf);
      this.body = this[RAW_CACHE] as T | HyperBody | Uint8Array | null;
      this._bodyConsumed = true;
      return;
    }

    if (CURRENT_RUNTIME === "bun" && body && typeof body === "object" && "arrayBuffer" in body) {
      const bunBody = body as { arrayBuffer: () => Promise<ArrayBuffer> };
      if (typeof bunBody.arrayBuffer === "function") {
        const buf = await bunBody.arrayBuffer();
        this[RAW_CACHE] = new Uint8Array(buf);
        this.body = this[RAW_CACHE] as T | HyperBody | Uint8Array | null;
        this._bodyConsumed = true;
        return;
      }
    }

    if (isReadableStream(body) || isBlob(body)) {
      if (isReadableStream(body) && body.locked) {
        throw new Error("[Hyperttp] Stream is locked.");
      }
      const response = new Response(body as unknown as BodyInit);
      const buf = await response.arrayBuffer();
      this[RAW_CACHE] = new Uint8Array(buf);
      this.body = this[RAW_CACHE] as T | HyperBody | Uint8Array | null;
      this._bodyConsumed = true;
    }
  }

  /**
   * @ru Возвращает тело ответа как ArrayBuffer, потребляя его при необходимости.
   * @en Returns the response body as ArrayBuffer, consuming it if necessary.
   * @returns Promise resolving to an ArrayBuffer.
   */
  public async arrayBuffer(): Promise<ArrayBuffer> {
    await this._consumeBody();
    if (this[RAW_CACHE] === undefined) {
      throw new Error("[Hyperttp] Response body is not available as ArrayBuffer");
    }
    return this[RAW_CACHE].buffer as ArrayBuffer;
  }

  /**
   * @ru Возвращает тело ответа как строку с кэшированием.
   * @en Returns the response body as text with caching.
   * @returns Promise resolving to the decoded text.
   */
  public async text(): Promise<string> {
    if (this[TEXT_CACHE] !== undefined) return this[TEXT_CACHE]!;
    await this._consumeBody();
    if (this[RAW_CACHE] === undefined) {
      throw new Error("[Hyperttp] Response body is not available as text");
    }
    this[TEXT_CACHE] = STATIC_DECODER.decode(this[RAW_CACHE]!);
    return this[TEXT_CACHE]!;
  }

  /**
   * @ru Возвращает тело ответа, разобранное как JSON. Для объектов возвращает их напрямую (без потребления).
   * @en Returns the response body parsed as JSON. Returns objects directly (no consumption).
   * @returns Promise resolving to the parsed JSON value.
   */
  public async json<TJson = T>(): Promise<TJson> {
    const body = this.body;
    if (
      !this._bodyConsumed &&
      typeof body === "object" &&
      body !== null &&
      !isReadableStream(body) &&
      !isBlob(body) &&
      !(body instanceof Uint8Array) &&
      !(body instanceof ArrayBuffer)
    ) {
      this._bodyConsumed = true;
      return body as TJson;
    }

    await this._consumeBody();
    if (this[RAW_CACHE] === undefined) {
      throw new Error("[Hyperttp] Response body is not available as JSON");
    }
    if (this[TEXT_CACHE] === undefined) {
      this[TEXT_CACHE] = STATIC_DECODER.decode(this[RAW_CACHE]!);
    }
    return JSON.parse(this[TEXT_CACHE]!) as TJson;
  }

  /**
   * @ru Полный сброс состояния для переиспользования в пуле. Очищает все кэши и приватные поля.
   * @en Full state reset for pool reuse. Clears all caches and private fields.
   */
  public reset(): void {
    this.status = 0;
    this.headers = EMPTY_HEADERS;
    this.body = null;
    this.url = "";
    this.data = null;
    this[RAW_CACHE] = undefined;
    this[TEXT_CACHE] = undefined;
    this[JSON_CACHE] = undefined;
    this._bodyConsumed = false;
    this._raw = undefined;
  }

  /**
   * @ru Сбрасывает тело ответа (для стримов — отменяет/cancel).
   * @en Discards the response body (cancels streams).
   * @returns Promise that resolves when the body is discarded.
   */
  public async dump(): Promise<void> {
    if (this._bodyConsumed) return;
    this._bodyConsumed = true;

    const body = this.body;
    if (isReadableStream(body)) {
      if (!body.locked) await body.cancel().catch(() => {});
    } else if (isBlob(body)) {
      await body.arrayBuffer();
    }
  }

  /**
   * @ru Клонирует ответ с разделением стримов через tee().
   * @en Clones the response, splitting streams via tee().
   * @returns A new HttpResponse instance.
   */
  public clone(): HttpResponse<T> {
    const cloned = new HyperHttpResponse<T>();
    cloned.status = this.status;
    cloned.headers = this.headers;
    cloned.url = this.url;
    cloned.data = this.data ? cloneBodyFast(this.data) : null;
    cloned._bodyConsumed = this._bodyConsumed;
    cloned._raw = this._bodyConsumed ? undefined : this._raw;

    cloned[RAW_CACHE] = this[RAW_CACHE];
    cloned[TEXT_CACHE] = this[TEXT_CACHE];
    cloned[JSON_CACHE] = this[JSON_CACHE];

    if (isReadableStream(this.body) && !this._bodyConsumed) {
      if (this.body.locked) {
        cloned.body = this.body;
      } else {
        const [b1, b2] = this.body.tee();
        this.body = b1 as T | HyperBody | Uint8Array | null;
        cloned.body = b2 as T | HyperBody | Uint8Array | null;
      }
    } else {
      cloned.body = this.body;
    }

    return cloned;
  }
}

export const responsePool: HyperHttpResponse<any>[] = [];
const RESPONSE_POOL_MAX = 64;

/**
 * @ru Создаёт HttpResponse из транспортного ответа с переиспользованием пула.
 * @en Creates an HttpResponse from a transport response reusing the pool.
 * @param rawResponse - The raw transport response.
 * @returns An HttpResponse instance.
 */
export const mapResponseFast = (rawResponse: TransportResponse): HttpResponse<unknown> => {
  const instance = responsePool.pop() ?? new HyperHttpResponse();
  return instance.init(rawResponse);
};

/**
 * @ru Возвращает HttpResponse в пул переиспользования.
 * @en Returns an HttpResponse to the reuse pool.
 * @param res - The response to recycle.
 */
export const recycleResponse = (res: HttpResponse<unknown>): void => {
  if (res instanceof HyperHttpResponse && responsePool.length < RESPONSE_POOL_MAX) {
    res.reset();
    responsePool.push(res);
  }
};

/**
 * @ru Создаёт StreamResponse без потребления тела.
 * @en Creates a StreamResponse without consuming the body.
 * @param rawResponse - The raw transport response.
 * @returns A StreamResponse-like object.
 */
export const mapStreamFast = (rawResponse: TransportResponse) => ({
  status: rawResponse.status,
  headers: rawResponse.headers,
  body: rawResponse.body,
  url: rawResponse.url ?? "",
});

/**
 * @ru Быстрое слияние заголовков с мутацией базового объекта.
 * @en Fast header merge mutating the base object.
 * @param base - Base headers object (mutated).
 * @param override - Optional headers to overlay.
 * @returns The mutated base headers object.
 */
export const mergeHeadersFast = (
  base: Record<string, string | string[]>,
  override?: Record<string, string | string[]>,
): Record<string, string | string[]> => {
  if (!override) return base;

  let hasOverride = false;
  for (const _ in override) {
    hasOverride = true;
    break;
  }
  if (!hasOverride) return base;

  for (const key in override) {
    if (Object.prototype.hasOwnProperty.call(override, key)) {
      base[key] = override[key]!;
    }
  }
  return base;
};
