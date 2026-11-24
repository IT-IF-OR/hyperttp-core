import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

it("uses the browser-safe transport-node fetch subpath for REST", async () => {
  vi.stubGlobal("process", undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("fallback", { status: 200 })),
  );

  const manager = await import("../src/transports/manager.js");
  expect(manager.CURRENT_RUNTIME).toBe("browser");

  const transport = await manager.resolveTransport("rest");
  const response = await transport.execute({
    method: "GET",
    url: "https://example.com/",
    headers: {},
    protocol: "rest",
  });

  expect(transport.constructor.name).toBe("FetchTransport");
  expect(response.status).toBe(200);
  expect(fetch).toHaveBeenCalledWith(
    "https://example.com/",
    expect.objectContaining({ method: "GET" }),
  );

  manager.resetCachedTransport();
});
