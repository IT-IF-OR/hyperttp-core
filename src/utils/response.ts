import type { HttpResponse, HyperTransport, HyperBody } from "@hyperttp/types";
import { CURRENT_RUNTIME } from "../transports/manager.js";

type TransportResponse = Awaited<ReturnType<HyperTransport["execute"]>>;

/**
 * @ru Унифицирует ReadableStream во всех средах (Node.js, Bun, Deno, Browser),
 * добавляя методы парсинга (text, json, blob и т.д.) через оптимизированный Response API.
 * @en Unifies ReadableStream across all environments (Node.js, Bun, Deno, Browser)
 * by adding parsing methods (text, json, blob, etc.) via the optimized Response API.
 */
const patchReadableStream = (): void => {
  if (typeof ReadableStream === "undefined") return;
  const proto = ReadableStream.prototype as any;

  const methods = {
    dump: async function (this: ReadableStream) {
      return this.cancel().catch(() => {});
    },
    arrayBuffer: async function (this: ReadableStream) {
      return new Response(this).arrayBuffer();
    },
    text: async function (this: ReadableStream) {
      return new Response(this).text();
    },
    json: async function (this: ReadableStream) {
      return new Response(this).json();
    },
    blob: async function (this: ReadableStream) {
      return new Response(this).blob();
    },
    bytes: async function (this: ReadableStream) {
      const buf = await new Response(this).arrayBuffer();
      return new Uint8Array(buf);
    },
  } as const;

  for (const [name, fn] of Object.entries(methods)) {
    if (typeof proto[name] !== "function") {
      Object.defineProperty(proto, name, {
        value: fn,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
  }
};

patchReadableStream();

/**
 * @ru Символы для скрытого кэширования распарсенных данных тела ответа.
 * Использование Symbol предотвращает коллизии имен и сохраняет мономорфизм в V8.
 * @en Symbols for hidden caching of parsed response body data.
 * Using Symbol prevents name collisions and preserves monomorphism in V8.
 */
const TEXT_CACHE = Symbol("hyperttp.textCache");
const JSON_CACHE = Symbol("hyperttp.jsonCache");
const ARRAY_BUFFER_CACHE = Symbol("hyperttp.arrayBufferCache");

/**
 * @ru Интерфейс объекта, поддерживающего скрытое кэширование данных.
 * @en Interface for an object supporting hidden data caching.
 */
type CacheHolder = {
  [TEXT_CACHE]?: string;
  [JSON_CACHE]?: unknown;
  [ARRAY_BUFFER_CACHE]?: ArrayBuffer | SharedArrayBuffer;
};

const STATIC_DECODER = new TextDecoder();
const EMPTY_HEADERS = {};

/**
 * @ru Быстрая проверка, является ли значение ReadableStream.
 * @en Fast check to determine if a value is a ReadableStream.
 * @param value - The value to check.
 * @returns True if the value is a ReadableStream.
 */
function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    typeof value === "object" && value !== null && typeof (value as any).getReader === "function"
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
 * Избегает накладных расходов structuredClone для стримов и буферов, возвращая ссылки.
 * @en High-performance deep cloning of the response body.
 * Avoids structuredClone overhead for streams and buffers by returning references.
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
  public body: HyperBody;
  public url: string;
  public data: T | null = null;

  public [TEXT_CACHE]: string | undefined = undefined;
  public [JSON_CACHE]: unknown | undefined = undefined;
  public [ARRAY_BUFFER_CACHE]: ArrayBuffer | SharedArrayBuffer | undefined = undefined;

  private _bodyConsumed = false;

  /**
   * @ru Создаёт экземпляр ответа из сырых данных транспорта.
   * @en Creates a response instance from raw transport data.
   * @param rawResponse - The raw response from the transport layer.
   */
  constructor(rawResponse: TransportResponse) {
    this.status = rawResponse.status;
    this.headers = rawResponse.headers || EMPTY_HEADERS;
    this.body = rawResponse.body as HyperBody;
    this.url = rawResponse.url ?? "";
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

    if (CURRENT_RUNTIME === "bun" && typeof (body as any).arrayBuffer === "function") {
      const buf = await (body as any).arrayBuffer();
      this[ARRAY_BUFFER_CACHE] = buf;
      this[TEXT_CACHE] = STATIC_DECODER.decode(buf);
    } else if (isReadableStream(body) || isBlob(body)) {
      if (isReadableStream(body) && body.locked) {
        throw new Error("[Hyperttp] Stream is locked.");
      }
      const response = new Response(body as any);
      const buf = await response.arrayBuffer();
      this[ARRAY_BUFFER_CACHE] = buf;
      this[TEXT_CACHE] = STATIC_DECODER.decode(buf);
    }

    if (this[ARRAY_BUFFER_CACHE]) {
      this.body = new Uint8Array(this[ARRAY_BUFFER_CACHE] as ArrayBuffer) as any;
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
      return (this[ARRAY_BUFFER_CACHE] =
        body.buffer.byteLength === body.byteLength
          ? body.buffer
          : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
    }

    if (body instanceof ArrayBuffer) {
      return (this[ARRAY_BUFFER_CACHE] = body);
    }

    if (CURRENT_RUNTIME === "bun" && typeof (body as any).arrayBuffer === "function") {
      return (this[ARRAY_BUFFER_CACHE] = await (body as any).arrayBuffer());
    }

    if (isBlob(body)) {
      return (this[ARRAY_BUFFER_CACHE] = await body.arrayBuffer());
    }

    await this._consumeBody();
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

    if (CURRENT_RUNTIME === "bun" && typeof (body as any).text === "function") {
      this._bodyConsumed = true;
      return (this[TEXT_CACHE] = await (body as any).text());
    }

    if (isBlob(body)) {
      this._bodyConsumed = true;
      return (this[TEXT_CACHE] = await body.text());
    }

    await this._consumeBody();
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
      !((body as any) instanceof Uint8Array) &&
      !((body as any) instanceof ArrayBuffer)
    ) {
      return (this[JSON_CACHE] = body) as TJson;
    }

    if (CURRENT_RUNTIME === "bun" && typeof (body as any).json === "function") {
      return (this[JSON_CACHE] = await (body as any).json()) as TJson;
    }

    const str = await this.text();
    return (this[JSON_CACHE] = JSON.parse(str)) as TJson;
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
      await (body as any).arrayBuffer();
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

    cloned[TEXT_CACHE] = this[TEXT_CACHE];
    cloned[JSON_CACHE] = this[JSON_CACHE];
    cloned[ARRAY_BUFFER_CACHE] = this[ARRAY_BUFFER_CACHE];

    if (isReadableStream(this.body) && !this._bodyConsumed) {
      if (this.body.locked) {
        cloned.body = this.body;
      } else {
        const [b1, b2] = this.body.tee();
        this.body = b1 as any;
        cloned.body = b2 as any;
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
  for (const _key in override) {
    return { ...base, ...override };
  }
  return base;
};
