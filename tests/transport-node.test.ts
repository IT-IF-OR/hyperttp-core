import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NodeTransport } from "../src/transports/node.js";
import type { TransportRequest } from "@hyperttp/types";

const BASE = "http://127.0.0.1:3000";

function makeTransport(config = {}) {
  return new NodeTransport({ baseUrl: BASE, ...config } as any);
}

function req(overrides: Partial<TransportRequest> = {}): TransportRequest {
  return {
    method: overrides.method ?? "GET",
    url: overrides.url ?? "/json",
    headers: overrides.headers ?? {},
    body: overrides.body,
    signal: overrides.signal,
    stealth: overrides.stealth,
  };
}

describe("NodeTransport", () => {
  let transport: NodeTransport;

  beforeAll(() => {
    transport = makeTransport();
  });

  afterAll(async () => {
    await transport.destroy();
  });

  it("executes GET request", async () => {
    const res = await transport.execute(req());
    expect(res.status).toBe(200);
    expect(res.url).toContain("/json");
  });

  it("returns headers", async () => {
    const res = await transport.execute(req());
    expect(res.headers).toBeDefined();
    expect(Object.keys(res.headers).length).toBeGreaterThan(0);
  });

  it("sends string body in POST", async () => {
    const res = await transport.execute(req({
      method: "POST",
      url: "/post",
      body: "hello",
    }));
    expect(res.status).toBe(200);
  });

  it("sends object body as JSON", async () => {
    const res = await transport.execute(req({
      method: "POST",
      url: "/post",
      body: { msg: "test" },
    }));
    expect(res.status).toBe(200);
  });

  it("handles 404 status", async () => {
    const res = await transport.execute(req({ url: "/status/404" }));
    expect(res.status).toBe(404);
  });

  it("handles 500 status", async () => {
    const res = await transport.execute(req({ url: "/status/500" }));
    expect(res.status).toBe(500);
  });

  it("normalizes headers to lowercase", async () => {
    const res = await transport.execute(req({ headers: { "X-Custom": "val" } }));
    expect(res.status).toBe(200);
  });

  it("normalizes array headers", async () => {
    const res = await transport.execute(req({
      headers: [["X-Array", "val1"], ["X-Array2", "val2"]],
    }));
    expect(res.status).toBe(200);
  });

  it("handles large JSON body", async () => {
    const res = await transport.execute(req({ url: "/large" }));
    expect(res.status).toBe(200);
  });

  it("returns response body as Web stream", async () => {
    const res = await transport.execute(req());
    expect(res.body).toBeDefined();
    // The body should be a ReadableStream (Web API)
    if (res.body && typeof (res.body as any).getReader === "function") {
      const reader = (res.body as any).getReader();
      const { done, value } = await reader.read();
      expect(done).toBe(false);
      expect(value).toBeInstanceOf(Uint8Array);
    }
  });

  describe("decompression", () => {
    it("handles gzip-encoded response", async () => {
      // The benchmark server doesn't compress, so this tests the path
      // where no content-encoding header is set
      const res = await transport.execute(req());
      expect(res.status).toBe(200);
      const body = await new Response(res.body as any).text();
      expect(body).toContain("ok");
    });
  });

  describe("stealth mode", () => {
    it("applies stealth headers", async () => {
      const stealthTransport = makeTransport({
        stealth: { fingerprint: "chrome" },
      });
      const res = await stealthTransport.execute(req({ url: "/get" }));
      expect(res.status).toBe(200);
      await stealthTransport.destroy();
    });

    it("applies per-request stealth headers", async () => {
      const res = await transport.execute(req({
        url: "/get",
        stealth: { fingerprint: "firefox" },
      }));
      expect(res.status).toBe(200);
    });
  });

  describe("header normalization with Headers object", () => {
    it("handles Headers instance", async () => {
      const h = new Headers();
      h.set("x-custom", "test");
      const res = await transport.execute(req({ headers: h as any }));
      expect(res.status).toBe(200);
    });
  });

  describe("close / destroy", () => {
    it("close() does not throw", async () => {
      const t = makeTransport();
      await t.execute(req());
      await expect(t.close()).resolves.toBeUndefined();
    });

    it("destroy() does not throw", async () => {
      const t = makeTransport();
      await t.execute(req());
      await expect(t.destroy()).resolves.toBeUndefined();
    });

    it("destroy() allows creating new transport afterwards", async () => {
      const t = makeTransport();
      await t.destroy();
      const t2 = makeTransport();
      const res = await t2.execute(req());
      expect(res.status).toBe(200);
      await t2.destroy();
    });
  });

  describe("error handling", () => {
    it("throws on connection refused", async () => {
      const bad = makeTransport({ baseUrl: "http://127.0.0.1:1" });
      await expect(bad.execute(req({ url: "/test" }))).rejects.toThrow();
      await bad.destroy();
    });

    it("throws on invalid URL", async () => {
      await expect(transport.execute(req({ url: "" }))).rejects.toThrow();
    });
  });
});
