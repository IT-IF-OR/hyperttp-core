import type {
  HttpResponse,
  HyperTransport,
  StreamResponse,
} from "@hyperttp/types";

type TransportResponse = Awaited<ReturnType<HyperTransport["execute"]>>;

/**
 * @ru Высокопроизводительный глубокий клон тела ответа. Безопасно пропускает стримы и буферы без мутации рантайма.
 * @en High-performance deep clone for response payloads. Safely bypasses streams and buffers to prevent runtime state mutations.
 * @param body - Targeted data or stream context to clone.
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
 * @ru Контекстный обработчик для создания независимого изолированного клона объекта HttpResponse.
 * @en Contextual execution handler to generate an isolated deep clone of the HttpResponse instance.
 */
export function responseCloneHandler<T>(
  this: HttpResponse<T>,
): HttpResponse<T> {
  return {
    status: this.status,
    headers: { ...this.headers },
    body: cloneBodyFast(this.body),
    url: this.url,
    clone: responseCloneHandler,
    json: this.json,
    text: this.text,
    dump: this.dump,
  };
}

/**
 * @ru Быстрый маппинг сырого низкоуровневого ответа сетевого транспорта в плоский объект Hyperttp.
 * @en Fast mapping from raw low-level network transport response into flat Hyperttp object layouts.
 * @param rawResponse - Target instance returned by a transport executor.
 */
export const mapResponseFast = (rawResponse: TransportResponse) => ({
  status: rawResponse.status,
  headers: rawResponse.headers,
  body: rawResponse.body,
  url: rawResponse.url ?? "",
  clone: responseCloneHandler,
  data: null,
});

/**
 * @ru Быстрый маппинг сырого ответа транспорта в специализированный объект потокового ответа StreamResponse.
 * @en Fast mapping from raw transport context into a specialized streaming response StreamResponse layout.
 * @param rawResponse - Target instance returned by a transport executor.
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
 * @ru Zero-allocation слияние заголовков. Полностью избегает вызовов `Object.keys()` и выделения массивов в куче.
 * @en Zero-allocation headers merging layout. Completely avoids `Object.keys()` overhead and heavy heap array operations.
 * @param base - Primary dictionary containing foundational header values.
 * @param override - High-priority map containing overrides or additions.
 */
export const mergeHeadersFast = (
  base: Record<string, string | string[]>,
  override?: Record<string, string | string[]>,
): Record<string, string | string[]> => {
  if (!override) return base;

  for (const key in override) {
    if (Object.prototype.hasOwnProperty.call(override, key)) {
      return { ...base, ...override };
    }
  }
  return base;
};
