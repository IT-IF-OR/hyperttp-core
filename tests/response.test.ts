import { describe, it, expect } from "vitest";
import { HyperHttpResponse, cloneBodyFast, mergeHeadersFast } from "../src/utils/response.js";

function mockResponse(overrides: Partial<{
  status: number;
  headers: Record<string, string | string[]>;
  body: unknown;
  url: string;
  _raw: any;
}> = {}) {
  return {
    status: overrides.status ?? 200,
    headers: overrides.headers ?? {},
    body: overrides.body ?? null,
    url: overrides.url ?? "",
    _raw: overrides._raw,
  } as any;
}

describe("HyperHttpResponse", () => {
  describe("text()", () => {
    it("returns body as text for string body", async () => {
      const res = new HyperHttpResponse(mockResponse({ body: "hello" }));
      expect(await res.text()).toBe("hello");
    });

    it("returns body as text for Uint8Array body", async () => {
      const body = new TextEncoder().encode("hello");
      const res = new HyperHttpResponse(mockResponse({ body }));
      expect(await res.text()).toBe("hello");
    });

    it("returns body as text for ArrayBuffer body", async () => {
      const body = new TextEncoder().encode("hello").buffer;
      const res = new HyperHttpResponse(mockResponse({ body }));
      expect(await res.text()).toBe("hello");
    });

    it("caches text result", async () => {
      const res = new HyperHttpResponse(mockResponse({ body: "hello" }));
      const t1 = await res.text();
      const t2 = await res.text();
      expect(t1).toBe(t2);
    });
  });

  describe("json()", () => {
    it("parses JSON body from text", async () => {
      const res = new HyperHttpResponse(mockResponse({ body: '{"key":"value"}' }));
      expect(await res.json()).toEqual({ key: "value" });
    });

    it("returns directly for object body", async () => {
      const body = { key: "value" };
      const res = new HyperHttpResponse(mockResponse({ body }));
      expect(await res.json()).toEqual(body);
    });

    it("caches JSON result", async () => {
      const res = new HyperHttpResponse(mockResponse({ body: '{"a":1}' }));
      const j1 = await res.json();
      const j2 = await res.json();
      expect(j1).toEqual(j2);
    });

    it("text() then json() works", async () => {
      const res = new HyperHttpResponse(mockResponse({ body: '{"a":1}' }));
      await res.text();
      const j = await res.json();
      expect(j).toEqual({ a: 1 });
    });

    it("json() then text() works", async () => {
      const res = new HyperHttpResponse(mockResponse({ body: '{"a":1}' }));
      await res.json();
      const t = await res.text();
      expect(t).toBe('{"a":1}');
    });
  });

  describe("arrayBuffer()", () => {
    it("returns ArrayBuffer for Uint8Array body", async () => {
      const body = new Uint8Array([1, 2, 3]);
      const res = new HyperHttpResponse(mockResponse({ body }));
      const buf = await res.arrayBuffer();
      expect(new Uint8Array(buf)).toEqual(body);
    });

    it("returns ArrayBuffer for ArrayBuffer body", async () => {
      const body = new Uint8Array([1, 2, 3]).buffer;
      const res = new HyperHttpResponse(mockResponse({ body }));
      const buf = await res.arrayBuffer();
      expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]));
    });
  });

  describe("dump()", () => {
    it("drains string body (no-op)", async () => {
      const res = new HyperHttpResponse(mockResponse({ body: "hi" }));
      await expect(res.dump()).resolves.toBeUndefined();
    });

    it("is idempotent", async () => {
      const res = new HyperHttpResponse(mockResponse({ body: "hi" }));
      await res.dump();
      await res.dump(); // should not throw
    });
  });

  describe("clone()", () => {
    it("clones a response with string body", () => {
      const res = new HyperHttpResponse(mockResponse({ body: "hello", status: 200 }));
      const cloned = res.clone();
      expect(cloned.status).toBe(200);
      expect(cloned.body).toBe("hello");
    });
  });

  describe("status and headers", () => {
    it("stores status", () => {
      const res = new HyperHttpResponse(mockResponse({ status: 404, body: "not found" }));
      expect(res.status).toBe(404);
    });

    it("stores headers", () => {
      const res = new HyperHttpResponse(mockResponse({ headers: { "content-type": "text/plain" } }));
      expect(res.headers["content-type"]).toBe("text/plain");
    });

    it("defaults url to empty string", () => {
      const res = new HyperHttpResponse(mockResponse({}));
      expect(res.url).toBe("");
    });
  });

  describe("_consumeBody with _raw", () => {
    it("uses _raw.arrayBuffer() when available", async () => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hello"));
          controller.close();
        },
      });
      const raw = new Response(body);
      const transportResponse = {
        status: 200,
        headers: {},
        body: raw.body,
        url: "",
        _raw: raw,
      };
      const res = new HyperHttpResponse(transportResponse as any);
      const text = await res.text();
      expect(text).toBe("hello");
    });

    it("text() and json() on stream body both work", async () => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ a: 1 })));
          controller.close();
        },
      });
      const res = new HyperHttpResponse(mockResponse({ body }));
      const text = await res.text();
      expect(text).toBe(JSON.stringify({ a: 1 }));
      const json = await res.json();
      expect(json).toEqual({ a: 1 });
    });
  });
});

describe("cloneBodyFast", () => {
  it("returns primitives as-is", () => {
    expect(cloneBodyFast(42)).toBe(42);
    expect(cloneBodyFast("str")).toBe("str");
    expect(cloneBodyFast(null)).toBe(null);
  });

  it("shallow clones plain objects", () => {
    const obj = { a: 1, b: 2 };
    const cloned = cloneBodyFast(obj);
    expect(cloned).toEqual(obj);
    expect(cloned).not.toBe(obj);
  });

  it("does not clone ReadableStream", () => {
    const stream = new ReadableStream();
    expect(cloneBodyFast(stream)).toBe(stream);
  });

  it("does not clone Uint8Array", () => {
    const arr = new Uint8Array([1, 2]);
    expect(cloneBodyFast(arr)).toBe(arr);
  });

  it("tries structuredClone for complex objects", () => {
    const obj = { nested: { date: new Date("2020-01-01") } };
    const cloned = cloneBodyFast(obj);
    expect((cloned as any).nested.date).toBeInstanceOf(Date);
  });
});

describe("mergeHeadersFast", () => {
  it("returns base when no override", () => {
    const base = { a: "1" };
    expect(mergeHeadersFast(base)).toBe(base);
  });

  it("returns base when override is empty", () => {
    const base = { a: "1" };
    expect(mergeHeadersFast(base, {})).toBe(base);
  });

  it("merges with override", () => {
    const base = { a: "1" };
    const merged = mergeHeadersFast(base, { b: "2" });
    expect(merged).toEqual({ a: "1", b: "2" });
  });
});
