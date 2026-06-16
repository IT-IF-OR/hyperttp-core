import { describe, it, expect } from "vitest";
import { normalizeHeaders, normalizeUrl, normalizeBody } from "../src/utils/normalize.js";
import { deepMerge } from "../src/utils/merge.js";

describe("normalizeUrl", () => {
  it("returns string as-is", () => {
    expect(normalizeUrl("http://example.com")).toBe("http://example.com");
  });

  it("extracts url from object", () => {
    expect(normalizeUrl({ url: "http://example.com" })).toBe("http://example.com");
  });

  it("extracts _url from object", () => {
    expect(normalizeUrl({ _url: "http://example.com" })).toBe("http://example.com");
  });

  it("builds url from scheme/host/path", () => {
    expect(normalizeUrl({ scheme: "https", host: "example.com", path: "/api" })).toBe("https://example.com/api");
  });

  it("throws if URL is missing", () => {
    expect(() => normalizeUrl({})).toThrow("URL missing in request");
    expect(() => normalizeUrl(null)).toThrow("URL missing in request");
  });

  it("coerces non-string url to string", () => {
    expect(normalizeUrl({ url: 42 })).toBe("42");
  });
});

describe("normalizeHeaders", () => {
  it("returns empty object for null/undefined", () => {
    expect(normalizeHeaders(null)).toEqual({});
    expect(normalizeHeaders(undefined)).toEqual({});
  });

  it("lowercases keys from plain object", () => {
    const result = normalizeHeaders({ "Content-Type": "application/json", "X-Custom": "val" });
    expect(result["content-type"]).toBe("application/json");
    expect(result["x-custom"]).toBe("val");
  });

  it("merges duplicate headers with comma", () => {
    const result = normalizeHeaders({ accept: ["text/html", "application/json"] });
    expect(result["accept"]).toBe("text/html, application/json");
  });

  it("stores set-cookie as array", () => {
    const result = normalizeHeaders({ "set-cookie": ["a=1", "b=2"] });
    expect(Array.isArray(result["set-cookie"])).toBe(true);
    expect(result["set-cookie"]).toEqual(["a=1", "b=2"]);
  });

  it("joins cookie with semicolon", () => {
    const result = normalizeHeaders({ cookie: ["a=1", "b=2"] });
    expect(result["cookie"]).toBe("a=1; b=2");
  });

  it("handles flat array format", () => {
    const result = normalizeHeaders(["Content-Type", "text/plain", "X-Custom", "val"]);
    expect(result["content-type"]).toBe("text/plain");
    expect(result["x-custom"]).toBe("val");
  });

  it("handles array-of-pairs format", () => {
    const result = normalizeHeaders([["Content-Type", "text/html"], ["X-Api", "key"]]);
    expect(result["content-type"]).toBe("text/html");
    expect(result["x-api"]).toBe("key");
  });

  it("skips entries with invalid keys", () => {
    const result = normalizeHeaders([["", "val"], [123, "val"]]);
    expect(Object.keys(result).length).toBe(0);
  });

  it("skips null/undefined values", () => {
    const result = normalizeHeaders({ a: undefined as any, b: null as any, c: "ok" });
    expect(result["c"]).toBe("ok");
    expect(Object.keys(result).length).toBe(1);
  });
});

describe("normalizeBody", () => {
  it("returns undefined for GET and HEAD", () => {
    expect(normalizeBody("GET", "body")).toBeUndefined();
    expect(normalizeBody("HEAD", "body")).toBeUndefined();
  });

  it("returns body for other methods", () => {
    expect(normalizeBody("POST", "data")).toBe("data");
    expect(normalizeBody("PUT", "data")).toBe("data");
    expect(normalizeBody("PATCH", "data")).toBe("data");
  });
});

describe("deepMerge", () => {
  it("merges two flat objects", () => {
    const result = deepMerge({ a: 1 }, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("deeply merges nested objects", () => {
    const result = deepMerge({ nested: { a: 1 } }, { nested: { b: 2 } });
    expect(result).toEqual({ nested: { a: 1, b: 2 } });
  });

  it("source overrides target for same keys", () => {
    const result = deepMerge({ a: 1 }, { a: 2 });
    expect(result).toEqual({ a: 2 });
  });

  it("handles undefined source values", () => {
    const result = deepMerge({ a: 1 }, { a: undefined, b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("deep clones source objects", () => {
    const inner = { x: 1 };
    const result = deepMerge({}, { inner });
    inner.x = 99;
    expect((result as any).inner.x).toBe(1);
  });

  it("handles empty source", () => {
    const result = deepMerge({ a: 1 }, {});
    expect(result).toEqual({ a: 1 });
  });

  it("arrays are replaced, not merged", () => {
    const result = deepMerge({ arr: [1, 2] }, { arr: [3] });
    expect(result).toEqual({ arr: [3] });
  });
});
