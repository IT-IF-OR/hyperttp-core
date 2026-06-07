# @hyperttp/core ⚡

> English | [Русский](https://github.com/IT-IF-OR/hyperttp-core/tree/main/lang/ru)

---

## 🌐 Language

- 🇺🇸 English
- 🇷🇺 [Русский](https://github.com/IT-IF-OR/hyperttp-core/tree/main/lang/ru)

---

**Hyperttp** is a high-performance, isomorphic HTTP client designed for modern Node.js and Bun environments.
It is built as a highly optimized, thin core featuring an intelligent transport layer and an advanced
pipeline‑based plugin architecture.

## 🔥 Key Features

- **⚡ Zero-Overhead Hot Paths:** Fast header merging, response mapping, and object creation loops optimized for
  high-throughput environments.
- **📍 LRU URL Caching:** Built-in string URL parsing cache (up to 512 entries) with automatic eviction to bypass
  repetitive `new URL()` overhead.
- **🔀 Intelligent Isomorphism:** Automatically switches between optimal underlying transports (Native Bun, Undici,
  or Node.js native `http`) while maintaining a unified, clean API.
- **🔌 Multi-Stage Hooks & Pipelines:** Granular control over the request lifecycle with sorted hook priorities
  and short-circuit capabilities.
- **🗜️ Transparent Decompression:** Automatic out-of-the-box handling of `gzip`, `deflate`, and `br` (Brotli)
  content-encodings for both standard `Uint8Array` buffers and `ReadableStream` data.
- **💎 Prototype Preservation:** Safe internal mapping that respects and carries forward custom prototypes passed
  via request configurations.

---

## 🏗️ Architecture & Lifecycle

Hyperttp shifts heavy lifting into structured execution pipelines:

1. **Request Pipeline (`onRequest`):** Intercepts configurations before execution. Supports **short-circuiting**—
   if a hook returns a response, the actual network transport layer is bypassed.
2. **Transport Execution (`HyperTransport`):** The underlying engine (e.g., Undici, Bun) processes the low-level
   socket request.
3. **Response Data Pipeline (`onResponseData`):** Transforms or intercepts raw transport responses directly before
   mapping and extraction.
4. **Internal Processing:** Transparent decompression is applied to raw buffers or streams.
5. **Response Pipeline (`onResponse`):**

- **Mutators:** Synchronously or asynchronously modify the client-facing response.
- **Side Effects / Background:** Runs parallel processing or logging blocks if `plugin.mode === "background"`.

6. **Error Pipeline (`onError`):** Catches connection drops, invalid parses, or protocol errors, allowing plugins
   to recover and gracefully fallback to alternative responses.

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

## Node.js v24.14.1 — UndiciTransport

```bash
npm install @hyperttp/transport-undici
```

| Rank | Client         | RPS    | Avg      | p50      | p90      | p99      | Errors |
| ---- | -------------- | ------ | -------- | -------- | -------- | -------- | ------ |
| 🥇 1 | undici         | 16.11K | 12.38 ms | 12.17 ms | 12.62 ms | 16.75 ms | 0      |
| 🥈 2 | @hyperttp/core | 16.08K | 12.41 ms | 11.99 ms | 12.47 ms | 14.57 ms | 0      |
| 🥉 3 | hyperttp       | 11.98K | 16.64 ms | 16.01 ms | 16.52 ms | 18.91 ms | 0      |
| 4    | bun-fetch      | 8.48K  | 23.47 ms | 21.98 ms | 29.27 ms | 35.54 ms | 0      |
| 5    | request        | 7.50K  | 26.63 ms | 25.82 ms | 30.20 ms | 33.27 ms | 0      |
| 6    | ky             | 6.44K  | 30.97 ms | 28.38 ms | 36.48 ms | 64.38 ms | 0      |
| 7    | axios          | 4.99K  | 39.97 ms | 38.81 ms | 43.82 ms | 51.39 ms | 0      |
| 8    | node-fetch     | 4.61K  | 43.28 ms | 41.23 ms | 49.00 ms | 63.58 ms | 0      |
| 9    | got            | 4.61K  | 43.33 ms | 41.42 ms | 47.81 ms | 64.51 ms | 0      |
| 10   | superagent     | 3.42K  | 58.41 ms | 57.53 ms | 63.26 ms | 67.41 ms | 0      |

---

## Bun 1.3.14 — BunTransport

```bash
npm install @hyperttp/transport-bun
```

| Rank | Client         | RPS    | Avg      | p50      | p90      | p99      | Errors |
| ---- | -------------- | ------ | -------- | -------- | -------- | -------- | ------ |
| 🥇 1 | bun-fetch      | 26.29K | 7.57 ms  | 7.91 ms  | 9.95 ms  | 12.43 ms | 0      |
| 🥈 2 | node-fetch     | 22.91K | 8.69 ms  | 8.79 ms  | 12.34 ms | 13.28 ms | 0      |
| 🥉 3 | undici         | 21.66K | 9.21 ms  | 9.40 ms  | 12.87 ms | 14.86 ms | 0      |
| 4    | @hyperttp/core | 13.73K | 14.53 ms | 14.42 ms | 15.74 ms | 22.15 ms | 0      |
| 5    | ky             | 13.56K | 14.73 ms | 13.09 ms | 19.64 ms | 21.30 ms | 0      |
| 6    | hyperttp       | 12.87K | 15.52 ms | 13.52 ms | 21.09 ms | 22.00 ms | 0      |
| 7    | request        | 8.56K  | 23.31 ms | 22.74 ms | 25.36 ms | 28.64 ms | 0      |
| 8    | superagent     | 8.36K  | 23.90 ms | 23.72 ms | 25.51 ms | 27.55 ms | 0      |
| 9    | axios          | 6.35K  | 31.41 ms | 31.53 ms | 33.56 ms | 38.03 ms | 0      |
| 10   | got            | 5.28K  | 37.84 ms | 30.25 ms | 56.91 ms | 59.92 ms | 0      |

---

## Node.js v24.14.1 — NodeTransport

| Rank | Client         | RPS    | Avg      | p50      | p90      | p99      | Errors |
| ---- | -------------- | ------ | -------- | -------- | -------- | -------- | ------ |
| 🥇 1 | undici         | 15.92K | 12.53 ms | 12.38 ms | 12.88 ms | 16.75 ms | 0      |
| 🥈 2 | bun-fetch      | 8.45K  | 23.58 ms | 22.05 ms | 29.49 ms | 35.63 ms | 0      |
| 🥉 3 | @hyperttp/core | 7.47K  | 26.70 ms | 25.03 ms | 32.76 ms | 41.48 ms | 0      |
| 4    | request        | 7.42K  | 26.91 ms | 26.06 ms | 30.98 ms | 35.71 ms | 0      |
| 5    | hyperttp       | 6.84K  | 29.16 ms | 27.72 ms | 34.39 ms | 43.95 ms | 0      |
| 6    | ky             | 6.57K  | 30.38 ms | 27.74 ms | 36.11 ms | 69.57 ms | 0      |
| 7    | axios          | 4.80K  | 41.57 ms | 40.46 ms | 45.35 ms | 56.94 ms | 0      |
| 8    | node-fetch     | 4.59K  | 43.43 ms | 41.54 ms | 48.93 ms | 63.88 ms | 0      |
| 9    | got            | 4.44K  | 44.96 ms | 43.24 ms | 49.36 ms | 65.20 ms | 0      |
| 10   | superagent     | 3.39K  | 58.86 ms | 57.93 ms | 64.18 ms | 69.88 ms | 0      |

---

## Bun 1.3.14 — NodeTransport

| Rank | Client         | RPS    | Avg      | p50      | p90      | p99      | Errors |
| ---- | -------------- | ------ | -------- | -------- | -------- | -------- | ------ |
| 🥇 1 | bun-fetch      | 26.28K | 7.58 ms  | 7.79 ms  | 9.83 ms  | 13.03 ms | 0      |
| 🥈 2 | undici         | 22.22K | 8.97 ms  | 9.34 ms  | 12.85 ms | 13.46 ms | 0      |
| 🥉 3 | node-fetch     | 21.24K | 9.38 ms  | 8.85 ms  | 13.65 ms | 15.67 ms | 0      |
| 4    | @hyperttp/core | 18.39K | 10.85 ms | 11.87 ms | 14.68 ms | 15.30 ms | 0      |
| 5    | hyperttp       | 13.51K | 14.76 ms | 14.04 ms | 19.81 ms | 23.84 ms | 0      |
| 6    | ky             | 11.94K | 16.73 ms | 16.45 ms | 23.50 ms | 25.49 ms | 0      |
| 7    | request        | 7.50K  | 26.60 ms | 25.55 ms | 30.96 ms | 41.62 ms | 0      |
| 8    | superagent     | 7.33K  | 27.27 ms | 26.89 ms | 29.35 ms | 33.68 ms | 0      |
| 9    | axios          | 5.63K  | 35.42 ms | 34.99 ms | 37.70 ms | 52.08 ms | 0      |
| 10   | got            | 4.71K  | 42.33 ms | 40.26 ms | 47.68 ms | 77.55 ms | 0      |

---

## 🚀 Quick Start

### Installation

```bash
npm install @hyperttp/core

```

### Basic HTTP Operations

```typescript
import { HyperCore } from "@hyperttp/core";

const http = new HyperCore({
  network: {
    userAgent: "MyApp/2.0",
    headers: { "X-Custom-Global": "Hyperttp" },
  },
});

// Standard responses
const response = await http.get("https://api.example.com/data");

// Shortcut data utilities
const userJson = await http.json<{ name: string }>("/users/123");
const logsText = await http.text("/logs/latest");

// Safely consume/drain a response without allocations
await http.dump("/analytics/ping");
```

### High-Performance Streaming

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

## 🔌 Advanced Plugins & Extensions

You can extend existing configurations contextually via `.extend()` (or its alias `.create()`) and install
prioritized hooks.

```typescript
// Inherit global pools and layers while changing specific presets
const authenticatedClient = http.extend({
  network: { headers: { Authorization: "Bearer token_abc" } },
});

authenticatedClient.use({
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
    const duration = performance.now() - req.meta.startTime;
    console.log(
      `[${req.method}] ${req.url} -> ${res.status} (${duration.toFixed(2)}ms)`,
    );
  },

  onError: async (error, req, ctx) => {
    console.error(`Request failed to ${req.url}: ${error.message}`);
    // Return a response object here if you want to bypass/recover from the failure
  },
});
```

### Graceful Resource Destruction

Always clean up underlying transport configurations, socket pools, and keep‑alive timers in microservice tear-downs:

```typescript
// Performs a graceful or rapid shutdown sequence across transport selectors
await http.destroy(true);
```

---

## 📄 License

MIT
