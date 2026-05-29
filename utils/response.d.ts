import type { HttpResponse, HyperTransport, StreamResponse } from "@hyperttp/types";
type TransportResponse = Awaited<ReturnType<HyperTransport["execute"]>>;
/**
 * @ru Высокопроизводительный глубокий клон тела ответа. Безопасно пропускает стримы и буферы без мутации рантайма.
 * @en High-performance deep clone for response payloads. Safely bypasses streams and buffers to prevent runtime state mutations.
 * @param body - Targeted data or stream context to clone.
 */
export declare const cloneBodyFast: <T>(body: T) => T;
/**
 * @ru Контекстный обработчик для создания независимого изолированного клона объекта HttpResponse.
 * @en Contextual execution handler to generate an isolated deep clone of the HttpResponse instance.
 */
export declare function responseCloneHandler<T>(this: HttpResponse<T>): HttpResponse<T>;
/**
 * @ru Быстрый маппинг сырого низкоуровневого ответа сетевого транспорта в плоский объект Hyperttp.
 * @en Fast mapping from raw low-level network transport response into flat Hyperttp object layouts.
 * @param rawResponse - Target instance returned by a transport executor.
 */
export declare const mapResponseFast: (rawResponse: TransportResponse) => {
    status: number;
    headers: Record<string, string | string[]>;
    body: import("@hyperttp/types").TransportResponsePayload;
    url: string;
    clone: typeof responseCloneHandler;
    json: <T = unknown>() => Promise<T>;
    text: () => Promise<string>;
    dump: () => Promise<void>;
    data: null;
};
/**
 * @ru Быстрый маппинг сырого ответа транспорта в специализированный объект потокового ответа StreamResponse.
 * @en Fast mapping from raw transport context into a specialized streaming response StreamResponse layout.
 * @param rawResponse - Target instance returned by a transport executor.
 */
export declare const mapStreamFast: (rawResponse: TransportResponse) => StreamResponse<unknown>;
/**
 * @ru Zero-allocation слияние заголовков. Полностью избегает вызовов `Object.keys()` и выделения массивов в куче.
 * @en Zero-allocation headers merging layout. Completely avoids `Object.keys()` overhead and heavy heap array operations.
 * @param base - Primary dictionary containing foundational header values.
 * @param override - High-priority map containing overrides or additions.
 */
export declare const mergeHeadersFast: (base: Record<string, string | string[]>, override?: Record<string, string | string[]>) => Record<string, string | string[]>;
export {};
//# sourceMappingURL=response.d.ts.map