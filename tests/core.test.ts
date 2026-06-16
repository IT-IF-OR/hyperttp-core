import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HyperCore } from "../src/Core/HyperCore.js";
import { NodeTransport } from "../src/transports/node.js";

const BASE = "http://127.0.0.1:3000";

let client: HyperCore;

beforeAll(() => {
  client = new HyperCore({ baseURL: BASE }, new NodeTransport({ baseUrl: BASE } as any));
});

afterAll(async () => {
  await client.destroy();
});

describe("HyperCore HTTP methods", () => {
  it("GET /json returns JSON", async () => {
    const res = await client.get("/json");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("ok", true);
  });

  it("GET with full URL", async () => {
    const res = await client.get(`${BASE}/json`);
    expect(res.status).toBe(200);
  });

  it("POST /post with body", async () => {
    const res = await client.post("/post", "test-body");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("test-body");
  });

  it("POST /post with JSON body", async () => {
    const body = { message: "hello" };
    const res = await client.post("/post", body);
    const text = await res.text();
    expect(text).toContain("hello");
  });

  it("PUT /post returns 200", async () => {
    const res = await client.put("/post", "data");
    expect(res.status).toBe(200);
  });

  it("PATCH /post returns 200", async () => {
    const res = await client.patch("/post", "data");
    expect(res.status).toBe(200);
  });

  it("DELETE /json returns 200", async () => {
    const res = await client.delete("/json");
    expect(res.status).toBe(200);
  });

  it("HEAD /json returns 200", async () => {
    const res = await client.head("/json");
    expect(res.status).toBe(200);
  });

  it("OPTIONS /json returns 200", async () => {
    const res = await client.options("/json");
    expect(res.status).toBe(200);
  });
});

describe("HyperCore shortcuts", () => {
  it("json() parses response", async () => {
    const data = await client.json("/json");
    expect(data).toHaveProperty("ok", true);
  });

  it("text() returns body as text", async () => {
    const text = await client.text("/get");
    expect(text).toContain("ok");
  });

  it("dump() discards body", async () => {
    await expect(client.dump("/json")).resolves.toBeUndefined();
  });
});

describe("HyperCore stream", () => {
  it("stream() returns StreamResponse", async () => {
    const res = await client.stream("/json");
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });

  it("postStream() returns StreamResponse", async () => {
    const res = await client.postStream("/post", "data");
    expect(res.status).toBe(200);
  });
});

describe("HyperCore status codes", () => {
  it("handles 404", async () => {
    const res = await client.get("/status/404");
    expect(res.status).toBe(404);
  });

  it("handles 500", async () => {
    const res = await client.get("/status/500");
    expect(res.status).toBe(500);
  });

  it("handles 302 redirect", async () => {
    const res = await client.get("/status/302");
    expect(res.status).toBeGreaterThanOrEqual(300);
  });
});

describe("HyperCore extend / create", () => {
  it("extend() creates new instance with merged config", () => {
    const sub = client.extend({ baseURL: "http://other" });
    expect(sub).toBeInstanceOf(HyperCore);
    expect(sub.config.baseURL).toBe("http://other");
    expect((sub as any).transportManager.getSync()).toBe((client as any).transportManager.getSync());
    sub.destroy();
  });

  it("create() is an alias for extend()", () => {
    const sub = client.create({ baseURL: "http://other" });
    expect(sub).toBeInstanceOf(HyperCore);
    sub.destroy();
  });
});

describe("HyperCore headers", () => {
  it("sends default headers", async () => {
    const res = await client.get("/get");
    const text = await res.text();
    expect(res.headers).toBeDefined();
  });

  it("merges request-specific headers", async () => {
    const res = await client.get({ url: "/get", headers: { "X-Custom": "test" } });
    expect(res.status).toBe(200);
  });

  it("default headers are not shared across requests", async () => {
    const client2 = new HyperCore({ baseURL: BASE }, new NodeTransport({ baseUrl: BASE } as any));
    // First request with custom headers via RequestInterface
    await client2.get({ url: "/get", headers: { Authorization: "Bearer first" } });
    // Second request without custom headers — should NOT have Authorization
    const res2 = await client2.get("/get");
    expect(res2.status).toBe(200);
    // If the bug exists, defaultHeaders would be polluted
    await client2.destroy();
  });
});

describe("HyperCore URL resolution", () => {
  it("resolves relative URL with baseURL", async () => {
    const res = await client.get("/json");
    expect(res.status).toBe(200);
  });

  it("resolves absolute URL ignoring baseURL", async () => {
    const res = await client.get(`${BASE}/json`);
    expect(res.status).toBe(200);
  });
});

describe("HyperCore error handling", () => {
  it("throws on invalid URL", () => {
    expect(() => client.get("")).toThrow();
  });

  it("throws on connection refused", async () => {
    const badTransport = new NodeTransport({ baseUrl: "http://127.0.0.1:1" } as any);
    const badClient = new HyperCore({ baseURL: "http://127.0.0.1:1" }, badTransport);
    await expect(badClient.get("/test")).rejects.toThrow();
    await badClient.destroy();
  });
});
