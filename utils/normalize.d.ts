import type { Method, RequestBodyData } from "@hyperttp/types";
type NormalizedHeaders = Record<string, string | string[]>;
/**
 * @ru Нормализует HTTP-метод в верхний регистр с кэшированием.
 * @en Normalizes HTTP method to uppercase with caching.
 * @param method - The HTTP method string (e.g., 'get', 'POST').
 * @returns The normalized HTTP method in uppercase.
 */
export declare function normalizeMethod(method: string): Method;
/**
 * @ru Извлекает URL из объекта запроса или строки.
 * Поддерживает различные форматы: строка, объект с полем `url`, `_url`, или `scheme/host/path`.
 * @en Extracts URL from a request object or string.
 * Supports various formats: string, object with `url`, `_url`, or `scheme/host/path` fields.
 * @param req - The request object or URL string.
 * @returns The extracted URL string.
 * @throws Error if URL is missing in the request.
 */
export declare function normalizeUrl(req: unknown): string;
/**
 * @ru Нормализует заголовки запроса в единый формат с ключами в нижнем регистре.
 * Поддерживает различные входные форматы: объект, массив пар, плоский массив.
 *
 * Специальные правила:
 * - `set-cookie` всегда хранится как массив
 * - `cookie`/`cookie2` объединяются через `; `
 * - Остальные множественные заголовки объединяются через `, `
 * - Заголовки из SINGLE_VALUE_HEADERS перезаписываются (не объединяются)
 *
 * @en Normalizes request headers into a unified format with lowercase keys.
 * Supports various input formats: object, array of pairs, flat array.
 *
 * Special rules:
 * - `set-cookie` is always stored as an array
 * - `cookie`/`cookie2` are joined with `; `
 * - Other multiple headers are joined with `, `
 * - Headers from SINGLE_VALUE_HEADERS are overwritten (not merged)
 *
 * @param headers - The headers to normalize (object, array of pairs, or flat array).
 * @returns Normalized headers object with lowercase keys.
 */
export declare function normalizeHeaders(headers: unknown): NormalizedHeaders;
/**
 * @ru Нормализует тело запроса, удаляя его для методов GET и HEAD.
 * @en Normalizes request body by removing it for GET and HEAD methods.
 * @param method - The HTTP method.
 * @param body - The request body data.
 * @returns The body for methods that support it, or undefined for GET/HEAD.
 */
export declare function normalizeBody(method: Method, body: RequestBodyData | undefined): RequestBodyData | undefined;
export {};
//# sourceMappingURL=normalize.d.ts.map