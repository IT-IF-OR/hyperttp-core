# @hyperttp/core ⚡

> English | [Русский](https://github.com/IT-IF-OR/hyperttp-core/tree/main/lang/ru)

[![npm version](https://img.shields.io/npm/v/@hyperttp/core)](https://www.npmjs.com/package/@hyperttp/core)
[![npm downloads](https://img.shields.io/npm/dm/@hyperttp/core)](https://www.npmjs.com/package/@hyperttp/core)
[![license](https://img.shields.io/npm/l/@hyperttp/core)](./LICENSE)
[![typescript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

---

## 🌐 Language

- 🇺🇸 English
- 🇷🇺 [Русский](https://github.com/IT-IF-OR/hyperttp-core/tree/main/lang/ru)

---

## 🔗 Quick Links

- 🏢 **Organization:** [github.com/IT-IF-OR](https://github.com/IT-IF-OR)
- 👤 **Author:** [github.com/dirold2](https://github.com/dirold2)
- 📦 **npm:** [npmjs.com/org/hyperttp](https://www.npmjs.com/org/hyperttp)
- 🚀 **High-level client:** [`hyperttp`](https://www.npmjs.com/package/hyperttp) (all plugins pre-wired)

---

**@hyperttp/core** is the low-level, high-performance engine of the Hyperttp ecosystem.
It provides a thin, optimized HTTP core with an intelligent transport layer and an advanced
pipeline-based plugin architecture — the foundation upon which the feature-rich [`hyperttp`](https://www.npmjs.com/package/hyperttp) client is built.

> 💡 **Looking for a batteries-included client?** Install [`hyperttp`](https://www.npmjs.com/package/hyperttp) instead — it wraps `@hyperttp/core` with caching, rate limiting, queueing, parsing, and more.

---

## 🔥 Key Features

- **⚡ Zero-Overhead Hot Paths:** Fast header merging, response mapping, and object creation loops optimized for high-throughput environments. Object pooling for `InternalRequest` eliminates allocations in the hot path.
- **📍 LRU URL Caching:** Built-in string URL parsing cache (up to 512 entries) with automatic eviction to bypass repetitive `new URL()` overhead.
- **🔀 Intelligent Isomorphism:** Automatically switches between optimal underlying transports (Native Bun, Undici, or Node.js native `fetch`) while maintaining a unified, clean API.
- **🔌 Multi-Stage Hooks & Pipelines:** Granular control over the request lifecycle with sorted hook priorities and short-circuit capabilities.
- **🗜️ Transparent Decompression:** Automatic out-of-the-box handling of `gzip`, `deflate`, and `br` (Brotli) content-encodings for both standard `Uint8Array` buffers and `ReadableStream` data.
- **💎 Prototype Preservation:** Safe internal mapping that respects and carries forward custom prototypes passed via request configurations.
- **🦀 Rust-Powered Toolchain:** Built and linted with OXC (`oxlint` + `oxfmt`) for blazing-fast development cycles.

---

## 📦 Ecosystem Packages

| Package                                                                                  | Description                                  | Repository                                                      |
| ---------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------- |
| **`@hyperttp/core`** (you are here)                                                      | Low-level core with transport pipeline       | [GitHub](https://github.com/IT-IF-OR/hyperttp-core)             |
| [`@hyperttp/types`](https://www.npmjs.com/package/@hyperttp/types)                       | Shared TypeScript type definitions           | [GitHub](https://github.com/dirold2/hyperttp-types)             |
| [`@hyperttp/transport-bun`](https://www.npmjs.com/package/@hyperttp/transport-bun)       | Native Bun transport                         | [GitHub](https://github.com/IT-IF-OR/hyperttp-transport-bun)    |
| [`@hyperttp/transport-undici`](https://www.npmjs.com/package/@hyperttp/transport-undici) | Undici transport for Node.js                 | [GitHub](https://github.com/IT-IF-OR/hyperttp-transport-undici) |
| [`hyperttp`](https://www.npmjs.com/package/hyperttp)                                     | High-level client with all plugins pre-wired | [GitHub](https://github.com/dirold2/hyperttp)                   |

---

## 🏗️ Architecture & Lifecycle

`HyperCore` shifts heavy lifting into structured execution pipelines:

```
┌─────────────────────────────────────────────────────────────────┐
│                         HyperCore                               │
│                                                                 │
│  1. Request Pipeline (onRequest) ─── short-circuit capable      │
│                     │                                           │
│  2. Transport Execution (HyperTransport)                        │
│     ├─ BunTransport (native Bun fetch)                          │
│     ├─ UndiciTransport (Node.js)                                │
│     └─ NodeTransport (global fetch)                             │
│                     │                                           │
│  3. Response Data Pipeline (onResponseData)                     │
│                     │                                           │
│  4. Internal Processing (decompression, mapping)                │
│                     │                                           │
│  5. Response Pipeline (onResponse)                              │
│     ├─ Mutators (sync/async modification)                       │
│     └─ Side Effects (background, non-blocking)                  │
│                     │                                           │
│  6. Error Pipeline (onError) ─── recovery capable               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Installation

```bash
npm install @hyperttp/core

# Optional: install a specific transport
npm install @hyperttp/transport-bun    # for Bun
npm install @hyperttp/transport-undici # for Node.js
```

### Basic Usage

`HyperCore` returns `HttpResponse<T>` objects with full control over the response body:

```typescript
import { HyperCore } from "@hyperttp/core";

const http = new HyperCore({
  network: {
    userAgent: "MyApp/2.0",
    headers: { "X-Custom-Global": "Hyperttp" },
  },
});

// Returns HttpResponse<T> with full control
const response = await http.get("https://api.example.com/data");
console.log(response.status);
console.log(response.headers);

// Built-in parsing methods
const json = await response.json<User>();
const text = await response.text();
const buffer = await response.arrayBuffer();

// Shortcut methods
const userJson = await http.json<{ name: string }>("/users/123");
const logsText = await http.text("/logs/latest");

// Safely consume/drain a response without allocations
await http.dump("/analytics/ping");
```

### Streaming

```typescript
// GET Streams
const streamResponse = await http.stream("https://stream.example.com/audio");
const reader = streamResponse.body.getReader();

// POST Streams (e.g., LLM Completions / Audio Pipes)
const chatStream = await http.postStream("/v1/chat/completions", {
  model: "gpt-4",
  stream: true,
});
```

---

## 🔌 Plugin System

Extend `HyperCore` with custom hooks that integrate into the pipeline:

```typescript
import { HyperCore } from "@hyperttp/core";

const http = new HyperCore();

http.use({
  name: "performance-logger",
  priority: 100, // Sorted execution priority (higher runs first)
  mode: "background", // Forces onResponse to run as a non-blocking side-effect

  setup: (ctx) => {
    // Fired immediately on registration
    ctx.config.logger?.info?.("Plugin active");
  },

  onRequest: async (req, ctx) => {
    req.meta.startTime = performance.now();
  },

  onResponse: async (res, req, ctx) => {
    const duration = performance.now() - (req.meta.startTime as number);
    console.log(`[${req.method}] ${req.url} -> ${res.status} (${duration.toFixed(2)}ms)`);
  },

  onError: async (error, req, ctx) => {
    console.error(`Request failed to ${req.url}: ${error.message}`);
    // Return a response object here to bypass/recover from the failure
  },
});
```

### Plugin Phases

| Phase       | Hook             | Description                                             |
| ----------- | ---------------- | ------------------------------------------------------- |
| **REQUEST** | `onRequest`      | Intercepts before execution. Supports short-circuiting. |
| **DATA**    | `onResponseData` | Transforms raw transport responses before mapping.      |
| **FORMAT**  | `onResponse`     | Modifies client-facing responses.                       |
| **ERROR**   | `onError`        | Catches and recovers from errors.                       |

> 💡 **Need caching, rate limiting, queueing, parsing, and more?** Use the [`hyperttp`](https://www.npmjs.com/package/hyperttp) meta-package — it comes with 8 pre-wired plugins.

---

## 🌍 Transports

Hyperttp automatically selects the optimal transport for your runtime:

| Transport           | Runtime           | Installation                             |
| ------------------- | ----------------- | ---------------------------------------- |
| **BunTransport**    | Bun               | `npm install @hyperttp/transport-bun`    |
| **UndiciTransport** | Node.js           | `npm install @hyperttp/transport-undici` |
| **NodeTransport**   | Node.js / Browser | Built-in (uses global `fetch`)           |

### Custom Transport

Implement your own transport:

```typescript
import type { HyperTransport, TransportRequest, TransportResponse } from "@hyperttp/types";

class MyCustomTransport implements HyperTransport {
  async execute(req: TransportRequest): Promise<TransportResponse> {
    const response = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: req.signal,
    });

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: response.body,
      url: response.url,
    };
  }

  async close(): Promise<void> {
    // Cleanup resources
  }
}

const http = new HyperCore({}, new MyCustomTransport());
```

---

## 🔄 Extending Configuration

Create derived clients with merged configuration via `.extend()`:

```typescript
// Inherit global pools and layers while changing specific presets
const authenticatedClient = http.extend({
  network: { headers: { Authorization: "Bearer token_abc" } },
});
```

### Graceful Resource Destruction

Always clean up underlying transport configurations, socket pools, and keep-alive timers in microservice tear-downs:

```typescript
// Performs a graceful or rapid shutdown sequence across transport selectors
await http.destroy(true);
```

---

## 📊 Benchmarks

### Test Configuration

```txt
Requests        20000
Concurrency     200
Duration        20000
Timeout         60000 ms
```

To run your own suite:

```bash
bun run bench.ts && npx tsx bench.ts
```

## 🟦 Bun 1.3.14 — BunTransport

```bash
npm install @hyperttp/transport-bun
```

| Rank | Client             | RPS        | Avg          | p50          | p90          | p99          | Errors |
| ---- | ------------------ | ---------- | ------------ | ------------ | ------------ | ------------ | ------ |
| 🥇 1 | bun-fetch          | 24.34K     | 8.18 ms      | 8.50 ms      | 10.62 ms     | 14.10 ms     | 0      |
| 🥈 2 | node-fetch         | 21.58K     | 9.23 ms      | 9.39 ms      | 12.86 ms     | 14.72 ms     | 0      |
| 🥉 3 | undici             | 20.28K     | 9.83 ms      | 10.12 ms     | 13.80 ms     | 15.35 ms     | 0      |
| 4    | **@hyperttp/core** | **17.39K** | **11.46 ms** | **12.94 ms** | **15.53 ms** | **16.66 ms** | 0      |
| 5    | ky                 | 12.80K     | 15.58 ms     | 13.95 ms     | 20.62 ms     | 22.77 ms     | 0      |
| 6    | request            | 8.31K      | 24.00 ms     | 23.43 ms     | 29.54 ms     | 32.82 ms     | 0      |
| 7    | superagent         | 7.96K      | 25.09 ms     | 24.95 ms     | 26.85 ms     | 28.46 ms     | 0      |
| 8    | axios              | 6.19K      | 32.21 ms     | 31.93 ms     | 34.15 ms     | 39.09 ms     | 0      |
| 9    | got                | 5.13K      | 38.94 ms     | 30.99 ms     | 58.61 ms     | 63.14 ms     | 0      |

## 🟦 Bun 1.3.14 — NodeTransport

| Rank | Client             | RPS        | Avg          | p50          | p90          | p99          | Errors |
| ---- | ------------------ | ---------- | ------------ | ------------ | ------------ | ------------ | ------ |
| 🥇 1 | bun-fetch          | 23.94K     | 8.32 ms      | 8.63 ms      | 10.64 ms     | 13.77 ms     | 0      |
| 🥈 2 | node-fetch         | 21.71K     | 9.18 ms      | 9.35 ms      | 12.58 ms     | 14.40 ms     | 0      |
| 🥉 3 | undici             | 20.22K     | 9.86 ms      | 10.15 ms     | 13.65 ms     | 15.41 ms     | 0      |
| 4    | **@hyperttp/core** | **17.80K** | **11.20 ms** | **12.38 ms** | **15.20 ms** | **17.29 ms** | 0      |
| 5    | ky                 | 12.78K     | 15.63 ms     | 13.92 ms     | 20.59 ms     | 23.70 ms     | 0      |
| 6    | request            | 8.20K      | 24.31 ms     | 23.62 ms     | 29.13 ms     | 34.53 ms     | 0      |
| 7    | superagent         | 8.06K      | 24.79 ms     | 24.79 ms     | 27.26 ms     | 29.52 ms     | 0      |
| 8    | axios              | 6.28K      | 31.72 ms     | 31.81 ms     | 33.53 ms     | 35.65 ms     | 0      |
| 9    | got                | 5.17K      | 38.56 ms     | 30.85 ms     | 58.12 ms     | 61.60 ms     | 0      |

## 🟦 Node.js v24.14.1 — UndiciTransport

```bash
npm install @hyperttp/transport-undici
```

| Rank | Client             | RPS        | Avg          | p50          | p90          | p99          | Errors |
| ---- | ------------------ | ---------- | ------------ | ------------ | ------------ | ------------ | ------ |
| 🥇 1 | undici             | 13.84K     | 14.41 ms     | 13.54 ms     | 15.39 ms     | 26.23 ms     | 0      |
| 🥈 2 | **@hyperttp/core** | **11.95K** | **16.68 ms** | **14.90 ms** | **17.04 ms** | **26.58 ms** | 0      |
| 3    | bun-fetch          | 7.89K      | 25.26 ms     | 23.04 ms     | 33.86 ms     | 39.14 ms     | 0      |
| 4    | request            | 6.99K      | 28.58 ms     | 27.19 ms     | 34.91 ms     | 39.22 ms     | 0      |
| 5    | ky                 | 5.97K      | 33.42 ms     | 30.05 ms     | 41.58 ms     | 64.01 ms     | 0      |
| 6    | axios              | 4.71K      | 42.39 ms     | 40.65 ms     | 48.48 ms     | 56.20 ms     | 0      |
| 7    | node-fetch         | 4.43K      | 45.03 ms     | 42.18 ms     | 53.61 ms     | 65.02 ms     | 0      |
| 8    | got                | 4.20K      | 47.51 ms     | 45.20 ms     | 55.32 ms     | 67.58 ms     | 0      |
| 9    | superagent         | 3.18K      | 62.66 ms     | 61.13 ms     | 70.10 ms     | 75.46 ms     | 0      |

## 🟦 Node.js v24.14.1 — NodeTransport

| Rank | Client             | RPS       | Avg          | p50          | p90          | p99          | Errors |
| ---- | ------------------ | --------- | ------------ | ------------ | ------------ | ------------ | ------ |
| 🥇 1 | undici             | 15.45K    | 12.91 ms     | 12.68 ms     | 13.69 ms     | 16.96 ms     | 0      |
| 🥈 2 | bun-fetch          | 8.31K     | 24.00 ms     | 22.34 ms     | 30.38 ms     | 36.20 ms     | 0      |
| 🥉 3 | request            | 7.34K     | 27.14 ms     | 26.27 ms     | 30.96 ms     | 34.91 ms     | 0      |
| 4    | **@hyperttp/core** | **7.23K** | **27.58 ms** | **25.68 ms** | **33.76 ms** | **42.75 ms** | 0      |
| 5    | ky                 | 6.41K     | 31.14 ms     | 28.43 ms     | 37.55 ms     | 61.30 ms     | 0      |
| 6    | axios              | 4.87K     | 40.96 ms     | 39.70 ms     | 45.47 ms     | 56.43 ms     | 0      |
| 7    | node-fetch         | 4.62K     | 43.15 ms     | 41.12 ms     | 49.25 ms     | 64.28 ms     | 0      |
| 8    | got                | 4.58K     | 43.63 ms     | 41.57 ms     | 48.48 ms     | 65.02 ms     | 0      |
| 9    | superagent         | 3.32K     | 60.11 ms     | 59.08 ms     | 66.02 ms     | 71.26 ms     | 0      |

### 📈 Performance Analysis

**Key Insights:**

- **Bun + BunTransport**: @hyperttp/core achieves **17.39K RPS** — only 14% slower than native `bun-fetch` (24.34K)
- **Node.js + UndiciTransport**: @hyperttp/core reaches **11.95K RPS** with p99 latency of **26.58ms** — virtually identical to native undici (26.23ms)
- **Zero Error Rate**: 0% errors across all scenarios in all benchmarks
- **Memory Efficiency**: @hyperttp/core uses ~148-184MB in Bun, less than axios (201MB) and got (165-170MB)

---

## 🛠️ Development

This project uses the OXC toolchain for lightning-fast development:

```bash
# Install dependencies
bun install

# Type checking
bun run typecheck

# Linting (oxlint — ~8ms)
bun run lint

# Formatting (oxfmt — ~25ms)
bun run format

# Build
bun run build

# Run tests
bun run test
```

---

## 📄 License

MIT

---

<p align="center">
  <a href="https://github.com/dirold2">dirold2</a>
</p>
