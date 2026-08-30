import { describe, it, expect, vi } from "vitest";
import { HyperCore, HyperClientError, RestSender, TimeoutError } from "../src/index.js";
import type {
  HyperProtocol,
  HyperSender,
  HyperTransport,
  RequestContext,
  TransportServer,
  UniversalResponse,
} from "@hyperttp/types";

class CustomRestSender implements HyperSender<any, any, any, any> {
  readonly protocol = "rest";
  readonly methods = {
    get: (
      core: { send: (req: unknown) => Promise<unknown> },
      url: string,
      options?: Record<string, unknown>,
    ) => core.send({ protocol: "rest", input: { method: "GET", url, ...options } }),
  };
  prepare(request: any) {
    return request.input;
  }
  async send(prepared: any) {
    return prepared;
  }
  parse(raw: any) {
    return {
      protocol: "rest",
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {},
      url: raw.url,
      data: { via: "custom", url: raw.url },
      raw,
    };
  }
}

function makeMockTransport(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    async execute(req: { url: string; method: string }) {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        url: req.url,
        body: new TextEncoder().encode(JSON.stringify({ ok: true, url: req.url })),
        ...overrides,
      };
    },
    close: vi.fn(async () => {}),
  };
}

function makeCore(transport: HyperTransport = makeMockTransport()) {
  const core = new HyperCore({}, transport);
  core.registerSender(new RestSender());
  return core;
}

describe("HyperCore (universal core)", () => {
  it("dispatches via core.send through the registered sender", async () => {
    const core = makeCore();
    const res = await core.send<{ method: string; url: string }, { ok: boolean }>({
      protocol: "rest",
      input: { method: "GET", url: "/users" },
    });

    expect(res.protocol).toBe("rest");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.url).toBe("/users");
    expect(res.data).toEqual({ ok: true, url: "/users" });
  });

  it("lazily resolves and registers the sender via the manager", async () => {
    const core = new HyperCore({}, makeMockTransport());
    const res = await core.send({
      protocol: "rest",
      input: { method: "GET", url: "/lazy" },
    });

    expect(res.url).toBe("/lazy");
    expect(core.getSender("rest")).toBeDefined();
  });

  it("uses config.customTransport over auto-selected transports", async () => {
    const custom = makeMockTransport({ status: 201 });
    const core = new HyperCore({ customTransport: custom });
    core.registerSender(new RestSender());

    const res = await core.send({
      protocol: "rest",
      input: { method: "GET", url: "/custom" },
    });

    expect(res.status).toBe(201);
    expect(res.url).toBe("/custom");
  });

  it("uses config.customSender instead of the default sender for its protocol", async () => {
    const custom = new CustomRestSender();
    const core = new HyperCore({ customSender: custom }, makeMockTransport());

    expect(core.getSender("rest")).toBe(custom);

    const res = await core.rest.get("/custom-sender");
    expect(res.data).toEqual({ via: "custom", url: "/custom-sender" });
  });

  it("exposes the core.rest namespace with bound methods", async () => {
    const core = makeCore();
    const res = await core.rest.get("/users", { query: { page: 1 } });

    expect(res.status).toBe(200);
    expect(res.url).toBe("/users?page=1");

    const flat = (core as unknown as { get(url: string): Promise<UniversalResponse> }).get;
    const flatRes = await flat("/flat");
    expect(flatRes.url).toBe("/flat");
  });

  it("lazily resolves the sender when the rest namespace is used without registration", async () => {
    const core = new HyperCore({}, makeMockTransport());
    const res = await core.rest.get("/lazy-rest");

    expect(res.status).toBe(200);
    expect(res.url).toBe("/lazy-rest");
    expect(core.getSender("rest")).toBeDefined();
  });

  it("reports the current transport name", async () => {
    const core = makeCore();
    const name = await core.getTransportName();
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });

  it("reports the sender name for the rest protocol", async () => {
    const core = new HyperCore({}, makeMockTransport());
    const name = await core.getSenderName("rest");
    expect(name).toBe("RestSender");
  });

  it("reports the receiver name for the rest protocol", async () => {
    const core = new HyperCore({}, makeMockTransport());
    const name = await core.getReceiverName("rest");
    expect(name).toBe("RestReceiver");
  });

  it("reports the protocol module name for the rest protocol", async () => {
    const core = new HyperCore({}, makeMockTransport());
    const name = await core.getProtocolName("rest");
    expect(name).toBe("RestProtocol");
  });

  it("throws when asking for a receiver name of a client-only protocol", async () => {
    const core = new HyperCore({}, makeMockTransport());
    const sender: HyperSender<unknown, unknown, unknown, unknown, "ws"> = {
      protocol: "ws",
      prepare: (request) => request.input,
      send: async (prepared) => prepared,
      parse: (raw) => ({
        protocol: "ws",
        ok: true,
        status: 0,
        headers: {},
        data: raw,
      }),
    };
    const clientOnly: HyperProtocol<unknown, unknown, unknown, unknown, "ws"> = {
      protocol: "ws",
      sender,
    };
    core.registerProtocol(clientOnly);
    await expect(core.getReceiverName("ws")).rejects.toThrow(/has no receiver/);
  });

  it("ignores inherited enumerable protocol methods", () => {
    const inherited = vi.fn();
    const methods = Object.create({ inherited });
    methods.own = vi.fn();
    const core = makeCore();

    core.registerProtocol({
      protocol: "custom",
      sender: {
        protocol: "custom",
        methods,
        prepare: (request) => request.input,
        send: async (prepared) => prepared,
        parse: (raw) => ({ protocol: "custom", ok: true, status: 200, headers: {}, data: raw }),
      },
    });

    expect((core as unknown as Record<string, unknown>).own).toBeTypeOf("function");
    expect((core as unknown as Record<string, unknown>).inherited).toBeUndefined();
  });

  it("exposes lazy namespaces for other known protocols", async () => {
    const core = new HyperCore({}, makeMockTransport());
    const graphql = (core as unknown as Record<string, unknown>).graphql as {
      get(...args: unknown[]): Promise<unknown>;
    };

    await expect(graphql.get("/q")).rejects.toThrow(/No protocol available/);
    expect(core.getSender("graphql")).toBeUndefined();
  });

  it("runs onRequest / onResponse plugin hooks", async () => {
    const core = makeCore();
    const calls: string[] = [];
    core.use({
      name: "spy",
      onRequest: () => {
        calls.push("onRequest");
      },
      onResponse: () => {
        calls.push("onResponse");
      },
    });

    await core.send({ protocol: "rest", input: { method: "GET", url: "/users" } });
    expect(calls).toEqual(["onRequest", "onResponse"]);
  });

  it("applies plugins registered during a request only to later requests", async () => {
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const late = vi.fn();
    const core = makeCore();
    core.use({
      name: "pause",
      onRequest: async () => paused,
    });

    const first = core.send({ protocol: "rest", input: { method: "GET", url: "/first" } });
    await Promise.resolve();
    core.use({ name: "late", onRequest: late });
    resume();
    await first;

    expect(late).not.toHaveBeenCalled();

    await core.send({ protocol: "rest", input: { method: "GET", url: "/second" } });
    expect(late).toHaveBeenCalledOnce();
  });

  it("short-circuits the request when onRequest returns a response", async () => {
    const transport = makeMockTransport();
    const spy = vi.spyOn(transport, "execute");

    const core = new HyperCore({}, transport);
    core.registerSender(new RestSender());
    core.use({
      name: "blocker",
      onRequest: () =>
        ({
          protocol: "rest",
          ok: false,
          status: 418,
          headers: {},
          url: "",
          data: null,
        }) as UniversalResponse,
    });

    const res = await core.send({ protocol: "rest", input: { method: "GET", url: "/blocked" } });
    expect(res.status).toBe(418);
    expect(spy).not.toHaveBeenCalled();
  });

  it("recovers errors via onError plugin", async () => {
    const transport = {
      async execute() {
        throw new HyperClientError("boom");
      },
    };
    const core = new HyperCore({}, transport);
    core.registerSender(new RestSender());
    core.use({
      name: "recover",
      onError: () =>
        ({
          protocol: "rest",
          ok: false,
          status: 503,
          headers: {},
          url: "",
          data: null,
        }) as UniversalResponse,
    });

    const res = await core.send({ protocol: "rest", input: { method: "GET", url: "/fail" } });
    expect(res.status).toBe(503);
  });

  it("selects the sender for the protocol returned by onRequest", async () => {
    const core = makeCore();
    const customSend = vi.fn(async (prepared: { url: string }) => prepared);
    const customSender: HyperSender<any, any, any, any> = {
      protocol: "custom",
      prepare: (request) => request.input,
      send: customSend,
      parse: (raw) => ({
        protocol: "custom",
        ok: true,
        status: 200,
        headers: {},
        url: raw.url,
        data: "custom",
      }),
    };
    core.registerSender(customSender);
    core.use({
      name: "switch-protocol",
      onRequest: () => ({
        protocol: "custom",
        input: { method: "GET", url: "/mutated" },
      }),
    });

    const response = await core.send({
      protocol: "rest",
      input: { method: "GET", url: "/original" },
    });

    expect(customSend).toHaveBeenCalledOnce();
    expect(response.protocol).toBe("custom");
    expect(response.url).toBe("/mutated");
  });

  it("routes onRequest failures through onError", async () => {
    const failure = new Error("request plugin failed");
    const recover = vi.fn(
      () =>
        ({
          protocol: "rest",
          ok: false,
          status: 503,
          headers: {},
          data: null,
        }) as UniversalResponse,
    );
    const core = makeCore();
    core.use({
      name: "throw-request",
      onRequest: () => {
        throw failure;
      },
    });
    core.use({ name: "recover-request", onError: recover });

    const response = await core.send({
      protocol: "rest",
      input: { method: "GET", url: "/plugin-error" },
    });

    expect(recover).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ protocol: "rest" }),
      expect.anything(),
      expect.anything(),
    );
    expect(response.status).toBe(503);
  });

  it("runs response hooks for an onRequest short-circuit response", async () => {
    const onResponse = vi.fn();
    const core = makeCore();
    core.use({
      name: "short-circuit",
      onRequest: () => ({
        protocol: "rest",
        ok: true,
        status: 204,
        headers: {},
        data: null,
      }),
    });
    core.use({ name: "observe-response", onResponse });

    await core.send({ protocol: "rest", input: { method: "GET", url: "/short" } });
    expect(onResponse).toHaveBeenCalledOnce();
  });

  it("getSender, extend and create clone the core", async () => {
    const core = makeCore();
    expect(core.getSender("rest")).toBeDefined();

    const extended = core.extend({ verbose: true });
    expect(extended).toBeInstanceOf(HyperCore);
    expect(extended.config.verbose).toBe(true);

    const created = core.create({});
    expect(created).toBeInstanceOf(HyperCore);
  });

  it("destroy closes the transport", async () => {
    const transport = makeMockTransport();
    const core = makeCore(transport);
    await core.destroy();
    expect(transport.close).toHaveBeenCalled();
  });

  it("keeps a shared transport open until every extended core is destroyed", async () => {
    const transport = makeMockTransport();
    const parent = new HyperCore({}, transport);
    parent.registerSender(new RestSender());
    const child = parent.extend({ verbose: true });
    expect(child.config.verbose).toBe(true);

    await parent.destroy();
    expect(transport.close).not.toHaveBeenCalled();

    await child.destroy();
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it("create() initializes an independent core without holding the parent transport", async () => {
    const transport = makeMockTransport();
    const core = new HyperCore({}, transport);
    core.registerSender(new RestSender());

    const created = core.create({});
    expect(created).toBeInstanceOf(HyperCore);
    expect(
      (created as unknown as { config: { customTransport?: unknown } }).config.customTransport,
    ).toBeUndefined();

    await created.destroy();
    expect(transport.close).not.toHaveBeenCalled();

    await core.destroy();
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it("create() does not inherit customTransport from the parent config", () => {
    const custom = makeMockTransport();
    const core = new HyperCore({ customTransport: custom });

    const created = core.create({});
    expect(
      (created as unknown as { config: { customTransport?: unknown } }).config.customTransport,
    ).toBeUndefined();

    const explicit = makeMockTransport();
    const overridden = core.create({ customTransport: explicit });
    expect(
      (overridden as unknown as { config: { customTransport?: unknown } }).config.customTransport,
    ).toBe(explicit);
  });

  it("generates unique request ids across many requests", async () => {
    const ids = new Set<string>();
    class IdSender implements HyperSender<any, any, any, any> {
      readonly protocol = "rest";
      prepare(request: any, ctx: RequestContext) {
        ids.add(ctx.requestId);
        return request.input;
      }
      async send(prepared: any) {
        return prepared;
      }
      parse(raw: any) {
        return {
          protocol: "rest",
          ok: true,
          status: 200,
          headers: {},
          data: raw,
        };
      }
    }

    const core = new HyperCore({}, makeMockTransport());
    core.registerSender(new IdSender());

    for (let i = 0; i < 1000; i++) {
      await core.send({ protocol: "rest", input: { method: "GET", url: `/r/${i}` } });
    }

    expect(ids.size).toBe(1000);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
    }
  });

  it("retries transport resolution after a transient capability failure", async () => {
    let supported = false;
    const transport: HyperTransport = {
      ...makeMockTransport(),
      supports: () => supported,
    };
    const core = new HyperCore({ customTransport: transport });
    core.registerSender({
      protocol: "custom",
      prepare: (request) => request.input,
      send: async (prepared) => prepared,
      parse: (raw) => ({ protocol: "custom", ok: true, status: 200, headers: {}, data: raw }),
    });

    await expect(core.send({ protocol: "custom", input: { url: "/retry" } })).rejects.toThrow(
      /does not support protocol/,
    );

    supported = true;
    await expect(
      core.send({ protocol: "custom", input: { url: "/retry" } }),
    ).resolves.toMatchObject({
      protocol: "custom",
      status: 200,
    });
    await core.destroy();
  });

  it("retains a lazily resolved transport exactly once under concurrent startup", async () => {
    const transport = makeMockTransport();
    const core = new HyperCore({ customTransport: transport });
    core.registerSender(new RestSender());

    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        core.send({ protocol: "rest", input: { method: "GET", url: `/r/${i}` } }),
      ),
    );
    expect(results).toHaveLength(100);

    await core.destroy();
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it("retains the transport when listen() resolves it lazily", async () => {
    const serverHandle = { close: vi.fn(async () => {}) };
    const transport = {
      ...makeMockTransport(),
      listen: vi.fn(async () => serverHandle),
    };
    const core = new HyperCore({ customTransport: transport });

    const server = await core.listen({ protocol: "rest" });
    expect(server).toBe(serverHandle);

    await core.destroy();
    expect(serverHandle.close).toHaveBeenCalledTimes(1);
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it("closes a server that resolves after destroy starts", async () => {
    let resolveListen!: (server: TransportServer) => void;
    const server = { close: vi.fn(async () => {}) };
    const transport = {
      ...makeMockTransport(),
      listen: vi.fn(
        () =>
          new Promise<TransportServer>((resolve) => {
            resolveListen = resolve;
          }),
      ),
    };
    const core = new HyperCore({ customTransport: transport });
    const listening = core.listen({ protocol: "rest" });

    await vi.waitFor(() => expect(transport.listen).toHaveBeenCalledOnce());
    const destroying = core.destroy();
    resolveListen(server);

    await Promise.allSettled([listening, destroying]);
    expect(server.close).toHaveBeenCalledOnce();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it("rejects REST timeouts with TimeoutError", async () => {
    vi.useFakeTimers();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const transport: HyperTransport = {
      execute(request) {
        markStarted();
        return new Promise((_resolve, reject) => {
          const rejectAbort = () => reject(request.signal?.reason);
          if (request.signal?.aborted) rejectAbort();
          else request.signal?.addEventListener("abort", rejectAbort, { once: true });
        });
      },
      close: vi.fn(async () => {}),
    };
    const core = new HyperCore({}, transport);
    core.registerSender(new RestSender());

    try {
      const failure = core.rest.get("/slow", { timeout: 10 }).then(
        () => undefined,
        (error: unknown) => error,
      );
      await started;
      await vi.advanceTimersByTimeAsync(10);
      const error = await failure;

      expect(error).toBeInstanceOf(TimeoutError);
      expect(TimeoutError.isTimeoutError(error)).toBe(true);
      expect(error).toMatchObject({ code: "TIMEOUT", statusCode: 408, url: "/slow" });
    } finally {
      await core.destroy();
      vi.useRealTimers();
    }
  });
});
