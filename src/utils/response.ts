import type {
  HttpResponse,
  HyperTransport,
  StreamResponse,
} from "@hyperttp/types";

type TransportResponse = Awaited<ReturnType<HyperTransport["execute"]>>;

/**
 * @ru Высокопроизводительный глубокий клон тела ответа. Safe-bypass для стримов и буферов.
 * @en High-performance deep clone of response body. Safe-bypass for streams and buffers.
 * @param body - The response body (any type).
 * @returns Cloned body (or original for streams/buffers).
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
 * @ru Класс-контейнер ответа с фиксированной структурой полей для V8 / JSC. Все методы вынесены в прототип, исключая аллокации замыканий в куче.
 * @en Response container class with fixed field structure for V8 / JSC. All methods are on the prototype, avoiding closure allocations in the heap.
 */
export class HyperHttpResponse<T = unknown> implements HttpResponse<T> {
  public status: number;
  public headers: Record<string, string | string[]>;
  public body: any;
  public url: string;
  public data: T | null;

  public json!: () => Promise<any>;
  public text!: () => Promise<string>;
  public dump!: () => Promise<void>;

  /**
   * @ru Создаёт экземпляр HyperHttpResponse из сырого транспортного ответа.
   * @en Creates a HyperHttpResponse instance from a raw transport response.
   * @param rawResponse - Raw response from transport layer.
   */
  constructor(rawResponse: TransportResponse) {
    this.status = rawResponse.status;
    this.headers = rawResponse.headers;
    this.body = rawResponse.body;
    this.url = rawResponse.url ?? "";
    this.data = null;

    this.json = (rawResponse as any).json;
    this.text = (rawResponse as any).text;
    this.dump = (rawResponse as any).dump;
  }

  /**
   * @ru Создаёт глубокую копию текущего ответа (безопасно для стримов и буферов).
   * @en Creates a deep copy of the current response (safe for streams and buffers).
   * @returns A new HttpResponse instance with cloned data.
   */
  public clone(): HttpResponse<T> {
    const cloned = new HyperHttpResponse<T>({
      status: this.status,
      headers: { ...this.headers },
      body: cloneBodyFast(this.body),
      url: this.url,
    } as TransportResponse);

    cloned.json = this.json;
    cloned.text = this.text;
    cloned.dump = this.dump;
    cloned.data = this.data;

    return cloned;
  }
}

/**
 * @ru Быстрый маппинг сырого ответа через выделение мономорфного класса.
 * @en Fast mapping of a raw response using a monomorphic class.
 * @param rawResponse - Raw transport response.
 * @returns Normalized HttpResponse.
 */
export const mapResponseFast = (
  rawResponse: TransportResponse,
): HttpResponse<unknown> => {
  return new HyperHttpResponse(rawResponse);
};

/**
 * @ru Быстрый маппинг сырого ответа в специализированный объект StreamResponse.
 * @en Fast mapping of a raw response to a specialised StreamResponse object.
 * @param rawResponse - Raw transport response.
 * @returns Normalized StreamResponse.
 */
export const mapStreamFast = (
  rawResponse: TransportResponse,
): StreamResponse<unknown> => ({
  status: rawResponse.status,
  headers: rawResponse.headers,
  body: rawResponse.body,
  url: rawResponse.url ?? "",
});

/**
 * @ru Zero-allocation слияние заголовков с оптимизированным циклом копирования свойств.
 * @en Zero-allocation header merging with optimised property copying loop.
 * @param base - Base headers object (will be shallow-copied if overrides exist).
 * @param override - Optional headers to override or add.
 * @returns Merged headers object (new object if overrides provided, otherwise base).
 */
export const mergeHeadersFast = (
  base: Record<string, string | string[]>,
  override?: Record<string, string | string[]>,
): Record<string, string | string[]> => {
  if (!override) return base;

  let hasKeys = false;
  for (const key in override) {
    if (Object.prototype.hasOwnProperty.call(override, key)) {
      hasKeys = true;
      break;
    }
  }

  if (!hasKeys) return base;

  const out = { ...base };
  for (const key in override) {
    if (Object.prototype.hasOwnProperty.call(override, key)) {
      out[key] = override[key]!;
    }
  }
  return out;
};
