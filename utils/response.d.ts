import type { HttpResponse, HyperTransport, HyperBody } from "@hyperttp/types";
type TransportResponse = Awaited<ReturnType<HyperTransport["execute"]>>;
declare const TEXT_CACHE: unique symbol;
declare const JSON_CACHE: unique symbol;
declare const ARRAY_BUFFER_CACHE: unique symbol;
type CacheHolder = {
    [TEXT_CACHE]?: string;
    [JSON_CACHE]?: unknown;
    [ARRAY_BUFFER_CACHE]?: ArrayBuffer | SharedArrayBuffer;
};
/**
 * @ru Высокопроизводительное глубокое клонирование тела ответа.
 * Избегает накладных расходов structuredClone для простых объектов.
 * @en High-performance deep cloning of the response body.
 * Avoids structuredClone overhead for simple objects.
 * @template T - The type of the body.
 * @param body - The body to clone.
 * @returns The cloned body.
 */
export declare const cloneBodyFast: <T>(body: T) => T;
/**
 * @ru Высокопроизводительный контейнер HTTP-ответа с ленивым парсингом и кэшированием.
 * Гарантирует идентичный API чтения тела ответа во всех рантаймах.
 * @en High-performance HTTP response container with lazy parsing and caching.
 * Guarantees identical response body reading API across all runtimes.
 * @template T - Expected type of the parsed response body.
 */
export declare class HyperHttpResponse<T = unknown> implements HttpResponse<T>, CacheHolder {
    status: number;
    headers: Record<string, string | string[]>;
    /**
     * @ru Тело ответа. Может быть распарсенным типом T, потоком HyperBody, буфером Uint8Array или null.
     * @en Response body. Can be the parsed type T, a HyperBody stream, Uint8Array buffer, or null.
     */
    body: T | HyperBody | Uint8Array | null;
    url: string;
    data: T | null;
    [TEXT_CACHE]: string | undefined;
    [JSON_CACHE]: unknown | undefined;
    [ARRAY_BUFFER_CACHE]: ArrayBuffer | SharedArrayBuffer | undefined;
    private _bodyConsumed;
    private _raw;
    /**
     * @ru Создаёт экземпляр ответа из сырых данных транспорта.
     * @en Creates a response instance from raw transport data.
     * @param rawResponse - The raw response from the transport layer.
     */
    constructor(rawResponse: TransportResponse);
    /**
     * @ru Лениво вычитывает и кэширует тело ответа в виде ArrayBuffer и текста.
     * @en Lazily consumes and caches the response body as ArrayBuffer and text.
     */
    private _consumeBody;
    /**
     * @ru Возвращает тело ответа как ArrayBuffer. Результат кэшируется.
     * @en Returns the response body as an ArrayBuffer. Result is cached.
     * @returns Promise resolving to the ArrayBuffer or SharedArrayBuffer.
     */
    arrayBuffer(): Promise<ArrayBuffer | SharedArrayBuffer>;
    /**
     * @ru Возвращает тело ответа как текст. Результат кэшируется.
     * @en Returns the response body as text. Result is cached.
     * @returns Promise resolving to the text string.
     */
    text(): Promise<string>;
    /**
     * @ru Парсит тело ответа как JSON. Результат кэшируется.
     * @en Parses the response body as JSON. Result is cached.
     * @template TJson - Expected type of the parsed JSON.
     * @returns Promise resolving to the parsed JSON object.
     */
    json<TJson = T>(): Promise<TJson>;
    /**
     * @ru Отбрасывает тело ответа для освобождения ресурсов (сокета).
     * @en Discards the response body to free up resources (socket).
     * @returns Promise that resolves when the body is drained.
     */
    dump(): Promise<void>;
    /**
     * @ru Создаёт глубокую изолированную копию ответа.
     * Для стримов использует tee() для безопасного раздвоения потока.
     * @en Creates a deep isolated copy of the response.
     * Uses tee() for streams to safely duplicate the flow.
     * @returns A new HttpResponse instance with cloned data.
     */
    clone(): HttpResponse<T>;
}
/**
 * @ru Быстрое создание экземпляра HyperHttpResponse из сырого ответа транспорта.
 * @en Fast creation of a HyperHttpResponse instance from a raw transport response.
 * @param rawResponse - The raw transport response.
 * @returns A new HyperHttpResponse instance.
 */
export declare const mapResponseFast: (rawResponse: TransportResponse) => HttpResponse<unknown>;
/**
 * @ru Быстрое создание объекта StreamResponse без overhead-а классов.
 * @en Fast creation of a StreamResponse object without class overhead.
 * @param rawResponse - The raw transport response.
 * @returns A lightweight StreamResponse object.
 */
export declare const mapStreamFast: (rawResponse: TransportResponse) => {
    status: number;
    headers: Record<string, string | string[]>;
    body: import("@hyperttp/types").TransportResponsePayload;
    url: string;
};
/**
 * @ru Оптимизированное слияние заголовков.
 * Использует ранний возврат при первой итерации цикла, что быстрее, чем Object.keys().length > 0.
 * @en Optimized headers merging.
 * Uses early return on the first loop iteration, which is faster than Object.keys().length > 0.
 * @param base - Base headers object.
 * @param override - Headers to override or add.
 * @returns Merged headers object.
 */
export declare const mergeHeadersFast: (base: Record<string, string | string[]>, override?: Record<string, string | string[]>) => Record<string, string | string[]>;
export {};
//# sourceMappingURL=response.d.ts.map