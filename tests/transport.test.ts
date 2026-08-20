import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HyperCore } from "../src/index.js";
import {
  getCachedTransport,
  resolveTransport,
  resetCachedTransport,
} from "../src/transports/manager.js";
import { FetchTransport } from "../src/transports/fetch.js";
import type { HyperSender, HyperTransport, TransportRequest } from "@hyperttp/types";

afterEach(() => {
  resetCachedTransport();
  vi.unstubAllGlobals();
});

function makeRequest(overrides: Partial<TransportRequest> = {}): TransportRequest {
  return {
    method: "GET",
    url: "https://example.com/",
    headers: {},
    protocol: "rest",
    ...overrides,
  };
}

describe("resolveTransport fallback", () => {
  it("falls back to the built-in FetchTransport when no packaged transport is installed", async () => {
    const transport = await resolveTransport("rest");
    expect(transport).toBeInstanceOf(FetchTransport);
  });

  it("caches the resolved transport per protocol", async () => {
    const first = await resolveTransport("rest");
    const second = await resolveTransport("rest");
    expect(second).toBe(first);
  });

  it("returns a fresh instance after resetCachedTransport", async () => {
    const first = await resolveTransport("rest");
    resetCachedTransport();
    const second = await resolveTransport("rest");
    expect(second).toBeInstanceOf(FetchTransport);
    expect(second).not.toBe(first);
  });

  it("throws for a protocol with no available transport", async () => {
    await expect(resolveTransport("grpc")).rejects.toThrow(/No transport available/);
  });

  it("defaults the protocol to http when omitted", async () => {
    const transport = await resolveTransport();
    expect(transport).toBeInstanceOf(FetchTransport);
    expect(transport.protocols).toContain("rest");
  });

  it("prioritizes the custom transport from config over auto-selection", async () => {
    const custom = new FetchTransport({ protocols: ["rest"] });
    const transport = await resolveTransport("rest", { customTransport: custom });
    expect(transport).toBe(custom);
  });

  it("uses the custom transport even when an auto transport is cached", async () => {
    await resolveTransport("rest");
    const custom = new FetchTransport({ protocols: ["rest"] });
    const transport = await resolveTransport("rest", { customTransport: custom });
    expect(transport).toBe(custom);
  });

  it("evicts a cached transport after its last core releases it", async () => {
    const firstCore = new HyperCore();
    await firstCore.getTransportName();
    const first = getCachedTransport("rest");
    expect(first).toBeDefined();

    await firstCore.destroy();
    expect(getCachedTransport("rest")).toBeUndefined();

    const secondCore = new HyperCore();
    await secondCore.getTransportName();
    expect(getCachedTransport("rest")).not.toBe(first);
    await secondCore.destroy();
  });

  it("keeps an automatically resolved transport alive for an extended core", async () => {
    const parent = new HyperCore();
    await parent.getTransportName();
    const shared = getCachedTransport("rest")!;
    const close = vi.spyOn(shared, "close");
    const child = parent.extend({}) as HyperCore;

    await parent.destroy();
    expect(close).not.toHaveBeenCalled();
    expect(getCachedTransport("rest")).toBe(shared);
    expect(await child.getTransportName()).toBe(shared.constructor.name);

    await child.destroy();
    expect(close).toHaveBeenCalledOnce();
    expect(getCachedTransport("rest")).toBeUndefined();
  });

  it("uses the transport cached for the dispatched protocol", async () => {
    const customTransport = await resolveTransport("custom", { protocols: ["custom"] });
    let usedTransport: HyperTransport | undefined;

    const sender: HyperSender<any, any, any, any> = {
      protocol: "custom",
      prepare: (request) => request.input,
      send: async (prepared, transport) => {
        usedTransport = transport;
        return prepared;
      },
      parse: (raw) => ({
        protocol: "custom",
        ok: true,
        status: 200,
        headers: {},
        url: raw.url,
        data: null,
      }),
    };
    const core = new HyperCore({ senders: [sender] });

    await core.send({
      protocol: "custom",
      input: { method: "GET", url: "/custom", headers: {}, protocol: "custom" },
    });

    expect(usedTransport).toBe(customTransport);
    await core.destroy();
  });
});

describe("FetchTransport", () => {
  it("defaults protocols to http when not specified", () => {
    const transport = new FetchTransport();
    expect(transport.protocols).toEqual(["rest"]);
  });

  it("uses the provided protocol list", () => {
    const transport = new FetchTransport({ protocols: ["rest", "grpc"] });
    expect(transport.protocols).toEqual(["rest", "grpc"]);
  });
  it("executes a request and normalizes the response", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const transport = new FetchTransport();
    const res = await transport.execute(makeRequest({ headers: { accept: "application/json" } }));

    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(res.body as Uint8Array)).toBe('{"ok":true}');
    expect(res.headers["content-type"]).toBe("application/json");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("suppresses the body for GET requests", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const transport = new FetchTransport();
    await transport.execute(makeRequest({ body: "should-not-be-sent" }));

    const [, init] = fetchMock.mock.calls[0]! as unknown as [unknown, RequestInit];
    expect(init.body).toBeNull();
  });

  it("appends duplicate header values", async () => {
    const fetchMock = vi.fn(async () => {
      const res = new Response(null, { status: 200 });
      res.headers.append("set-cookie", "a=1");
      res.headers.append("set-cookie", "b=2");
      return res;
    });
    vi.stubGlobal("fetch", fetchMock);

    const transport = new FetchTransport();
    const res = await transport.execute(makeRequest());

    expect(res.headers["set-cookie"]).toEqual(["a=1", "b=2"]);
  });

  it("returns the response body without buffering in stream mode", async () => {
    const response = new Response("streamed", { status: 200 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );

    const transport = new FetchTransport();
    const result = await transport.execute({ ...makeRequest(), stream: true } as TransportRequest);

    expect(result.body).toBe(response.body);
  });
});

describe("browser compatibility", () => {
  it("bundles the public entry without Node built-in polyfills", async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
      bundle: true,
      platform: "browser",
      format: "esm",
      write: false,
      logLevel: "silent",
    });

    expect(result.outputFiles.length).toBeGreaterThan(0);
  });
});
