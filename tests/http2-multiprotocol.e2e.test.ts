import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { GrpcProtocol } from "@hyperttp/protocol-grpc";
import type { GrpcServerRequest, GrpcServerResponse } from "@hyperttp/protocol-grpc";
import { RestProtocol } from "@hyperttp/protocol-rest";
import type { RestServerInput, RestServerResponse } from "@hyperttp/protocol-rest";
import type { HyperProtocolName, ServerRequestContext } from "@hyperttp/types";
import { Http2Transport } from "@hyperttp/transport-node";
import { HyperCore } from "../src/index.js";
import { getCachedTransport, resetCachedTransport } from "../src/transports/manager.js";

interface RestEchoResponse {
  protocol: "rest";
  method: string;
  path: string;
  query: Readonly<Record<string, string | string[]>>;
  body: unknown;
}

/** Reserve an ephemeral loopback port, then release it for the HTTP/2 listener. */
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

describe("HyperCore HTTP/2 multi-protocol E2E", () => {
  it("routes real REST and unary gRPC calls through one automatically resolved HTTP/2 listener", async () => {
    const port = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const serverLogs: string[] = [];
    const handledProtocols: HyperProtocolName[] = [];
    let restRequest: RestServerInput | undefined;
    let grpcRequest: GrpcServerRequest | undefined;

    // The server has no custom transport. HyperCore must resolve a single
    // transport that supports both REST and gRPC and also exposes listen().
    const serverCore = new HyperCore({
      protocols: [RestProtocol, GrpcProtocol],
      logger: (_level, message) => serverLogs.push(message),
      verbose: true,
    });

    // h2c is intentional here: using Http2Transport directly on the client
    // guarantees that both requests use the Node HTTP/2 wire protocol without
    // introducing TLS fixtures or an HTTP/1.1 fallback into this test.
    const clientTransport = new Http2Transport();
    const clientCore = new HyperCore({ protocols: [RestProtocol, GrpcProtocol] }, clientTransport);

    try {
      await serverCore.listen({
        protocols: ["rest", "grpc"],
        host: "127.0.0.1",
        port,
        handler: (
          request: unknown,
          context: ServerRequestContext,
        ): RestServerResponse | GrpcServerResponse => {
          const protocol = context.protocol;

          if (protocol === "grpc") {
            const input = request as GrpcServerRequest;
            handledProtocols.push(protocol);
            grpcRequest = input;

            return {
              body: input.message,
              headers: { "x-e2e-protocol": "grpc" },
            };
          }

          if (protocol === "rest") {
            const input = request as RestServerInput;
            handledProtocols.push(protocol);
            restRequest = input;

            return {
              status: 201,
              headers: { "x-e2e-protocol": "rest" },
              body: {
                protocol: "rest",
                method: input.method,
                path: input.path,
                query: input.query,
                body: input.body,
              } satisfies RestEchoResponse,
            };
          }

          throw new Error(`Unexpected protocol route: ${String(protocol)}`);
        },
      });

      const listenerTransport = getCachedTransport(["rest", "grpc"], {
        cacheKey: serverCore.config,
        requireListen: true,
      });
      expect(listenerTransport).toBeInstanceOf(Http2Transport);
      expect(await clientCore.getTransportName()).toBe("Http2Transport");

      const restPayload = {
        event: "rest-over-http2",
        sequence: 17,
      };
      const grpcPayload = new Uint8Array([0x00, 0x7f, 0x80, 0xfe, 0xff, 0x2a]);

      // Run both protocol exchanges concurrently. The client transport reuses
      // its HTTP/2 session for the same origin, while the server routes by
      // content-type/protocol over the one listener created above.
      const [restResponse, grpcResponse] = await Promise.all([
        clientCore.rest.post<RestEchoResponse>(`${baseUrl}/events`, restPayload, {
          query: {
            source: "vitest",
            tag: ["alpha", "beta"],
          },
          headers: { "x-e2e-client": "rest" },
        }),
        clientCore.grpc.call<Uint8Array, number[]>(
          {
            service: "example.Echo",
            method: "Unary",
            message: grpcPayload,
            baseUrl,
            encode: (message) => message,
            decode: (message) => Array.from(message),
          },
          {
            metadata: { headers: { "x-e2e-client": "grpc" } },
          },
        ),
      ]);

      expect(restResponse).toMatchObject({
        protocol: "rest",
        ok: true,
        status: 201,
        headers: { "x-e2e-protocol": "rest" },
        data: {
          protocol: "rest",
          method: "POST",
          path: "/events",
          query: {
            source: "vitest",
            tag: ["alpha", "beta"],
          },
          body: restPayload,
        },
      });

      expect(grpcResponse).toMatchObject({
        protocol: "grpc",
        ok: true,
        status: 200,
        data: {
          ok: true,
          grpcStatus: 0,
          data: Array.from(grpcPayload),
          trailers: { "grpc-status": "0" },
        },
      });
      expect(grpcResponse.data.trailers["grpc-status"]).toBe("0");

      expect(restRequest).toMatchObject({
        method: "POST",
        path: "/events",
        query: {
          source: "vitest",
          tag: ["alpha", "beta"],
        },
        headers: expect.objectContaining({ "x-e2e-client": "rest" }),
        body: restPayload,
      });
      expect(grpcRequest).toMatchObject({
        service: "example.Echo",
        method: "Unary",
        message: grpcPayload,
        compressed: false,
        headers: expect.objectContaining({ "x-e2e-client": "grpc" }),
      });
      expect([...grpcRequest!.message]).toEqual([...grpcPayload]);
      expect(new Set(handledProtocols)).toEqual(new Set(["rest", "grpc"]));

      // This debug line comes from transports/manager.ts and confirms that
      // the listener transport was selected automatically, not injected.
      expect(
        serverLogs.some(
          (message) => message.includes("Selected transport") && message.includes("Http2Transport"),
        ),
      ).toBe(true);
    } finally {
      await Promise.all([clientCore.destroy(), serverCore.destroy()]);
    }

    expect(
      getCachedTransport(["rest", "grpc"], {
        cacheKey: serverCore.config,
        requireListen: true,
      }),
    ).toBeUndefined();
  }, 15_000);
});
