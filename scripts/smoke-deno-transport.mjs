import { HyperCore } from "../dist/index.js";
import { RestProtocol } from "@hyperttp/protocol-rest";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function getAvailablePort() {
  const listener = Deno.listen({
    hostname: "127.0.0.1",
    port: 0,
  });

  const port = listener.addr.port;
  listener.close();

  return port;
}

const port = getAvailablePort();
const core = new HyperCore({
  protocols: [RestProtocol],
  verbose: true,
  logger: (_level, message) => {
    console.log(message);
  },
});

try {
  await core.listen({
    protocol: "rest",
    host: "127.0.0.1",
    port,

    handler: (request) => ({
      status: 200,
      headers: {
        "content-type": "application/json",
      },
      body: {
        ok: true,
        runtime: "deno",
        method: request.method,
        path: request.path,
      },
    }),
  });

  const response = await core.rest.get(`http://127.0.0.1:${port}/health`);

  check(response.status === 200, "Unexpected REST status");
  check(response.data?.ok === true, "REST response parsing failed");
  check(response.data?.runtime === "deno", "Wrong runtime response");
  check(response.data?.path === "/health", "Unexpected request path");

  console.log("Deno native transport: REST round trip OK");
} finally {
  await core.destroy();
}
