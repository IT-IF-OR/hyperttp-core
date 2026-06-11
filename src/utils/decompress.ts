import type { TransportStreamExtensions } from "@hyperttp/types";
import { runtimeImport } from "../transports/manager.js";

type StreamPayload = ReadableStream<Uint8Array> & TransportStreamExtensions;
type BufferPayload = Uint8Array & TransportStreamExtensions;

/**
 * @ru Флаг серверного окружения (Node.js/Bun/Deno).
 * @en Server environment flag (Node.js/Bun/Deno).
 */
const IS_SERVER = typeof window === "undefined" && typeof self === "undefined";

/**
 * @ru No-op функция для dump() буферов. Буферы не требуют освобождения ресурсов.
 * @en No-op function for buffer dump(). Buffers don't require resource cleanup.
 */
const NOOP_DUMP = async (): Promise<void> => {};

/**
 * @ru Парсит строку Content-Encoding в массив кодировок.
 * Игнорирует 'identity' (без сжатия) и пустые значения.
 * @en Parses Content-Encoding string into an array of encodings.
 * Ignores 'identity' (no compression) and empty values.
 * @param encoding - The Content-Encoding header value.
 * @returns Array of normalized encoding names.
 */
function parseEncodings(encoding: string): string[] {
  return encoding
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0 && part !== "identity");
}

/**
 * @ru Добавляет no-op метод dump() к буферу.
 * @en Attaches a no-op dump() method to the buffer.
 * @param buffer - The Uint8Array to extend.
 * @returns The buffer with dump() method attached.
 */
function attachNoopDump(buffer: Uint8Array): BufferPayload {
  const payload = buffer as BufferPayload;
  payload.dump = NOOP_DUMP;
  return payload;
}

/**
 * @ru Добавляет метод dump() к стриму для отмены и освобождения сокета.
 * @en Attaches a dump() method to the stream for cancellation and socket release.
 * @param stream - The ReadableStream to extend.
 * @returns The stream with dump() method attached.
 */
function attachStreamDump(stream: ReadableStream<Uint8Array>): StreamPayload {
  const payload = stream as StreamPayload;
  payload.dump = async (): Promise<void> => {
    try {
      await payload.cancel();
    } catch {
      //
    }
  };
  return payload;
}

/**
 * @ru Декомпрессирует буфер с использованием Web API (DecompressionStream).
 * Поддерживает gzip и deflate. Возвращает исходный буфер, если декомпрессия невозможна.
 * @en Decompresses a buffer using Web API (DecompressionStream).
 * Supports gzip and deflate. Returns the original buffer if decompression is not possible.
 * @param input - The compressed Uint8Array.
 * @param encoding - The compression encoding ('gzip', 'deflate').
 * @returns The decompressed Uint8Array, or the original input if not applicable.
 */
async function decompressOnceWeb(input: Uint8Array, encoding: string): Promise<Uint8Array> {
  const enc = encoding.trim().toLowerCase();
  if (typeof globalThis.DecompressionStream === "undefined") return input;

  const isGzip = enc === "gzip" || enc === "x-gzip";
  const isDeflate = enc === "deflate";
  if (!isGzip && !isDeflate) return input;

  const format = isGzip ? "gzip" : "deflate";

  const inputStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(input);
      controller.close();
    },
  });

  const decompressedStream = inputStream.pipeThrough(
    new globalThis.DecompressionStream(format) as TransformStream<Uint8Array, Uint8Array>,
  );

  const reader = decompressedStream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalLength += value.byteLength;
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0]!;

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * @ru Декомпрессирует буфер с использованием node:zlib.
 * Поддерживает gzip, deflate и brotli.
 * @en Decompresses a buffer using node:zlib.
 * Supports gzip, deflate, and brotli.
 * @param input - The compressed Uint8Array.
 * @param encoding - The compression encoding.
 * @returns The decompressed Uint8Array.
 */
async function decompressOnceNode(input: Uint8Array, encoding: string): Promise<Uint8Array> {
  const enc = encoding.trim().toLowerCase();
  const zlib = await runtimeImport<any>("node:zlib");
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);

  switch (enc) {
    case "gzip":
    case "x-gzip":
      return new Uint8Array(zlib.gunzipSync(buffer));
    case "deflate":
      return new Uint8Array(zlib.inflateSync(buffer));
    case "br":
      return new Uint8Array(zlib.brotliDecompressSync(buffer));
    default:
      return input;
  }
}

/**
 * @ru Декомпрессирует буфер с поддержкой множественных кодировок.
 * Сначала пытается Web API, затем fallback на node:zlib для серверных сред.
 * @en Decompresses a buffer with support for multiple encodings.
 * Tries Web API first, then falls back to node:zlib for server environments.
 * @param body - The compressed Uint8Array.
 * @param encoding - The Content-Encoding header value (e.g., 'gzip, br').
 * @returns The decompressed buffer with dump() method attached.
 */
export async function decompressBuffer(body: Uint8Array, encoding: string): Promise<BufferPayload> {
  let current: Uint8Array = body;
  const encodings = parseEncodings(encoding);

  for (let i = 0; i < encodings.length; i++) {
    const enc = encodings[i]!;

    const webResult = await decompressOnceWeb(current, enc);
    if (webResult !== current) {
      current = webResult;
      continue;
    }

    if (IS_SERVER && (enc === "br" || enc === "gzip" || enc === "deflate" || enc === "x-gzip")) {
      try {
        current = await decompressOnceNode(current, enc);
      } catch {
        continue;
      }
    }
  }
  return attachNoopDump(current);
}

/**
 * @ru Создаёт декомпрессированный стрим с поддержкой множественных кодировок.
 * Использует DecompressionStream для Web и node:zlib для Node.js.
 * @en Creates a decompressed stream with support for multiple encodings.
 * Uses DecompressionStream for Web and node:zlib for Node.js.
 * @param body - The compressed ReadableStream.
 * @param encoding - The Content-Encoding header value (e.g., 'gzip, br').
 * @returns The decompressed stream with dump() method attached.
 */
export async function createDecompressStream(
  body: ReadableStream<Uint8Array>,
  encoding: string,
): Promise<StreamPayload> {
  const encodings = parseEncodings(encoding);
  if (encodings.length === 0) return attachStreamDump(body);

  let current: ReadableStream<Uint8Array> = body;

  for (let i = 0; i < encodings.length; i++) {
    const enc = encodings[i]!;
    const isGzip = enc === "gzip" || enc === "x-gzip";
    const isDeflate = enc === "deflate";
    const isBrotli = enc === "br";

    if ((isGzip || isDeflate) && typeof globalThis.DecompressionStream !== "undefined") {
      const format = isGzip ? "gzip" : "deflate";
      current = current.pipeThrough(
        new globalThis.DecompressionStream(format) as TransformStream<Uint8Array, Uint8Array>,
      );
    } else if (IS_SERVER) {
      try {
        const { Readable } = await runtimeImport<any>("node:stream");
        const zlib = await runtimeImport<any>("node:zlib");

        const nodeReadableStream = Readable.fromWeb(current as any);
        let transformer: any = nodeReadableStream;

        if (isGzip) transformer = nodeReadableStream.pipe(zlib.createGunzip());
        else if (isDeflate) transformer = nodeReadableStream.pipe(zlib.createInflate());
        else if (isBrotli) transformer = nodeReadableStream.pipe(zlib.createBrotliDecompress());

        current = Readable.toWeb(transformer) as unknown as ReadableStream<Uint8Array>;
      } catch {
        continue;
      }
    }
  }
  return attachStreamDump(current);
}
