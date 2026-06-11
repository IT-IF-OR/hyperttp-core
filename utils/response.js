import { CURRENT_RUNTIME } from "../transports/manager.js";
/**
 * @ru Флаг, предотвращающий повторный патчинг ReadableStream.
 * @en Flag to prevent repeated ReadableStream patching.
 */
let streamPatched = false;
/**
 * @ru Унифицирует ReadableStream во всех средах (Node.js, Bun, Deno, Browser),
 * добавляя методы парсинга (text, json, blob и т.д.) через оптимизированный Response API.
 * @en Unifies ReadableStream across all environments (Node.js, Bun, Deno, Browser)
 * by adding parsing methods (text, json, blob, etc.) via the optimized Response API.
 */
const patchReadableStream = () => {
    if (streamPatched || typeof ReadableStream === "undefined")
        return;
    streamPatched = true;
    const proto = ReadableStream.prototype;
    const methods = {
        dump: async function () {
            return this.cancel().catch(() => { });
        },
        arrayBuffer: async function () {
            return new Response(this).arrayBuffer();
        },
        text: async function () {
            return new Response(this).text();
        },
        json: async function () {
            return new Response(this).json();
        },
        blob: async function () {
            return new Response(this).blob();
        },
        bytes: async function () {
            const buf = await new Response(this).arrayBuffer();
            return new Uint8Array(buf);
        },
    };
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
const TEXT_CACHE = Symbol("hyperttp.textCache");
const JSON_CACHE = Symbol("hyperttp.jsonCache");
const ARRAY_BUFFER_CACHE = Symbol("hyperttp.arrayBufferCache");
const STATIC_DECODER = new TextDecoder();
/**
 * @ru Замороженный пустой объект заголовков для избежания лишних аллокаций.
 * @en Frozen empty headers object to avoid redundant allocations.
 */
const EMPTY_HEADERS = Object.freeze({});
/**
 * @ru Быстрая проверка, является ли значение ReadableStream.
 * @en Fast check to determine if a value is a ReadableStream.
 * @param value - The value to check.
 * @returns True if the value is a ReadableStream.
 */
function isReadableStream(value) {
    return (typeof value === "object" &&
        value !== null &&
        "getReader" in value &&
        typeof value.getReader === "function");
}
/**
 * @ru Быстрая проверка, является ли значение Blob.
 * @en Fast check to determine if a value is a Blob.
 * @param value - The value to check.
 * @returns True if the value is a Blob.
 */
function isBlob(value) {
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
export const cloneBodyFast = (body) => {
    if (typeof body !== "object" || body === null)
        return body;
    const obj = body;
    if (body instanceof Uint8Array ||
        typeof obj.pipe === "function" ||
        typeof obj.getReader === "function") {
        return body;
    }
    const proto = Object.getPrototypeOf(body);
    if (proto === Object.prototype || proto === null) {
        return { ...body };
    }
    try {
        return structuredClone(body);
    }
    catch {
        try {
            return JSON.parse(JSON.stringify(body));
        }
        catch {
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
export class HyperHttpResponse {
    status;
    headers;
    /**
     * @ru Тело ответа. Может быть распарсенным типом T, потоком HyperBody, буфером Uint8Array или null.
     * @en Response body. Can be the parsed type T, a HyperBody stream, Uint8Array buffer, or null.
     */
    body;
    url;
    data = null;
    [TEXT_CACHE] = undefined;
    [JSON_CACHE] = undefined;
    [ARRAY_BUFFER_CACHE] = undefined;
    _bodyConsumed = false;
    _raw;
    /**
     * @ru Создаёт экземпляр ответа из сырых данных транспорта.
     * @en Creates a response instance from raw transport data.
     * @param rawResponse - The raw response from the transport layer.
     */
    constructor(rawResponse) {
        this.status = rawResponse.status;
        this.headers = rawResponse.headers || EMPTY_HEADERS;
        this.body = rawResponse.body;
        this.url = rawResponse.url ?? "";
        this._raw = rawResponse._raw;
    }
    /**
     * @ru Лениво вычитывает и кэширует тело ответа в виде ArrayBuffer и текста.
     * @en Lazily consumes and caches the response body as ArrayBuffer and text.
     */
    async _consumeBody() {
        if (this._bodyConsumed)
            return;
        this._bodyConsumed = true;
        const body = this.body;
        if (!body)
            return;
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
        if (isReadableStream(body) || isBlob(body)) {
            if (isReadableStream(body) && body.locked) {
                throw new Error("[Hyperttp] Stream is locked.");
            }
            const response = new Response(body);
            const buf = await response.arrayBuffer();
            this[ARRAY_BUFFER_CACHE] = buf;
            this[TEXT_CACHE] = STATIC_DECODER.decode(buf);
        }
        if (this[ARRAY_BUFFER_CACHE]) {
            this.body = new Uint8Array(this[ARRAY_BUFFER_CACHE]);
        }
    }
    /**
     * @ru Возвращает тело ответа как ArrayBuffer. Результат кэшируется.
     * @en Returns the response body as an ArrayBuffer. Result is cached.
     * @returns Promise resolving to the ArrayBuffer or SharedArrayBuffer.
     */
    async arrayBuffer() {
        if (this[ARRAY_BUFFER_CACHE] !== undefined)
            return this[ARRAY_BUFFER_CACHE];
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
        if (this._raw && body === this._raw.body && typeof this._raw.arrayBuffer === "function") {
            this._bodyConsumed = true;
            return (this[ARRAY_BUFFER_CACHE] = await this._raw.arrayBuffer());
        }
        if (CURRENT_RUNTIME === "bun" && body && typeof body === "object" && "arrayBuffer" in body) {
            const bunBody = body;
            if (typeof bunBody.arrayBuffer === "function") {
                this._bodyConsumed = true;
                return (this[ARRAY_BUFFER_CACHE] = await bunBody.arrayBuffer());
            }
        }
        if (isBlob(body)) {
            return (this[ARRAY_BUFFER_CACHE] = await body.arrayBuffer());
        }
        await this._consumeBody();
        return this[ARRAY_BUFFER_CACHE];
    }
    /**
     * @ru Возвращает тело ответа как текст. Результат кэшируется.
     * @en Returns the response body as text. Result is cached.
     * @returns Promise resolving to the text string.
     */
    async text() {
        if (this[TEXT_CACHE] !== undefined)
            return this[TEXT_CACHE];
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
        if (this._raw && body === this._raw.body && typeof this._raw.text === "function") {
            this._bodyConsumed = true;
            return (this[TEXT_CACHE] = await this._raw.text());
        }
        if (CURRENT_RUNTIME === "bun" && body && typeof body === "object" && "text" in body) {
            const bunBody = body;
            if (typeof bunBody.text === "function") {
                this._bodyConsumed = true;
                return (this[TEXT_CACHE] = await bunBody.text());
            }
        }
        if (isBlob(body)) {
            this._bodyConsumed = true;
            return (this[TEXT_CACHE] = await body.text());
        }
        await this._consumeBody();
        return this[TEXT_CACHE];
    }
    /**
     * @ru Парсит тело ответа как JSON. Результат кэшируется.
     * @en Parses the response body as JSON. Result is cached.
     * @template TJson - Expected type of the parsed JSON.
     * @returns Promise resolving to the parsed JSON object.
     */
    async json() {
        if (this[JSON_CACHE] !== undefined)
            return this[JSON_CACHE];
        if (this[TEXT_CACHE] !== undefined) {
            return (this[JSON_CACHE] = JSON.parse(this[TEXT_CACHE]));
        }
        const body = this.body;
        if (typeof body === "object" &&
            body !== null &&
            !isReadableStream(body) &&
            !isBlob(body) &&
            !(body instanceof Uint8Array) &&
            !(body instanceof ArrayBuffer)) {
            return (this[JSON_CACHE] = body);
        }
        if (this._raw && body === this._raw.body && typeof this._raw.json === "function") {
            this._bodyConsumed = true;
            return (this[JSON_CACHE] = await this._raw.json());
        }
        if (CURRENT_RUNTIME === "bun" && body && typeof body === "object" && "json" in body) {
            const bunBody = body;
            if (typeof bunBody.json === "function") {
                this._bodyConsumed = true;
                return (this[JSON_CACHE] = await bunBody.json());
            }
        }
        const str = await this.text();
        return (this[JSON_CACHE] = JSON.parse(str));
    }
    /**
     * @ru Отбрасывает тело ответа для освобождения ресурсов (сокета).
     * @en Discards the response body to free up resources (socket).
     * @returns Promise that resolves when the body is drained.
     */
    async dump() {
        if (this._bodyConsumed)
            return;
        this._bodyConsumed = true;
        const body = this.body;
        if (isReadableStream(body)) {
            if (!body.locked)
                await body.cancel().catch(() => { });
        }
        else if (isBlob(body)) {
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
    clone() {
        const cloned = Object.create(HyperHttpResponse.prototype);
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
            }
            else {
                const [b1, b2] = this.body.tee();
                this.body = b1;
                cloned.body = b2;
            }
        }
        else {
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
export const mapResponseFast = (rawResponse) => {
    return new HyperHttpResponse(rawResponse);
};
/**
 * @ru Быстрое создание объекта StreamResponse без overhead-а классов.
 * @en Fast creation of a StreamResponse object without class overhead.
 * @param rawResponse - The raw transport response.
 * @returns A lightweight StreamResponse object.
 */
export const mapStreamFast = (rawResponse) => ({
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
export const mergeHeadersFast = (base, override) => {
    if (!override)
        return base;
    for (const _ in override) {
        return { ...base, ...override };
    }
    return base;
};
//# sourceMappingURL=response.js.map