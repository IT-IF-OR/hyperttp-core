import type { TransportStreamExtensions } from "@hyperttp/types";
type StreamPayload = ReadableStream<Uint8Array> & TransportStreamExtensions;
type BufferPayload = Uint8Array & TransportStreamExtensions;
/**
 * @ru Декомпрессирует буфер с поддержкой множественных кодировок.
 * Сначала пытается Web API, затем fallback на node:zlib для серверных сред.
 * @en Decompresses a buffer with support for multiple encodings.
 * Tries Web API first, then falls back to node:zlib for server environments.
 */
export declare function decompressBuffer(body: Uint8Array, encoding: string): Promise<BufferPayload>;
/**
 * @ru Создаёт декомпрессированный стрим с поддержкой множественных кодировок.
 * Использует DecompressionStream для Web и node:zlib для Node.js.
 * @en Creates a decompressed stream with support for multiple encodings.
 * Uses DecompressionStream for Web and node:zlib for Node.js.
 */
export declare function createDecompressStream(body: ReadableStream<Uint8Array>, encoding: string): Promise<StreamPayload>;
export {};
//# sourceMappingURL=decompress.d.ts.map