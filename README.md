# @hyperttp/core ⚡

> High-performance HTTP engine for Node.js and Bun.

**English** | [Русский](https://github.com/IT-IF-OR/hyperttp-core/tree/main/lang/ru)

[![npm version](https://img.shields.io/npm/v/@hyperttp/core)](https://www.npmjs.com/package/@hyperttp/core)
[![npm downloads](https://img.shields.io/npm/dm/@hyperttp/core)](https://www.npmjs.com/package/@hyperttp/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@hyperttp/core)](https://bundlephobia.com/package/@hyperttp/core)
[![license](https://img.shields.io/npm/l/@hyperttp/core)](./LICENSE)
[![typescript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

---

## What is @hyperttp/core?

**@hyperttp/core** is a low-level, high-performance HTTP engine designed for building fast,
extensible HTTP clients and SDKs.

It provides:

- ⚡ Optimized request execution pipeline
- 🔀 Runtime-aware transport abstraction
- 🔌 Plugin lifecycle hooks
- 🛡️ Safe request/response handling
- 📦 Zero runtime dependencies

`@hyperttp/core` is the foundation that powers **hyperttp**,
but it can also be used directly to build custom HTTP clients, SDKs, API wrappers and internal tooling.

> 💡 Looking for a batteries-included client?
>
> Use **[`hyperttp`](https://www.npmjs.com/package/hyperttp)** — it ships with retries, caching,
> parsing, rate limiting and other plugins already configured.

---

## Why @hyperttp/core?

Unlike the native `fetch()`, HyperCore is designed as an extensible HTTP engine rather than just a request API.

| Feature                | fetch | @hyperttp/core |
| ---------------------- | :---: | :------------: |
| Transport abstraction  |  ❌   |       ✅       |
| Plugin pipeline        |  ❌   |       ✅       |
| Request/Response hooks |  ❌   |       ✅       |
| Custom transports      |  ❌   |       ✅       |
| Built for SDKs         |  ⚠️   |       ✅       |
| Safe response cleanup  |  ❌   |       ✅       |
| Runtime auto-detection |  ❌   |       ✅       |

---

## Features

- ⚡ Optimized hot paths with minimal allocations
- 🚀 Fast manual query string serialization
- 🔀 Automatic runtime transport selection
- 🔌 Extensible plugin system
- 🧠 Request/response lifecycle hooks
- 🛡️ Protection against Prototype Pollution
- 🛡️ CRLF header validation
- 🛡️ Safe `ArrayBuffer` handling
- 📦 Zero runtime dependencies
- 🌊 Native stream support
- 🧹 Automatic resource cleanup
- 📈 Designed for high concurrency

---

## Architecture

```text
                  hyperttp
                      │
                      ▼
              @hyperttp/core
                      │
      ┌───────────────┴───────────────┐
      │                               │
      ▼                               ▼
 Transport Layer              Plugin Pipeline
      │                               │
      ├── BunTransport                │
      ├── UndiciTransport             ├── Retry
      ├── NodeTransport               ├── Cache
      ├── BrowserTransport            ├── Parser
      └── Custom Transport            └── Пользовательские плагины
```

---

## Installation

```bash
npm install @hyperttp/core
```

Recommended transports:

```bash
# Bun
npm install @hyperttp/transport-bun

# Node.js
npm install @hyperttp/transport-undici
```

---

## Quick Start

```ts
import { HyperCore } from "@hyperttp/core";

const http = new HyperCore({
  network: {
    baseURL: "https://api.example.com",
    headers: {
      "X-App-Version": "1.0.0",
    },
  },
});

const response = await http.get("/users", {
  query: {
    page: 1,
    limit: 20,
  },
});

const users = await response.json();

console.log(users);
```

---

## Error Handling

```ts
import { HyperCore, HttpClientError, TimeoutError } from "@hyperttp/core";

try {
  const res = await http.get("/users");

  console.log(await res.json());
} catch (error) {
  if (TimeoutError.isTimeoutError(error)) {
    console.error("Request timed out.");
  }

  if (HttpClientError.isHttpClientError(error)) {
    console.error(error.statusCode, error.message);
  }

  throw error;
}
```

---

## Streaming

Read a streaming response:

```ts
const response = await http.stream("https://stream.example.com/audio");

const reader = response.body.getReader();

while (true) {
  const { done, value } = await reader.read();

  if (done) break;

  console.log(value.length);
}
```

Discard a response body without buffering:

```ts
await http.dump("https://api.example.com/ping");
```

---

## Plugins

HyperCore exposes request lifecycle hooks that allow intercepting requests, responses and errors.

```ts
http.use({
  name: "logger",
  priority: 10,

  onRequest(req) {
    req.meta.start = performance.now();
  },

  onResponse(res, req) {
    const elapsed = performance.now() - (req.meta.start as number);

    console.log(`${req.method} ${req.url} -> ${res.status} (${elapsed.toFixed(2)} ms)`);
  },

  onError(error, req) {
    console.error(`${req.url}: ${error.message}`);
  },
});
```

---

## Transports

HyperCore automatically detects the current runtime, or you can provide your own transport.

| Transport        | Runtime       |
| ---------------- | ------------- |
| BunTransport     | Bun           |
| UndiciTransport  | Node.js       |
| NodeTransport    | Bun / Node.js |
| BrowserTransport | Browser       |
| Custom Transport | Any           |

Example:

```ts
import { HyperCore } from "@hyperttp/core";
import { UndiciTransport } from "@hyperttp/transport-undici";

const http = new HyperCore({
  customTransport: new UndiciTransport(),
});
```

---

## Performance

HyperCore is optimized for sustained high concurrency.

Recent stress testing:

- **200,000 requests**
- **1000 concurrent connections**
- **120 seconds**
- **0 request errors**

Optimizations include:

- minimal allocations
- object reuse
- optimized semaphore
- manual query serialization
- efficient header normalization
- zero-dependency core

---

## Ecosystem

| Package                      | Description              |
| ---------------------------- | ------------------------ |
| `hyperttp`                   | Ready-to-use HTTP client |
| `@hyperttp/core`             | HTTP engine              |
| `@hyperttp/parser`           | Response parsing         |
| `@hyperttp/cache`            | Cache utilities          |
| `@hyperttp/transport-undici` | Undici transport         |
| `@hyperttp/transport-bun`    | Bun transport            |

---

## Development

```bash
bun install

bun run lint
bun run typecheck
bun run test
bun run build
```

---

## License

MIT
