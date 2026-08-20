# @hyperttp/core

> Protocol-agnostic execution core for client and server communication.

**English** | [Русский](./lang/ru/README.md)

[![CI](https://github.com/IT-IF-OR/hyperttp-core/actions/workflows/ci.yml/badge.svg)](https://github.com/IT-IF-OR/hyperttp-core/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@hyperttp/core)](https://www.npmjs.com/package/@hyperttp/core)
[![npm downloads](https://img.shields.io/npm/dm/@hyperttp/core)](https://www.npmjs.com/package/@hyperttp/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@hyperttp/core)](https://bundlephobia.com/package/@hyperttp/core)
[![license](https://img.shields.io/npm/l/@hyperttp/core)](./LICENSE)
[![typescript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

## Positioning

`@hyperttp/core` is a small orchestration kernel, not another wrapper around `fetch` and not a
batteries-included HTTP framework. It connects three independent extension points:

- **Protocols** define communication semantics. A protocol can send through a `HyperSender`,
  receive through a `HyperReceiver`, or implement both roles as a `HyperProtocol`.
- **Transports** own physical I/O. The current transport contract executes outgoing requests and can
  additionally listen for incoming requests.
- **Plugins** add client request policy and cross-cutting behavior without expanding the core.

The core owns dispatch, lifecycle, plugin execution and resource coordination. REST is included as
the baseline protocol; additional protocols, optimized transports and higher-level behavior live in
separate packages.

```text
Application
    │
    ├── Plugins: retry, cache, auth, tracing, metrics, logging, policy
    │
 HyperCore
    │
    ├── Protocol: prepare → send → parse
    │              receive → handle → respond
    │
    └── Transport: execute (client) / listen (server)
                   Node.js / Bun / Deno / Browser / custom runtime
```

This boundary is intentional. New client-side retries, caches, authentication strategies,
observability tools and other request policies should be plugins. New wire semantics should be
protocol packages. New I/O implementations should be transport packages.

> Looking for a preconfigured HTTP client? Use
> [`hyperttp`](https://www.npmjs.com/package/hyperttp), which composes the core with application-level
> plugins and defaults.

## Core properties

- Client and server orchestration.
- Protocol-independent request envelope and universal response shape.
- Client lifecycle: `prepare → send → parse`.
- Server lifecycle: `receive → handle → respond`.
- Per-protocol transport resolution and coordinated transport ownership.
- Blocking and background client plugin hooks.
- Runtime-aware transport selection with a browser-safe fetch fallback.
- Strict TypeScript contracts and module augmentation for typed protocol namespaces.
- No bundled runtime dependencies.

## Installation

```bash
npm install @hyperttp/core @hyperttp/types
```

Compatible optimized transports can be installed separately. Ensure the selected transport release
declares compatibility with `@hyperttp/types@^0.3.0`; older transport releases target the v1 type
contracts and cannot be installed alongside core 2.0. Without an optional transport package, the
core uses its built-in `FetchTransport` fallback.

## Client quick start

```ts
import { HyperCore } from "@hyperttp/core";

const core = new HyperCore();

const response = await core.rest.get("https://example.com/users", {
  query: { page: 1 },
});

console.log(response.status);
console.log(response.data);

await core.destroy();
```

The same request can use the protocol-independent API:

```ts
const response = await core.send({
  protocol: "rest",
  input: {
    method: "GET",
    url: "https://example.com/users",
    query: { page: 1 },
  },
});
```

## Server quick start

A transport may also expose `listen()`. `HyperCore` connects it to the receiver side of the selected
protocol:

```ts
import { HyperCore } from "@hyperttp/core";

const core = new HyperCore();

const server = await core.listen({
  protocol: "rest",
  host: "127.0.0.1",
  port: 3000,
  handler(request) {
    return {
      status: 200,
      body: {
        method: request.method,
        path: request.path,
      },
    };
  },
});

// Closes active servers and releases every transport owned by this core.
await core.destroy();
```

Protocols can be client-only, server-only or expose both roles. The current transport contract always
provides client `execute()` and can additionally provide server `listen()`.

## Protocols

REST is the only protocol implemented inside the core. External protocol modules are loaded lazily:

| Protocol  | Package                        | Namespace                    |
| --------- | ------------------------------ | ---------------------------- |
| REST      | built in                       | `core.rest`                  |
| GraphQL   | `@hyperttp/protocol-graphql`   | `core.graphql`               |
| gRPC      | `@hyperttp/protocol-grpc`      | `core.grpc`                  |
| tRPC      | `@hyperttp/protocol-trpc`      | `core.trpc`                  |
| WebSocket | `@hyperttp/protocol-websocket` | `core.ws` / `core.websocket` |
| SSE       | `@hyperttp/protocol-sse`       | `core.sse`                   |
| MQTT      | `@hyperttp/protocol-mqtt`      | `core.mqtt`                  |

If an optional protocol package is missing, resolution fails with an installation hint instead of
silently selecting another protocol.

### Protocol roles

A unified protocol module can expose either or both roles:

```ts
const protocol = {
  protocol: "my-protocol",
  sender: mySender, // optional client role
  receiver: myReceiver, // optional server role
};

core.registerProtocol(protocol);
```

A sender translates protocol input into a transport request and parses the transport response. A
receiver translates an incoming transport request into protocol input and serializes the application
response.

Protocol packages can extend typed inputs and namespaces through `@hyperttp/types` module
augmentation:

```ts
declare module "@hyperttp/types" {
  interface ProtocolInputMap {
    "my-protocol": MyProtocolInput;
  }

  interface HyperProtocols {
    "my-protocol": MyProtocolMethods;
  }
}
```

## Transports

A transport describes its client capabilities and optional server capability:

```ts
interface HyperTransport {
  execute(request: TransportRequest): Promise<TransportResponse>;
  listen?(options: TransportListenOptions): Promise<TransportServer>;
  close?(): Promise<void> | void;
  destroy?(): Promise<void> | void;
}
```

- `execute()` is the required client role.
- `listen()` is the optional server role.
- `protocols` or `supports()` declares protocol capabilities.
- The core resolves and retains transports per protocol and closes a shared instance only after its
  last owner releases it.

Runtime selection:

| Runtime        | Preferred package            | Fallback                  |
| -------------- | ---------------------------- | ------------------------- |
| Node.js        | `@hyperttp/transport-undici` | built-in `FetchTransport` |
| Bun            | `@hyperttp/transport-bun`    | built-in `FetchTransport` |
| Deno           | `@hyperttp/transport-deno`   | built-in `FetchTransport` |
| Browser / edge | custom transport             | built-in `FetchTransport` |

A transport can also be supplied explicitly:

```ts
import { HyperCore } from "@hyperttp/core";
import { UndiciTransport } from "@hyperttp/transport-undici";

const core = new HyperCore({
  customTransport: new UndiciTransport(),
});
```

## Plugins

Plugins are the intended extension mechanism for client request behavior that does not belong to
protocol semantics or physical I/O. The current hooks run in the client `send()` lifecycle:

```ts
core.use({
  name: "request-logger",
  phase: "DATA",
  onRequest(request) {
    console.log("request", request.protocol);
  },
  onResponse(response) {
    console.log("response", response.status);
  },
  onError(error) {
    console.error(error);
  },
});
```

Hooks:

- `onRequest` can modify a request or return an early response.
- `onResponse` can inspect or replace a response.
- `onError` can recover by returning a response.
- `mode: "background"` detaches response-side work from the blocking path.
- `enabled(config)` controls registration.
- `setup(context)` initializes a plugin.

Examples of functionality that belongs in plugins:

- retries and circuit breakers;
- caching and request deduplication;
- authentication and request signing;
- tracing, metrics and structured logging;
- rate limiting, concurrency control and scheduling;
- schema validation and application-specific policies.

## Built-in REST protocol

The REST package exposes client and server roles through `RestProtocol`.

```ts
const getResponse = await core.rest.get("/users", {
  query: { page: 1, tag: ["a", "b"] },
  headers: { accept: "application/json" },
  timeout: 5_000,
});

const postResponse = await core.rest.post("/users", {
  name: "Ada",
});

const streamResponse = await core.rest.stream("/events");
```

REST behavior includes:

- query serialization with repeated array parameters;
- header normalization;
- JSON serialization for plain object and array request bodies;
- JSON, text and binary response handling;
- timeout and user abort propagation;
- unbuffered stream mode;
- request decoding and response serialization for the server role.

REST-specific public types are available from `@hyperttp/core/rest`.

## Lifecycle

```ts
const child = core.extend({ verbose: true }); // shares resolved transport leases
const isolated = core.create({}); // independent transport lifecycle

await child.destroy();
await isolated.destroy();
await core.destroy();
```

- `extend()` creates a related core and shares existing transport ownership.
- `create()` creates an independent core and does not inherit `customTransport` by default.
- `destroy()` is idempotent, closes tracked servers and releases transports.
- `destroy(false)` requests forced shutdown where the transport supports it.

## Error handling

```ts
import { HyperClientError, TimeoutError } from "@hyperttp/core";

try {
  await core.rest.get("/slow", { timeout: 1_000 });
} catch (error) {
  if (TimeoutError.isTimeoutError(error)) {
    console.error("Request timed out");
  } else if (HyperClientError.isHyperClientError(error)) {
    console.error(error.code, error.message);
  }
}
```

## Scope

The stable core is intentionally limited to:

1. protocol registration and dispatch;
2. transport resolution, sharing and shutdown;
3. client and server lifecycle orchestration;
4. plugin execution;
5. the baseline REST protocol and universal error contracts.

Feature growth should happen through plugins, protocol packages and transport packages. Keeping this
boundary small makes runtime behavior predictable and allows the core API to stabilize independently
from the ecosystem around it.

## Runtime support

- Node.js 20 and newer;
- current stable Bun;
- current stable Deno;
- modern browsers and edge runtimes with Fetch and Web Streams.

## Development

```bash
npm install
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

The required order is `lint → typecheck → test → build`. CI also verifies browser bundling, runtime
smoke tests and installation of the generated npm tarball.

## License

MIT
