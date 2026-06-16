import { describe, it, expect } from "vitest";
import { calcDelay, shouldRetry, drainBody } from "../src/utils/retryUtils.js";

describe("calcDelay", () => {
  it("returns baseDelay for attempt 0", () => {
    const d = calcDelay(0, { baseDelay: 1000, maxDelay: 10000, jitter: false });
    expect(d).toBe(1000);
  });

  it("doubles each attempt (no jitter)", () => {
    const d1 = calcDelay(1, { baseDelay: 100, maxDelay: 10000, jitter: false });
    expect(d1).toBe(200);
    const d2 = calcDelay(2, { baseDelay: 100, maxDelay: 10000, jitter: false });
    expect(d2).toBe(400);
  });

  it("clamps to maxDelay", () => {
    const d = calcDelay(10, { baseDelay: 100, maxDelay: 500, jitter: false });
    expect(d).toBe(500);
  });

  it("applies jitter between 0.75x and 1.25x", () => {
    for (let i = 0; i < 50; i++) {
      const d = calcDelay(0, { baseDelay: 1000, maxDelay: 10000, jitter: true });
      expect(d).toBeGreaterThanOrEqual(750);
      expect(d).toBeLessThanOrEqual(1250);
    }
  });

  it("clamps jittered value to maxDelay", () => {
    const d = calcDelay(10, { baseDelay: 1000, maxDelay: 1000, jitter: true });
    expect(d).toBeLessThanOrEqual(1000);
  });

  it("uses defaults when options are missing", () => {
    const d = calcDelay(0, {});
    expect(d).toBeGreaterThanOrEqual(750);
    expect(d).toBeLessThanOrEqual(1250);
  });

  it("caps exponent to 31 to avoid overflow", () => {
    const d = calcDelay(50, { baseDelay: 2, maxDelay: 1e12, jitter: false });
    expect(d).toBeLessThan(Infinity);
  });
});

describe("shouldRetry", () => {
  it("retries default codes (502, 503, 504)", () => {
    const opts = { maxRetries: 3 };
    expect(shouldRetry(502, opts)).toBe(true);
    expect(shouldRetry(503, opts)).toBe(true);
    expect(shouldRetry(504, opts)).toBe(true);
  });

  it("does not retry 200 by default", () => {
    expect(shouldRetry(200, {})).toBe(false);
  });

  it("respects custom retryStatusCodes", () => {
    const opts = { maxRetries: 3, retryStatusCodes: [429] as readonly number[] };
    expect(shouldRetry(429, opts)).toBe(true);
    expect(shouldRetry(502, opts)).toBe(false);
  });

  it("returns false when codes list is empty", () => {
    const opts = { maxRetries: 3, retryStatusCodes: [] as readonly number[] };
    expect(shouldRetry(503, opts)).toBe(false);
  });
});

describe("drainBody", () => {
  it("handles null/undefined", async () => {
    await expect(drainBody(null)).resolves.toBeUndefined();
    await expect(drainBody(undefined)).resolves.toBeUndefined();
  });

  it("calls dump() if available", async () => {
    let called = false;
    const body = {
      dump: async () => { called = true; },
    };
    await drainBody(body);
    expect(called).toBe(true);
  });

  it("calls destroy() if available", async () => {
    let called = false;
    const body = {
      destroy: () => { called = true; },
    };
    await drainBody(body);
    expect(called).toBe(true);
  });

  it("prefers dump() over destroy()", async () => {
    let dumpCalled = false;
    let destroyCalled = false;
    const body = {
      dump: async () => { dumpCalled = true; },
      destroy: () => { destroyCalled = true; },
    };
    await drainBody(body);
    expect(dumpCalled).toBe(true);
    expect(destroyCalled).toBe(false);
  });

  it("handles errors silently", async () => {
    const body = {
      dump: async () => { throw new Error("fail"); },
    };
    await expect(drainBody(body)).resolves.toBeUndefined();
  });
});
