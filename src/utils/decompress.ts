import type { TransportStreamExtensions } from "@hyperttp/types";
import { runtimeImport } from "../transports/manager.js";

type StreamPayload = ReadableStream<Uint8Array> & TransportStreamExtensions;
type BufferPayload = Uint8Array & TransportStreamExtensions;

interface NodeReadableLike {
  pipe<T extends NodeReadableLike>(writableStream: unknown): T;
}

interface NodeStreamModule {
  Readable: {
    fromWeb(stream: unknown, options?: unknown): NodeReadableLike;
    toWeb(nodeStream: unknown): ReadableStream<Uint8Array>;
  };
}

interface NodeZlibModule {
  gunzipSync(buf: Uint8Array): Uint8Array;
  inflateSync(buf: Uint8Array): Uint8Array;
  brotliDecompressSync(buf: Uint8Array): Uint8Array;
  createGunzip(): unknown;
  createInflate(): unknown;
  createBrotliDecompress(): unknown;
}

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
 * @ru Кэш промисов импорта Node.js модулей для избежания повторных загрузок.
 * @en Cache of Node.js module import promises to avoid repeated loads.
 */
let zlibModulePromise: Promise<NodeZlibModule> | null = null;
let streamModulePromise: Promise<NodeStreamModule> | null = null;

/**
 * @ru Лениво загружает и кэширует модуль node:zlib.
 * @en Lazily loads and caches the node:zlib module.
 */
async function getZlibModule(): Promise<NodeZlibModule> {
  if (!zlibModulePromise) {
    zlibModulePromise = runtimeImport<NodeZlibModule>("node:zlib");
  }
  return zlibModulePromise;
}

/**
 * @ru Лениво загружает и кэширует модуль node:stream.
 * @en Lazily loads and caches the node:stream module.
 */
async function getStreamModule(): Promise<NodeStreamModule> {
  if (!streamModulePromise) {
    streamModulePromise = runtimeImport<NodeStreamModule>("node:stream");
  }
  return streamModulePromise;
}

/**
 * @ru Парсит строку Content-Encoding в массив кодировок за один проход.
 * Игнорирует 'identity' (без сжатия) и пустые значения.
 * @en Parses Content-Encoding string into an array of encodings in a single pass.
 * Ignores 'identity' (no compression) and empty values.
 */
function parseEncodings(encoding: string): string[] {
  const result: string[] = [];
  let start = 0;
  const len = encoding.length;

  for (let i = 0; i <= len; i++) {
    if (i === len || encoding[i] === ",") {
      let part = encoding.slice(start, i).trim().toLowerCase();
      if (part && part !== "identity") {
        result.push(part);
      }
      start = i + 1;
    }
  }

  return result;
}

/**
 * @ru Добавляет no-op метод dump() к буферу.
 * @en Attaches a no-op dump() method to the buffer.
 */
function attachNoopDump(buffer: Uint8Array): BufferPayload {
  const payload = buffer as BufferPayload;
  payload.dump = NOOP_DUMP;
  return payload;
}

/**
 * @ru Добавляет метод dump() к стриму для отмены и освобождения сокета.
 * @en Attaches a dump() method to the stream for cancellation and socket release.
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
 */
async function decompressOnceWeb(input: Uint8Array, encoding: string): Promise<Uint8Array> {
  const enc = encoding.trim().toLowerCase();
  if (typeof globalThis.DecompressionStream === "undefined") return input;

  const format = enc === "gzip" || enc === "x-gzip" ? "gzip" : enc === "deflate" ? "deflate" : null;

  if (!format) return input;

  const blob = new Blob([input as unknown as BlobPart]);
  const response = new Response(blob);
  const decompressedStream = response.body!.pipeThrough(
    new globalThis.DecompressionStream(format) as TransformStream<Uint8Array, Uint8Array>,
  );

  const buf = await new Response(decompressedStream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * @ru Декомпрессирует буфер с использованием node:zlib.
 * Поддерживает gzip, deflate и brotli.
 * @en Decompresses a buffer using node:zlib.
 * Supports gzip, deflate, and brotli.
 */
async function decompressOnceNode(input: Uint8Array, encoding: string): Promise<Uint8Array> {
  const enc = encoding.trim().toLowerCase();
  const zlib = await getZlibModule();

  switch (enc) {
    case "gzip":
    case "x-gzip":
      return zlib.gunzipSync(input);
    case "deflate":
      return zlib.inflateSync(input);
    case "br":
      return zlib.brotliDecompressSync(input);
    default:
      return input;
  }
}

/**
 * @ru Декомпрессирует буфер с поддержкой множественных кодировок.
 * Сначала пытается Web API, затем fallback на node:zlib для серверных сред.
 * @en Decompresses a buffer with support for multiple encodings.
 * Tries Web API first, then falls back to node:zlib for server environments.
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
        const streamMod = await getStreamModule();
        const zlibMod = await getZlibModule();

        const nodeReadableStream = streamMod.Readable.fromWeb(current);
        let transformer: NodeReadableLike = nodeReadableStream;

        if (isGzip) {
          transformer = nodeReadableStream.pipe<NodeReadableLike>(zlibMod.createGunzip());
        } else if (isDeflate) {
          transformer = nodeReadableStream.pipe<NodeReadableLike>(zlibMod.createInflate());
        } else if (isBrotli) {
          transformer = nodeReadableStream.pipe<NodeReadableLike>(zlibMod.createBrotliDecompress());
        }

        current = streamMod.Readable.toWeb(transformer);
      } catch {
        continue;
      }
    }
  }
  return attachStreamDump(current);
}
