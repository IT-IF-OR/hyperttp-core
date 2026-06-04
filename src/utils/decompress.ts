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

function parseEncodings(encoding: string): string[] {
  return encoding
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0 && part !== "identity");
}

function attachNoopDump(buffer: Uint8Array): BufferPayload {
  const payload = buffer as BufferPayload;
  payload.dump = async (): Promise<void> => {};
  return payload;
}

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
