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

/**
 * @ru Тип потока с расширениями транспорта (метод dump).
 * @en Stream type with transport extensions (dump method).
 */
type StreamPayload = ReadableStream<Uint8Array> & TransportStreamExtensions;

/**
 * @ru Тип буфера с расширениями транспорта (метод dump).
 * @en Buffer type with transport extensions (dump method).
 */
type BufferPayload = Uint8Array & TransportStreamExtensions;

/**
 * @ru Разбирает строку Content-Encoding на массив кодировок (без identity).
 * @en Parses a Content-Encoding string into an array of encodings (excluding identity).
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
 * @ru Прикрепляет пустой метод dump к буферу для соответствия интерфейсу TransportStreamExtensions.
 * @en Attaches a no-op dump method to a buffer to conform to TransportStreamExtensions.
 * @param buffer - The buffer to decorate.
 * @returns The same buffer with a dump method.
 */
function attachNoopDump(buffer: Uint8Array): BufferPayload {
  const payload = buffer as BufferPayload;
  payload.dump = async (): Promise<void> => {};
  return payload;
}

/**
 * @ru Прикрепляет метод dump, который отменяет поток, к ReadableStream.
 * @en Attaches a dump method that cancels the stream to a ReadableStream.
 * @param stream - The stream to decorate.
 * @returns The same stream with a dump method.
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
 * @ru Применяет декомпрессию один раз для заданной кодировки. Поддерживает gzip, deflate, br.
 * @en Applies decompression once for a given encoding. Supports gzip, deflate, br.
 * @param input - The compressed input buffer.
 * @param encoding - Single encoding name (e.g., 'gzip', 'deflate', 'br').
 * @returns Decompressed buffer, or original if encoding is not recognized.
 */
function decompressOnce(input: Uint8Array, encoding: string): Uint8Array {
  const buffer = Buffer.from(input);

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
 * @ru Декомпрессирует буфер, последовательно применяя все кодировки из Content-Encoding.
 * @en Decompresses a buffer by sequentially applying all encodings from Content-Encoding.
 * @param body - Compressed buffer (Uint8Array).
 * @param encoding - Content-Encoding header value (e.g., 'gzip, deflate').
 * @returns Decompressed buffer with a no-op dump method.
 */
export function decompressBuffer(
  body: Uint8Array,
  encoding: string,
): BufferPayload {
  let current: Uint8Array = body;

  for (const enc of parseEncodings(encoding)) {
    current = decompressOnce(current, enc);
  }

  return attachNoopDump(current);
}

/**
 * @ru Создаёт декомпрессирующий поток для тела ответа, поддерживая цепочку кодировок. Использует DecompressionStream (если доступен) или Node.js zlib.
 * @en Creates a decompressing stream for the response body, supporting chained encodings. Uses DecompressionStream (if available) or Node.js zlib.
 * @param body - Source compressed stream.
 * @param encoding - Content-Encoding header value.
 * @returns Transformed stream with a dump method that cancels the stream.
 */
export function createDecompressStream(
  body: ReadableStream<Uint8Array>,
  encoding: string,
): StreamPayload {
  let current: ReadableStream<Uint8Array> = body;

  for (const enc of parseEncodings(encoding)) {
    if (enc === "gzip" || enc === "x-gzip") {
      if (typeof DecompressionStream !== "undefined") {
        current = current.pipeThrough(
          new DecompressionStream("gzip") as TransformStream<
            Uint8Array,
            Uint8Array
          >,
        );
        continue;
      }

      const nodeReadable = Readable.fromWeb(
        current as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
      );
      const decompressed = nodeReadable.pipe(createGunzip());
      current = Readable.toWeb(
        decompressed,
      ) as unknown as ReadableStream<Uint8Array>;
      continue;
    }

    if (enc === "deflate") {
      if (typeof DecompressionStream !== "undefined") {
        current = current.pipeThrough(
          new DecompressionStream("deflate") as TransformStream<
            Uint8Array,
            Uint8Array
          >,
        );
        continue;
      }

      const nodeReadable = Readable.fromWeb(
        current as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
      );
      const decompressed = nodeReadable.pipe(createInflate());
      current = Readable.toWeb(
        decompressed,
      ) as unknown as ReadableStream<Uint8Array>;
      continue;
    }

    if (enc === "br") {
      const nodeReadable = Readable.fromWeb(
        current as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
      );
      const decompressed = nodeReadable.pipe(createBrotliDecompress());
      current = Readable.toWeb(
        decompressed,
      ) as unknown as ReadableStream<Uint8Array>;
    }
  }

  return attachStreamDump(current);
}
