import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { RestProtocol } from "@hyperttp/protocol-rest";
import { HyperCore } from "../src/index.js";
import { CURRENT_RUNTIME, resetCachedTransport } from "../src/transports/manager.js";

interface EchoResponse {
  accepted: boolean;
  method: string;
  path: string;
  query: Readonly<Record<string, string | string[]>>;
  body: unknown;
}

/** Reserve an ephemeral loopback port, then release it for the real listener. */
async function getAvailablePort(): Promise<number> {
  const probe = createServer();

  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });

  const address = probe.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    throw new Error("Could not determine the reserved loopback port.");
  }

  const { port } = address as AddressInfo;
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });

  return port;
}

afterEach(() => {
  resetCachedTransport();
});

describe.runIf(CURRENT_RUNTIME === "node")("HyperCore transport manager E2E", () => {
  it("resolves client and listener transports automatically and completes a real REST round trip", async () => {
    const port = await getAvailablePort();
    const origin = `http://127.0.0.1:${port}`;
    const clientLogs: string[] = [];
    const serverLogs: string[] = [];
    const receivedRequests: Array<{
      method: string;
      path: string;
      query: Readonly<Record<string, string | string[]>>;
      headers: Readonly<Record<string, string | string[]>>;
      body: unknown;
      requestId: string;
    }> = [];

    // No customTransport is supplied: both roles must go through the real
    // transport registry, package imports, capability checks and cache.
    const serverCore = new HyperCore({
      protocols: [RestProtocol],
      logger: (_level, message) => {
        serverLogs.push(message);
      },
      verbose: true,
    });
    const clientCore = new HyperCore({
      protocols: [RestProtocol],
      logger: (_level, message) => {
        clientLogs.push(message);
      },
      verbose: true,
    });

    try {
      await serverCore.listen({
        protocol: "rest",
        host: "127.0.0.1",
        port,
        handler: (request, context) => {
          receivedRequests.push({
            method: request.method,
            path: request.path,
            query: request.query,
            headers: request.headers,
            body: request.body,
            requestId: context.requestId,
          });

          return {
            status: 201,
            headers: { "x-e2e-server": "hypercore" },
            body: {
              accepted: true,
              method: request.method,
              path: request.path,
              query: request.query,
              body: request.body,
            } satisfies EchoResponse,
          };
        },
      });

      const payload = {
        event: "transport-manager-e2e",
        sequence: 42,
      };

      const response = await clientCore.rest.post<EchoResponse>(`${origin}/events`, payload, {
        query: {
          source: "vitest",
          tag: ["alpha", "beta"],
        },
        headers: {
          "x-e2e-client": "hypercore",
        },
      });

      expect(response.status).toBe(201);
      expect(response.ok).toBe(true);
      expect(response.headers["x-e2e-server"]).toBe("hypercore");
      expect(response.data).toEqual({
        accepted: true,
        method: "POST",
        path: "/events",
        query: {
          source: "vitest",
          tag: ["alpha", "beta"],
        },
        body: payload,
      });

      expect(receivedRequests).toHaveLength(1);
      expect(receivedRequests[0]).toMatchObject({
        method: "POST",
        path: "/events",
        query: {
          source: "vitest",
          tag: ["alpha", "beta"],
        },
        headers: expect.objectContaining({ "x-e2e-client": "hypercore" }),
        body: payload,
      });
      expect(receivedRequests[0]?.requestId).toEqual(expect.any(String));

      // The debug selection message is emitted by transports/manager.ts;
      // seeing it for both cores confirms that this was not a custom transport.
      expect(clientLogs.some((message) => message.includes("Selected transport"))).toBe(true);
      expect(
        serverLogs.some(
          (message) => message.includes("Selected transport") && message.includes("FetchTransport"),
        ),
      ).toBe(true);
    } finally {
      await Promise.all([clientCore.destroy(), serverCore.destroy()]);
    }
  }, 15_000);
});
