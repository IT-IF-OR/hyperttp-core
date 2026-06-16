import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { TransportManager, CURRENT_RUNTIME } from "../src/transports/manager.js";
import { NodeTransport } from "../src/transports/node.js";

const BASE = "http://127.0.0.1:3000";
const MINIMAL_CONFIG = { baseURL: BASE };
let nodeTransport: NodeTransport;

beforeAll(() => {
  nodeTransport = new NodeTransport({ baseUrl: BASE } as any);
});

afterAll(async () => {
  await nodeTransport.destroy();
});

describe("TransportManager", () => {
  it("detects current runtime", () => {
    expect(["node", "bun", "deno", "browser"]).toContain(CURRENT_RUNTIME);
  });

  it("getSync returns null before init", () => {
    const mgr = new TransportManager(MINIMAL_CONFIG);
    expect(mgr.getSync()).toBeNull();
  });

  it("uses custom transport if provided", () => {
    const fake = { execute: async () => ({ status: 200, headers: {}, body: null, url: "" }) } as any;
    const mgr = new TransportManager(MINIMAL_CONFIG, fake);
    expect(mgr.getSync()).toBe(fake);
  });

  it("ensure() resolves to a transport", async () => {
    const mgr = new TransportManager(MINIMAL_CONFIG, nodeTransport);
    const transport = await mgr.ensure();
    expect(transport).toBeDefined();
    expect(typeof transport.execute).toBe("function");
  });

  it("ensure() is idempotent - returns same promise", async () => {
    const mgr = new TransportManager(MINIMAL_CONFIG, nodeTransport);
    const p1 = mgr.ensure();
    const p2 = mgr.ensure();
    expect(p1).toBe(p2);
    const t = await p1;
    expect(t).toBeDefined();
  });

  it("get() returns sync transport or promise", () => {
    const mgr = new TransportManager(MINIMAL_CONFIG, nodeTransport);
    const result = mgr.get();
    // Should return the sync transport since one is already set
    expect(result).toBe(nodeTransport);
  });

  it("destroy() clears transport", async () => {
    const mgr = new TransportManager(MINIMAL_CONFIG, nodeTransport);
    expect(mgr.getSync()).not.toBeNull();
    await mgr.destroy();
    expect(mgr.getSync()).toBeNull();
  });

  it("allows setting config", () => {
    const mgr = new TransportManager(MINIMAL_CONFIG);
    const config = { verbose: true };
    mgr.setConfig(config as any);
    expect((mgr as any).config).toBe(config);
  });
});
