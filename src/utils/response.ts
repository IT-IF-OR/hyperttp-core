import type { HttpResponse, HyperTransport, HyperBody } from "@hyperttp/types";
import { CURRENT_RUNTIME } from "../transports/manager.js";

type TransportResponse = Awaited<ReturnType<HyperTransport["execute"]>>;

/**
 * @ru Интерфейс расширенного ответа транспорта, содержащий скрытую ссылку на нативный сетевой инстанс.
 * @en Interface for extended transport response containing a hidden reference to the native network instance.
 */
interface InternalTransportResponse extends TransportResponse {
  _raw?: FetchResponseLike;
}

/**
 * @ru Интерфейс утиной типизации для нативного ответа Fetch API или Bun-совместимого тела.
 * @en Duck-typing interface for native Fetch API response or Bun-compatible body.
 */
interface FetchResponseLike {
  body: unknown;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json(): Promise<unknown>;
}



const TEXT_CACHE = Symbol("hyperttp.textCache");
const JSON_CACHE = Symbol("hyperttp.jsonCache");
const ARRAY_BUFFER_CACHE = Symbol("hyperttp.arrayBufferCache");

type CacheHolder = {
  [TEXT_CACHE]?: string;
  [JSON_CACHE]?: unknown;
  [ARRAY_BUFFER_CACHE]?: ArrayBuffer | SharedArrayBuffer;
};

const STATIC_DECODER = new TextDecoder();

/**
 * @ru Замороженный пустой объект заголовков для избежания лишних аллокаций.
 * @en Frozen empty headers object to avoid redundant allocations.
 */
const EMPTY_HEADERS: Readonly<Record<string, never>> = Object.freeze({});

/**
 * @ru Быстрая проверка, является ли значение ReadableStream.
 * @en Fast check to determine if a value is a ReadableStream.
 * @param value - The value to check.
 * @returns True if the value is a ReadableStream.
 */
function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    typeof value === "object" &&
    value !== null &&
    "getReader" in value &&
    typeof (value as Record<string, unknown>).getReader === "function"
  );
}

/**
 * @ru Быстрая проверка, является ли значение Blob.
 * @en Fast check to determine if a value is a Blob.
 * @param value - The value to check.
 * @returns True if the value is a Blob.
 */
function isBlob(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

/**
 * @ru Высокопроизводительное глубокое клонирование тела ответа.
 * Избегает накладных расходов structuredClone для простых объектов.
 * @en High-performance deep cloning of the response body.
 * Avoids structuredClone overhead for simple objects.
 * @template T - The type of the body.
 * @param body - The body to clone.
 * @returns The cloned body.
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
    return { ...body } as T;
  }

  try {
    return structuredClone(body);
  } catch {
    try {
      return JSON.parse(JSON.stringify(body)) as T;
    } catch {
      return { ...body };
    }
  }
};

/**
 * @ru Высокопроизводительный контейнер HTTP-ответа с ленивым парсингом и кэшированием.
 * Гарантирует идентичный API чтения тела ответа во всех рантаймах.
 * @en High-performance HTTP response container with lazy parsing and caching.
 * Guarantees identical response body reading API across all runtimes.
 * @template T - Expected type of the parsed response body.
 */
export class HyperHttpResponse<T = unknown> implements HttpResponse<T>, CacheHolder {
  public status: number;
  public headers: Record<string, string | string[]>;

  /**
   * @ru Тело ответа. Может быть распарсенным типом T, потоком HyperBody, буфером Uint8Array или null.
   * @en Response body. Can be the parsed type T, a HyperBody stream, Uint8Array buffer, or null.
   */
  public body: T | HyperBody | Uint8Array | null;

  public url: string;
  public data: T | null = null;

  public [TEXT_CACHE]: string | undefined = undefined;
  public [JSON_CACHE]: unknown | undefined = undefined;
  public [ARRAY_BUFFER_CACHE]: ArrayBuffer | SharedArrayBuffer | undefined = undefined;

  private _bodyConsumed = false;
  private _raw: FetchResponseLike | undefined;

  /**
   * @ru Создаёт экземпляр ответа из сырых данных транспорта.
   * @en Creates a response instance from raw transport data.
   * @param rawResponse - The raw response from the transport layer.
   */
  constructor(rawResponse: TransportResponse) {
    this.status = rawResponse.status;
    this.headers = rawResponse.headers || EMPTY_HEADERS;
    this.body = rawResponse.body as T | HyperBody | Uint8Array | null;
    this.url = rawResponse.url ?? "";
    this._raw = (rawResponse as InternalTransportResponse)._raw;
  }

  /**
   * @ru Лениво вычитывает и кэширует тело ответа в виде ArrayBuffer и текста.
   * @en Lazily consumes and caches the response body as ArrayBuffer and text.
   */
  private async _consumeBody(): Promise<void> {
    if (this._bodyConsumed) return;
    this._bodyConsumed = true;

    const body = this.body;
    if (!body) return;

    if (typeof body === "string") {
      this[TEXT_CACHE] = body;
      return;
    }

    if (body instanceof Uint8Array) {
      this[ARRAY_BUFFER_CACHE] =
        body.buffer.byteLength === body.byteLength
          ? body.buffer
          : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      this[TEXT_CACHE] = STATIC_DECODER.decode(body);
      return;
    }

    if (body instanceof ArrayBuffer) {
      this[ARRAY_BUFFER_CACHE] = body;
      this[TEXT_CACHE] = STATIC_DECODER.decode(body);
      return;
    }

    if (this._raw && body === this._raw.body && typeof this._raw.arrayBuffer === "function") {
      const buf = await this._raw.arrayBuffer();
      this[ARRAY_BUFFER_CACHE] = buf;
      this[TEXT_CACHE] = STATIC_DECODER.decode(buf);
      this.body = new Uint8Array(buf) as T | HyperBody | Uint8Array | null;
      return;
    }

    if (CURRENT_RUNTIME === "bun" && body && typeof body === "object" && "arrayBuffer" in body) {
      const bunBody = body as { arrayBuffer: () => Promise<ArrayBuffer> };
      if (typeof bunBody.arrayBuffer === "function") {
        const buf = await bunBody.arrayBuffer();
        this[ARRAY_BUFFER_CACHE] = buf;
        this[TEXT_CACHE] = STATIC_DECODER.decode(buf);
        this.body = new Uint8Array(buf) as T | HyperBody | Uint8Array | null;
        return;
      }
    }

    if (isReadableStream(body) || isBlob(body)) {
      if (isReadableStream(body) && body.locked) {
        throw new Error("[Hyperttp] Stream is locked.");
      }
      const response = new Response(body as unknown as BodyInit);
      const buf = await response.arrayBuffer();
      this[ARRAY_BUFFER_CACHE] = buf;
      this[TEXT_CACHE] = STATIC_DECODER.decode(buf);
      this.body = new Uint8Array(buf) as T | HyperBody | Uint8Array | null;
    }
  }

  /**
   * @ru Возвращает тело ответа как ArrayBuffer. Результат кэшируется.
   * @en Returns the response body as an ArrayBuffer. Result is cached.
   * @returns Promise resolving to the ArrayBuffer or SharedArrayBuffer.
   */
  public async arrayBuffer(): Promise<ArrayBuffer | SharedArrayBuffer> {
    if (this[ARRAY_BUFFER_CACHE] !== undefined) return this[ARRAY_BUFFER_CACHE]!;

    const body = this.body;
    if (body instanceof Uint8Array) {
      this._bodyConsumed = true;
      return (this[ARRAY_BUFFER_CACHE] =
        body.buffer.byteLength === body.byteLength
          ? body.buffer
          : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
    }

    if (body instanceof ArrayBuffer) {
      this._bodyConsumed = true;
      return (this[ARRAY_BUFFER_CACHE] = body);
    }

    if (isBlob(body)) {
      this._bodyConsumed = true;
      return (this[ARRAY_BUFFER_CACHE] = await body.arrayBuffer());
    }

    await this._consumeBody();
    if (this[ARRAY_BUFFER_CACHE] === undefined) {
      throw new Error("[Hyperttp] Response body is not available as ArrayBuffer");
    }
    return this[ARRAY_BUFFER_CACHE]!;
  }

  /**
   * @ru Возвращает тело ответа как текст. Результат кэшируется.
   * @en Returns the response body as text. Result is cached.
   * @returns Promise resolving to the text string.
   */
  public async text(): Promise<string> {
    if (this[TEXT_CACHE] !== undefined) return this[TEXT_CACHE]!;

    const body = this.body;
    if (typeof body === "string") {
      this._bodyConsumed = true;
      return (this[TEXT_CACHE] = body);
    }

    if (body instanceof Uint8Array) {
      this._bodyConsumed = true;
      return (this[TEXT_CACHE] = STATIC_DECODER.decode(body));
    }

    if (body instanceof ArrayBuffer) {
      this._bodyConsumed = true;
      return (this[TEXT_CACHE] = STATIC_DECODER.decode(body));
    }

    if (isBlob(body)) {
      this._bodyConsumed = true;
      return (this[TEXT_CACHE] = await body.text());
    }

    await this._consumeBody();
    if (this[TEXT_CACHE] === undefined) {
      throw new Error("[Hyperttp] Response body is not available as text");
    }
    return this[TEXT_CACHE]!;
  }

  /**
   * @ru Парсит тело ответа как JSON. Результат кэшируется.
   * @en Parses the response body as JSON. Result is cached.
   * @template TJson - Expected type of the parsed JSON.
   * @returns Promise resolving to the parsed JSON object.
   */
  public async json<TJson = T>(): Promise<TJson> {
    if (this[JSON_CACHE] !== undefined) return this[JSON_CACHE] as TJson;

    if (this[TEXT_CACHE] !== undefined) {
      return (this[JSON_CACHE] = JSON.parse(this[TEXT_CACHE]!)) as TJson;
    }

    const body = this.body;
    if (
      typeof body === "object" &&
      body !== null &&
      !isReadableStream(body) &&
      !isBlob(body) &&
      !(body instanceof Uint8Array) &&
      !(body instanceof ArrayBuffer)
    ) {
      this._bodyConsumed = true;
      return (this[JSON_CACHE] = body) as TJson;
    }

    await this._consumeBody();
    if (this[TEXT_CACHE] !== undefined) {
      return (this[JSON_CACHE] = JSON.parse(this[TEXT_CACHE]!)) as TJson;
    }
    throw new Error("[Hyperttp] Response body is not available as JSON");
  }

  /**
   * @ru Отбрасывает тело ответа для освобождения ресурсов (сокета).
   * @en Discards the response body to free up resources (socket).
   * @returns Promise that resolves when the body is drained.
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
   * @ru Создаёт глубокую изолированную копию ответа.
   * Для стримов использует tee() для безопасного раздвоения потока.
   * @en Creates a deep isolated copy of the response.
   * Uses tee() for streams to safely duplicate the flow.
   * @returns A new HttpResponse instance with cloned data.
   */
  public clone(): HttpResponse<T> {
    const cloned = Object.create(HyperHttpResponse.prototype) as HyperHttpResponse<T>;

    cloned.status = this.status;
    cloned.headers = this.headers;
    cloned.url = this.url;
    cloned.data = this.data ? cloneBodyFast(this.data) : null;
    cloned._bodyConsumed = this._bodyConsumed;
    cloned._raw = this._bodyConsumed ? undefined : this._raw;

    cloned[TEXT_CACHE] = this[TEXT_CACHE];
    cloned[JSON_CACHE] = this[JSON_CACHE];
    cloned[ARRAY_BUFFER_CACHE] = this[ARRAY_BUFFER_CACHE];

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

/**
 * @ru Быстрое создание экземпляра HyperHttpResponse из сырого ответа транспорта.
 * @en Fast creation of a HyperHttpResponse instance from a raw transport response.
 * @param rawResponse - The raw transport response.
 * @returns A new HyperHttpResponse instance.
 */
export const mapResponseFast = (rawResponse: TransportResponse): HttpResponse<unknown> => {
  return new HyperHttpResponse(rawResponse);
};

/**
 * @ru Быстрое создание объекта StreamResponse без overhead-а классов.
 * @en Fast creation of a StreamResponse object without class overhead.
 * @param rawResponse - The raw transport response.
 * @returns A lightweight StreamResponse object.
 */
export const mapStreamFast = (rawResponse: TransportResponse) => ({
  status: rawResponse.status,
  headers: rawResponse.headers,
  body: rawResponse.body,
  url: rawResponse.url ?? "",
});

/**
 * @ru Оптимизированное слияние заголовков.
 * Использует ранний возврат при первой итерации цикла, что быстрее, чем Object.keys().length > 0.
 * @en Optimized headers merging.
 * Uses early return on the first loop iteration, which is faster than Object.keys().length > 0.
 * @param base - Base headers object.
 * @param override - Headers to override or add.
 * @returns Merged headers object.
 */
export const mergeHeadersFast = (
  base: Record<string, string | string[]>,
  override?: Record<string, string | string[]>,
): Record<string, string | string[]> => {
  if (!override) return base;
  for (const _ in override) {
    return { ...base, ...override };
  }
  return base;
};
