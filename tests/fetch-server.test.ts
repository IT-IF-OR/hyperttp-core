import { request as nodeRequest } from "node:http";
import * as http from "node:http";
import type { AddressInfo, Server } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchTransport } from "../src/transports/fetch.js";
import type { TransportRequest, TransportServer } from "@hyperttp/types";

const capturedServers: Server[] = [];
let closeServer: TransportServer["close"] | undefined;

function baseUrl(): string {
  const server = capturedServers.at(-1);
  if (!server) throw new Error("Expected FetchTransport to create an HTTP server.");

  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function start(
  transport: FetchTransport,
  options: Parameters<FetchTransport["listen"]>[0],
): Promise<TransportServer> {
  type ListenTarget = { listen: (...args: unknown[]) => Server };
  const target = http.Server.prototype as unknown as ListenTarget;
  const originalListen = target.listen;
  const spy = vi.spyOn(target, "listen").mockImplementation(function (this: Server, ...args) {
    capturedServers.push(this);
    return Reflect.apply(originalListen, this, args) as Server;
  });

  try {
    const server = await transport.listen({ host: "127.0.0.1", port: 0, ...options });
    closeServer = server.close;
    return server;
  } finally {
    spy.mockRestore();
  }
}

function requestWithoutContentLength(
  url: string,
  chunks: string[],
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = nodeRequest(
      url,
      { method: "POST", headers: { "transfer-encoding": "chunked" } },
      (res) => {
        const responseChunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => responseChunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(responseChunks).toString() }),
        );
      },
    );
    req.on("error", reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

async function waitForClose(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.once("close", resolve));
}

afterEach(async () => {
  if (closeServer) await closeServer();
  closeServer = undefined;
  capturedServers.splice(0);
  vi.restoreAllMocks();
});

describe("FetchTransport.listen", () => {
  it("serves HTTP requests and preserves the raw transport envelope", async () => {
    const onRequest = vi.fn(async (request: TransportRequest) => {
      expect(request).toMatchObject({
        method: "POST",
        url: "/messages?draft=1",
        headers: expect.objectContaining({ "content-type": "text/plain", "x-client": "test" }),
        protocol: "rest",
      });
      expect(Buffer.from(request.body as Uint8Array).toString()).toBe("hello");

      return {
        status: 201,
        statusText: "Created here",
        headers: { "content-type": "application/json", "x-response": "yes" },
        body: { accepted: true },
      };
    });
    const server = await start(new FetchTransport(), { onRequest });

    try {
      const response = await fetch(`${baseUrl()}/messages?draft=1`, {
        method: "POST",
        headers: { "content-type": "text/plain", "x-client": "test" },
        body: "hello",
      });

      expect(response.status).toBe(201);
      expect(response.statusText).toBe("Created here");
      expect(response.headers.get("x-response")).toBe("yes");
      await expect(response.json()).resolves.toEqual({ accepted: true });
      expect(onRequest).toHaveBeenCalledOnce();
    } finally {
      await server.close();
      closeServer = undefined;
    }
  });

  it("returns 501 when no request handler is configured", async () => {
    const server = await start(new FetchTransport(), {});

    try {
      const response = await fetch(`${baseUrl()}/unhandled`);
      expect(response.status).toBe(501);
      await expect(response.text()).resolves.toBe("Not Implemented");
    } finally {
      await server.close();
      closeServer = undefined;
    }
  });

  it("rejects oversized declared and streamed request bodies before the handler", async () => {
    const onRequest = vi.fn();
    const server = await start(new FetchTransport({ maxBodyBytes: 3 }), { onRequest });

    try {
      const declared = await fetch(`${baseUrl()}/declared`, { method: "POST", body: "four" });
      expect(declared.status).toBe(413);
      await expect(declared.text()).resolves.toBe("Payload Too Large");

      const streamed = await requestWithoutContentLength(`${baseUrl()}/streamed`, ["ab", "cd"]);
      expect(streamed).toEqual({ status: 413, body: "Payload Too Large" });
      expect(onRequest).not.toHaveBeenCalled();
    } finally {
      await server.close();
      closeServer = undefined;
    }
  });

  it("reports handler failures with request context and returns 500", async () => {
    const failure = new Error("handler failed");
    const onError = vi.fn();
    const server = await start(new FetchTransport({ onError }), {
      onRequest: () => {
        throw failure;
      },
    });

    try {
      const response = await fetch(`${baseUrl()}/broken`, { headers: { "x-request-id": "r-1" } });
      expect(response.status).toBe(500);
      await expect(response.text()).resolves.toBe("Internal Server Error");
      expect(onError).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({
          method: "GET",
          url: "/broken",
          headers: expect.objectContaining({ "x-request-id": "r-1" }),
          protocol: "rest",
        }),
      );
    } finally {
      await server.close();
      closeServer = undefined;
    }
  });

  it("reports runtime server errors through the configured logger", async () => {
    const logger = vi.fn();
    const server = await start(new FetchTransport({ logger }), {
      onRequest: () => ({ status: 204, headers: {}, body: undefined }),
    });
    const nativeServer = capturedServers.at(-1)!;
    const failure = new Error("socket failure");

    try {
      nativeServer.emit("error", failure);
      expect(logger).toHaveBeenCalledWith("error", "[FetchTransport] HTTP server error", failure);
    } finally {
      await server.close();
      closeServer = undefined;
    }
  });

  it("rejects an already-aborted startup and closes a running server when aborted", async () => {
    const beforeStart = new AbortController();
    beforeStart.abort(new Error("cancelled before start"));
    await expect(new FetchTransport().listen({ signal: beforeStart.signal })).rejects.toThrow(
      "cancelled before start",
    );

    const controller = new AbortController();
    const server = await start(new FetchTransport(), {
      signal: controller.signal,
      onRequest: () => ({ status: 200, headers: {}, body: "ok" }),
    });
    const nativeServer = capturedServers.at(-1)!;

    controller.abort();
    await waitForClose(nativeServer);
    expect(nativeServer.listening).toBe(false);
    await expect(server.close()).resolves.toBeUndefined();
    closeServer = undefined;
  });

  it("closes idempotently and stops accepting new connections", async () => {
    const server = await start(new FetchTransport(), {
      onRequest: () => ({ status: 200, headers: {}, body: "ok" }),
    });
    const url = `${baseUrl()}/closed`;

    await expect(server.close()).resolves.toBeUndefined();
    await expect(server.close()).resolves.toBeUndefined();
    closeServer = undefined;
    await expect(fetch(url)).rejects.toThrow();
  });
});
