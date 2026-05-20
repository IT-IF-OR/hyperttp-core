# @hyperttp/core 🚀

> English | Русский

---

## 🌐 Language / Язык

- 🇺🇸 [English](<[#english](https://github.com/IT-IF-OR/hyperttp-core)>)
- 🇷🇺 [Русский](<[#русский](https://github.com/IT-IF-OR/hyperttp-core/lang/ru)>)

---

High-performance HTTP core for Node.js and Bun built on top of `undici`.

`@hyperttp/core` is designed for:

- stable p90/p99 latency,
- predictable behavior under load,
- tail-latency reduction,
- high throughput performance,
- low overhead transport-layer abstraction.

---

## Features

- ⚡ High performance HTTP execution layer
- 📉 Stable p90/p99 latency under load
- 🔄 Keep-Alive & connection pooling
- 🌊 Stream response support
- 🍪 CookieAgent integration
- 📈 Request metrics tracking
- 🔧 Flexible network-layer configuration
- ♻️ Retry & redirect handling
- 🧩 Simple API over `undici`

---

## Performance

`@hyperttp/core` provides:

- minimal p99 latency among most HTTP clients,
- throughput close to `undici`,
- significantly more stable latency under load.

---

## Benchmark

### Test configuration

```txt
Requests      20000
Concurrency   200
Warmup        500
Timeout       60000 ms
Runtime       Node.js
```

Benchmark executed via:

```bash
npx tsx ./bench.ts
```

---

## [Benchmark results](https://github.com/IT-IF-OR/bench)

| Client         |   RPS |     Avg |      p99 |    Heap |
| :------------- | ----: | ------: | -------: | ------: |
| undici         | 9.86K | 20.22ms | 203.05ms |  155 MB |
| @hyperttp/core | 9.04K | 22.10ms |  29.14ms |  295 MB |
| hyperttp       | 7.10K | 28.12ms |  40.02ms |  272 MB |
| fetch          | 5.78K | 34.47ms | 322.17ms |  289 MB |
| ky             | 4.50K | 44.35ms | 440.24ms |  374 MB |
| axios          | 4.08K | 48.76ms |  54.92ms |  238 MB |
| node-fetch     | 3.62K | 55.10ms |  83.60ms |  434 MB |
| got            | 3.06K | 65.31ms |  96.38ms |  164 MB |
| superagent     | 2.96K | 67.29ms |  78.96ms | 81.1 MB |

---

## Why p99 matters

Most HTTP clients look good on average latency but suffer from high tail latency
under load.

`@hyperttp/core` is optimized for:

- stable scheduling behavior,
- predictable concurrency,
- minimized latency spikes,
- burst workload stability.

---

## Installation

### Bun

```bash
bun add @hyperttp/core
```

### npm

```bash
npm install @hyperttp/core
```

---

## Quick start

```ts
import { HyperCore } from "@hyperttp/core";

const core = new HyperCore({
  verbose: true,
});

const response = await core.get("http://localhost:3000/json");

console.log(response.body);
```

---

## Configuration

```ts
import { HyperCore } from "@hyperttp/core";

const core = new HyperCore({
  verbose: true,

  trackMetrics: true,

  network: {
    timeout: 30000,
    maxConcurrent: 500,
    pipelining: 10,
    keepAliveTimeout: 30000,
    allowHttp2: true,
    followRedirects: true,
    maxRedirects: 5,
  },

  retry: {
    maxRetries: 3,
  },
});
```

---

## Stream API

```ts
import fs from "node:fs";

const stream = await core.stream("https://example.com/file.zip");

stream.body.pipe(fs.createWriteStream("./file.zip"));
```

---

## Metrics

```ts
const core = new HyperCore({
  trackMetrics: true,
});

const response = await core.get("https://api.example.com");

console.log(response.meta?.timings);
```

Example:

```ts
{
  networkMs: 12.41;
}
```

---

## Runtime support

- Node.js 18+
- Bun

---

## Built on

- `undici`
- `http-cookie-agent`

---

## License

MIT
