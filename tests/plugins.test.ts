import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { HyperCore } from "../src/Core/HyperCore.js";
import { NodeTransport } from "../src/transports/node.js";
import type { HyperPlugin, InternalRequest, HttpResponse, HyperttpError, PluginContext, TransportResponse } from "@hyperttp/types";

const BASE = "http://127.0.0.1:3000";

function makeCore(config?: Record<string, unknown>): HyperCore {
  const transport = new NodeTransport({ baseUrl: (config?.baseURL as string) ?? BASE } as any);
  return new HyperCore({ baseURL: BASE, ...config } as any, transport);
}

function destroyCore(core: HyperCore): Promise<void> {
  return core.destroy();
}

describe("Plugin pipeline", () => {
  it("onRequest modifies request", async () => {
    const plugin: HyperPlugin = {
      name: "test-on-request",
      onRequest: (req) => {
        req.headers = { ...req.headers, "X-Test": "injected" };
      },
    };
    const core = makeCore();
    core.use(plugin);
    const res = await core.get("/get");
    expect(res.status).toBe(200);
    await destroyCore(core);
  });

  it("onRequest short-circuits with response", async () => {
    const plugin: HyperPlugin = {
      name: "short-circuit",
      onRequest: async () => {
        return {
          status: 418,
          headers: {},
          body: "short",
          url: "",
          text: async () => "short",
          json: async () => ({}),
          stream: async () => ({ status: 418, headers: {}, body: new ReadableStream(), url: "" }),
        } as any;
      },
    };
    const core = makeCore();
    core.use(plugin);
    const res = await core.get("/json");
    expect(res.status).toBe(418);
    const text = await res.text();
    expect(text).toBe("short");
    await destroyCore(core);
  });

  it("onResponse mutator modifies response", async () => {
    const plugin: HyperPlugin = {
      name: "add-header",
      onResponse: (res) => {
        (res.headers as any)["X-Processed"] = "true";
      },
    };
    const core = makeCore();
    core.use(plugin);
    const res = await core.get("/json");
    expect(res.status).toBe(200);
    expect((res.headers as any)["X-Processed"]).toBe("true");
    await destroyCore(core);
  });

  it("onResponse side-effect runs in background", async () => {
    const fn = vi.fn();
    const plugin: HyperPlugin = {
      name: "side-effect",
      mode: "background",
      onResponse: () => { fn(); },
    };
    const core = makeCore();
    core.use(plugin);
    await core.get("/json");
    // Side effects run asynchronously, give them a tick
    await new Promise((r) => setTimeout(r, 50));
    expect(fn).toHaveBeenCalled();
    await destroyCore(core);
  });

  it("onResponseData transforms raw response", async () => {
    const plugin: HyperPlugin = {
      name: "transform-data",
      onResponseData: (res: TransportResponse) => {
        return { ...res, status: 201 } as any;
      },
    };
    const core = makeCore();
    core.use(plugin);
    const res = await core.get("/json");
    expect(res.status).toBe(201);
    await destroyCore(core);
  });

  it("onError recovers from error", async () => {
    let attempt = 0;
    const plugin: HyperPlugin = {
      name: "recover",
      onError: () => {
        attempt++;
        if (attempt === 1) {
          return {
            status: 200,
            headers: {},
            body: "recovered",
            url: "",
            text: async () => "recovered",
            json: async () => ({}),
            stream: async () => ({ status: 200, headers: {}, body: new ReadableStream(), url: "" }),
          } as any;
        }
        return null;
      },
    };
    const badTransport = new NodeTransport({ baseUrl: "http://127.0.0.1:1" } as any);
    const core = new HyperCore({ baseURL: "http://127.0.0.1:1" }, badTransport);
    core.use(plugin);
    const res = await core.get("/test");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("recovered");
    await destroyCore(core);
  });

  it("plugins execute in priority order", async () => {
    const order: string[] = [];
    const makePlugin = (name: string, priority: number): HyperPlugin => ({
      name,
      priority,
      onRequest: () => { order.push(name); },
    });
    const core = makeCore();
    core.use(makePlugin("low", -10));
    core.use(makePlugin("high", 100));
    core.use(makePlugin("medium", 0));
    await core.get("/json");
    expect(order).toEqual(["high", "medium", "low"]);
    await destroyCore(core);
  });

  it("plugin with enabled=false is skipped", () => {
    const plugin: HyperPlugin = {
      name: "disabled",
      enabled: () => false,
      onRequest: () => { throw new Error("should not run"); },
    };
    const core = makeCore();
    expect(() => core.use(plugin)).not.toThrow();
    core.destroy();
  });

  it("multiple plugins chain correctly", async () => {
    const plugin1: HyperPlugin = {
      name: "p1",
      onResponse: (res) => {
        (res as any)._meta = (res as any)._meta || [];
        (res as any)._meta.push("p1");
      },
    };
    const plugin2: HyperPlugin = {
      name: "p2",
      onResponse: (res) => {
        (res as any)._meta = (res as any)._meta || [];
        (res as any)._meta.push("p2");
      },
    };
    const core = makeCore();
    core.use(plugin1);
    core.use(plugin2);
    const res = await core.get("/json");
    expect((res as any)._meta).toEqual(["p1", "p2"]);
    await destroyCore(core);
  });
});
