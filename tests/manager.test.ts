import { describe, it, expect, afterEach } from "vitest";
import { KNOWN_PROTOCOLS, resetCachedProtocols, resolveSender } from "../src/protocols/manager.js";

describe("protocol manager", () => {
  afterEach(() => {
    resetCachedProtocols();
  });

  it("resolves the rest sender", async () => {
    const sender = await resolveSender("rest");

    expect(sender).toBeDefined();
    expect(sender.protocol).toBe("rest");
  });

  it("caches the resolved sender per protocol", async () => {
    const first = await resolveSender("rest");
    const second = await resolveSender("rest");

    expect(second).toBe(first);
  });

  it("throws for a packaged protocol sender that is not installed", async () => {
    await expect(resolveSender("grpc")).rejects.toThrow(
      /No protocol available for "grpc".*@hyperttp\/protocol-grpc/,
    );
  });

  it("does not resolve an unknown protocol", async () => {
    await expect(resolveSender("custom-unknown")).rejects.toThrow(
      /No protocol available for "custom-unknown"/,
    );
  });

  it("does not resolve the legacy 'http' protocol name", async () => {
    await expect(resolveSender("http")).rejects.toThrow(/No protocol available for "http"/);
  });

  it("exposes the known protocol list including rest", () => {
    expect(KNOWN_PROTOCOLS).toContain("rest");
    expect(KNOWN_PROTOCOLS).toContain("graphql");
    expect(KNOWN_PROTOCOLS).toContain("grpc");
  });
});
