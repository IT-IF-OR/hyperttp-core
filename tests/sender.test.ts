import { describe, it, expect, vi } from "vitest";
import { RestSender } from "../src/index.js";
import type { RequestContext } from "@hyperttp/types";

function makeCtx(): RequestContext {
  return { requestId: "test", startTime: 0, meta: {}, state: {} };
}

describe("RestSender.prepare", () => {
  it("builds a transport request from a RestInput descriptor", () => {
    const sender = new RestSender();
    const prepared = sender.prepare(
      { protocol: "rest", input: { method: "GET", url: "/users" } },
      makeCtx(),
    );

    expect(prepared.method).toBe("GET");
    expect(prepared.url).toBe("/users");
    expect(prepared.headers).toBeDefined();
    expect(prepared.protocol).toBe("rest");
  });

  it("appends query parameters", () => {
    const sender = new RestSender();
    const prepared = sender.prepare(
      {
        protocol: "rest",
        input: { method: "GET", url: "/users", query: { page: 1, tags: ["a", "b"] } },
      },
      makeCtx(),
    );

    expect(prepared.url).toBe("/users?page=1&tags=a&tags=b");
  });

  it("serializes plain-object bodies to JSON and sets content-type", () => {
    const sender = new RestSender();
    const prepared = sender.prepare(
      { protocol: "rest", input: { method: "POST", url: "/post", body: { ok: true } } },
      makeCtx(),
    );

    expect(prepared.method).toBe("POST");
    expect(prepared.body).toBe('{"ok":true}');
    expect(prepared.headers?.["content-type"]).toBe("application/json; charset=utf-8");
  });

  it("propagates the abort signal through", () => {
    const sender = new RestSender();
    const controller = new AbortController();
    const prepared = sender.prepare(
      {
        protocol: "rest",
        input: { method: "GET", url: "/users" },
        signal: controller.signal,
      },
      makeCtx(),
    );

    expect(prepared.signal).toBe(controller.signal);
    expect(prepared.signal?.aborted).toBe(false);

    controller.abort();
    expect(prepared.signal?.aborted).toBe(true);
  });

  it("wraps the signal with a timeout and aborts when it expires", async () => {
    const sender = new RestSender();
    const prepared = sender.prepare(
      { protocol: "rest", input: { method: "GET", url: "/slow", timeout: 5 } },
      makeCtx(),
    );

    expect(prepared.signal).toBeDefined();
    expect(prepared.signal?.aborted).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(prepared.signal?.aborted).toBe(true);
  });
});

describe("RestSender.send / parse", () => {
  const mockTransport = {
    async execute(req: unknown) {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        url: (req as { url: string }).url,
        body: new TextEncoder().encode('{"ok":true}'),
      };
    },
  };

  it("executes a full three-phase cycle", async () => {
    const sender = new RestSender();
    const ctx = makeCtx();

    const prepared = sender.prepare(
      { protocol: "rest", input: { method: "GET", url: "/users" } },
      ctx,
    );
    const raw = await sender.send(prepared, mockTransport as never, ctx);
    const universal = sender.parse(raw, ctx);

    expect(universal.protocol).toBe("rest");
    expect(universal.status).toBe(200);
    expect(universal.url).toBe("/users");
    expect(universal.data).toEqual({ ok: true });
    expect(universal.raw).toBe(raw);
  });

  it("carries statusText from the raw transport response", async () => {
    const sender = new RestSender();
    const raw = {
      status: 200,
      statusText: "OK",
      headers: {},
      url: "/users",
      body: new TextEncoder().encode('{"ok":true}'),
    };

    const universal = await sender.parse(raw, makeCtx());
    expect(universal.statusText).toBe("OK");
  });
});

describe("RestSender.methods", () => {
  it("dispatches through the core for core-first method calls", async () => {
    const sender = new RestSender();
    const send = vi.fn(async () => ({ ok: true, status: 200 }));
    const fakeCore = { send };

    await sender.methods.get!(fakeCore as never, "/users", { query: { page: 1 } });
    expect(send).toHaveBeenCalledWith({
      protocol: "rest",
      input: { method: "GET", url: "/users", query: { page: 1 } },
    });

    await sender.methods.post!(fakeCore as never, "/users", { ok: true });
    expect(send).toHaveBeenLastCalledWith({
      protocol: "rest",
      input: { method: "POST", url: "/users", body: { ok: true } },
    });
  });

  it("exposes head and options methods", async () => {
    const sender = new RestSender();
    const send = vi.fn(async () => ({ ok: true, status: 200 }));
    const fakeCore = { send };

    await sender.methods.head!(fakeCore as never, "/h");
    expect(send).toHaveBeenLastCalledWith({
      protocol: "rest",
      input: { method: "HEAD", url: "/h" },
    });

    await sender.methods.options!(fakeCore as never, "/o");
    expect(send).toHaveBeenLastCalledWith({
      protocol: "rest",
      input: { method: "OPTIONS", url: "/o" },
    });
  });

  it("exposes a generic request method with an arbitrary HTTP method", async () => {
    const sender = new RestSender();
    const send = vi.fn(async () => ({ ok: true, status: 200 }));
    const fakeCore = { send };

    await sender.methods.request!(fakeCore as never, "PATCH", "/r", { query: { page: 2 } });
    expect(send).toHaveBeenLastCalledWith({
      protocol: "rest",
      input: { method: "PATCH", url: "/r", query: { page: 2 } },
    });
  });

  it("preserves options.signal when no positional signal is supplied", async () => {
    const sender = new RestSender();
    const controller = new AbortController();
    const send = vi.fn(async () => ({ ok: true, status: 200 }));
    const fakeCore = { send };

    await sender.methods.get!(fakeCore as never, "/users", { signal: controller.signal });

    expect(send).toHaveBeenCalledWith({
      protocol: "rest",
      input: {
        method: "GET",
        url: "/users",
        signal: controller.signal,
      },
      signal: controller.signal,
    });
  });

  it("exposes a stream method that requests a raw (undecoded) body", async () => {
    const sender = new RestSender();
    const send = vi.fn(async () => ({ ok: true, status: 200 }));
    const fakeCore = { send };

    await sender.methods.stream!(fakeCore as never, "/s");
    expect(send).toHaveBeenLastCalledWith({
      protocol: "rest",
      input: { method: "GET", url: "/s", stream: true },
    });
  });
});

describe("RestSender stream mode", () => {
  it("keeps the body raw when stream is requested", async () => {
    const sender = new RestSender();
    const ctx = makeCtx();
    const body = new TextEncoder().encode('{"ok":true}');
    const transport = {
      execute: async () => ({
        status: 200,
        headers: { "content-type": "application/json" },
        url: "/s",
        body,
      }),
    };
    const prepared = sender.prepare(
      {
        protocol: "rest",
        input: { method: "GET", url: "/s", stream: true },
      },
      ctx,
    );

    const raw = await sender.send(prepared, transport, ctx);
    const universal = sender.parse(raw, ctx);

    expect(universal.data).toBe(body);
    expect(universal.data).toBeInstanceOf(Uint8Array);
  });

  it("decodes the body when stream is not requested", async () => {
    const sender = new RestSender();
    const ctx = makeCtx();
    const raw = {
      status: 200,
      headers: { "content-type": "application/json" },
      url: "/s",
      body: new TextEncoder().encode('{"ok":true}'),
    };
    const universal = sender.parse(raw, ctx);

    expect(universal.data).toEqual({ ok: true });
  });

  it("collects and decodes a stream-like body when stream is not requested", async () => {
    const sender = new RestSender();
    const ctx = makeCtx();

    const bytes = new TextEncoder().encode('{"ok":true}');

    const streamBody = {
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    };

    const transport = {
      execute: async () => ({
        status: 200,
        headers: {
          "content-type": "application/json",
        },
        url: "/s",
        body: streamBody,
      }),
    };

    const prepared = sender.prepare(
      {
        protocol: "rest",
        input: {
          method: "GET",
          url: "/s",
        },
      },
      ctx,
    );

    const raw = await sender.send(prepared, transport, ctx);
    const universal = sender.parse(raw, ctx);

    expect(raw.body).toBeInstanceOf(Uint8Array);
    expect(universal.data).toEqual({ ok: true });
  });

  it("collects a binary stream-like body into bytes via send()", async () => {
    const sender = new RestSender();
    const ctx = makeCtx();

    const bytes = new TextEncoder().encode("raw-bytes");

    const streamBody = {
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    };

    const transport = {
      execute: async () => ({
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
        },
        url: "/s",
        body: streamBody,
      }),
    };

    const prepared = sender.prepare(
      {
        protocol: "rest",
        input: {
          method: "GET",
          url: "/s",
        },
      },
      ctx,
    );

    const raw = await sender.send(prepared, transport, ctx);

    expect(raw.body).toBeInstanceOf(Uint8Array);

    const universal = sender.parse(raw, ctx);

    expect(universal.data).toBeInstanceOf(Uint8Array);
    expect(universal.data).toBe(raw.body);

    expect(new TextDecoder().decode(universal.data as Uint8Array)).toBe("raw-bytes");
  });
});
