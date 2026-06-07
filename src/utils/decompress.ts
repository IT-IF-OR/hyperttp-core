import {
  brotliDecompressSync,
  createBrotliDecompress,
  createGunzip,
  createInflate,
  gunzipSync,
  inflateSync,
} from "node:zlib";
import { Readable } from "node:stream";
import type { TransportStreamExtensions } from "@hyperttp/types";

type StreamPayload = ReadableStream<Uint8Array> & TransportStreamExtensions;
type BufferPayload = Uint8Array & TransportStreamExtensions;

/**
 * @ru Разбирает заголовок Content-Encoding в массив алгоритмов, исключая "identity".
 * @en Parses Content-Encoding header into an array of algorithms, excluding "identity".
 * @param encoding - Raw Content-Encoding header value (e.g., "gzip, deflate").
 * @returns Array of normalized encoding names.
 */
function parseEncodings(encoding: string): string[] {
  return encoding
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0 && part !== "identity");
}

/**
 * @ru Добавляет noop-метод dump к буферу, сохраняя совместимость с TransportStreamExtensions.
 * @en Attaches a noop dump method to a buffer, maintaining TransportStreamExtensions compatibility.
 * @param buffer - The Uint8Array buffer.
 * @returns Buffer with dump method attached.
 */
function attachNoopDump(buffer: Uint8Array): BufferPayload {
  const payload = buffer as BufferPayload;
  payload.dump = async (): Promise<void> => {};
  return payload;
}

/**
 * @ru Добавляет метод dump к стриму, который отменяет (cancel) поток.
 * @en Attaches a dump method to a stream that cancels the stream.
 * @param stream - ReadableStream to enhance.
 * @returns Stream with dump method attached.
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
 * @ru Применяет один этап декомпрессии к буферу синхронно (для одиночных чанков).
 * @en Applies a single decompression step to a buffer synchronously (for single chunks).
 * @param input - Compressed buffer.
 * @param encoding - Single encoding name ("gzip", "deflate", "br").
 * @returns Decompressed buffer, or original if encoding is unknown.
 * @throws If decompression fails due to corrupt data.
 */
function decompressOnce(input: Uint8Array, encoding: string): Uint8Array {
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);

  switch (encoding) {
    case "gzip":
    case "x-gzip":
      return gunzipSync(buffer);
    case "deflate":
      return inflateSync(buffer);
    case "br":
      return brotliDecompressSync(buffer);
    default:
      return input;
  }
}

/**
 * @ru Полностью декомпрессирует буфер, последовательно применяя цепочку алгоритмов из Content-Encoding.
 * @en Fully decompresses a buffer by sequentially applying the Content-Encoding chain.
 * @param body - Compressed Uint8Array body.
 * @param encoding - Raw Content-Encoding header (may contain multiple comma-separated values).
 * @returns Decompressed buffer with a noop dump method.
 */
export function decompressBuffer(
  body: Uint8Array,
  encoding: string,
): BufferPayload {
  let current: Uint8Array = body;
  const encodings = parseEncodings(encoding);

  for (let i = 0; i < encodings.length; i++) {
    current = decompressOnce(current, encodings[i]!);
  }

  return attachNoopDump(current);
}

/**
 * @ru Создаёт декомпрессирующий поток, минимизируя конвертацию между Web и Node.js стримами.
 * @en Creates a decompressing stream while minimising conversion between Web and Node.js streams.
 *
 * @ru Алгоритм: для gzip/deflate при наличии глобального DecompressionStream использует Web Streams API,
 * иначе переключается на Node.js zlib. Brotli всегда идёт через Node.js (до появления стандартного Web-потока).
 * @en Algorithm: for gzip/deflate, if global DecompressionStream is available, uses Web Streams API;
 * otherwise falls back to Node.js zlib. Brotli always goes through Node.js (until standard Web stream is available).
 *
 * @param body - Original compressed ReadableStream.
 * @param encoding - Raw Content-Encoding header (may be a chain).
 * @returns Decompressed ReadableStream with a dump method that cancels the stream.
 */
export function createDecompressStream(
  body: ReadableStream<Uint8Array>,
  encoding: string,
): StreamPayload {
  const encodings = parseEncodings(encoding);
  if (encodings.length === 0) return attachStreamDump(body);

  let current: ReadableStream<Uint8Array> = body;
  let nodeReadableStream: Readable | null = null;

  for (let i = 0; i < encodings.length; i++) {
    const enc = encodings[i]!;
    const isGzip = enc === "gzip" || enc === "x-gzip";
    const isDeflate = enc === "deflate";

    if ((isGzip || isDeflate) && typeof DecompressionStream !== "undefined") {
      if (nodeReadableStream) {
        current = Readable.toWeb(
          nodeReadableStream,
        ) as unknown as ReadableStream<Uint8Array>;
        nodeReadableStream = null;
      }
      current = current.pipeThrough(
        new DecompressionStream(isGzip ? "gzip" : "deflate") as TransformStream<
          Uint8Array,
          Uint8Array
        >,
      );
    } else {
      if (!nodeReadableStream) {
        nodeReadableStream = Readable.fromWeb(
          current as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
        );
      }

      if (isGzip) nodeReadableStream = nodeReadableStream.pipe(createGunzip());
      else if (isDeflate)
        nodeReadableStream = nodeReadableStream.pipe(createInflate());
      else if (enc === "br")
        nodeReadableStream = nodeReadableStream.pipe(createBrotliDecompress());
    }
  }

  if (nodeReadableStream) {
    current = Readable.toWeb(
      nodeReadableStream,
    ) as unknown as ReadableStream<Uint8Array>;
  }

  return attachStreamDump(current);
}
