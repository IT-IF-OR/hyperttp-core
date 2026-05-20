# @hyperttp/core 🚀

> Русский | English

---

## 🌐 Language / Язык

- 🇺🇸 [English](https://github.com/IT-IF-OR/hyperttp-core)
- 🇷🇺 [Русский](https://github.com/IT-IF-OR/hyperttp-core/lang/ru)

---

Высокопроизводительное HTTP-ядро для Node.js и Bun, построенное поверх `undici`.

`@hyperttp/core` ориентирован на:

- стабильный p90/p99 latency,
- предсказуемое поведение под нагрузкой,
- минимизацию tail-latency,
- высокую throughput-производительность,
- низкие накладные расходы поверх transport-layer.

---

## Особенности

- ⚡ Высокая производительность
- 📉 Стабильный p90/p99 latency
- 🔄 Keep-Alive и connection pooling
- 🌊 Поддержка stream-response
- 🍪 CookieAgent support
- 📈 Метрики запросов
- 🔧 Гибкая настройка network-layer
- ♻️ Retry и redirect handling
- 🧩 Простое API поверх `undici`

---

## Производительность

`@hyperttp/core` показывает:

- минимальную p99 задержку среди большинства HTTP-клиентов,
- throughput близкий к `undici`,
- значительно более стабильный latency под нагрузкой.

---

## Benchmark

### Конфигурация теста

```txt
Requests      20000
Concurrency   200
Warmup        500
Timeout       60000 ms
Runtime       Node.js
```

Benchmark запускался через:

```bash
npx tsx ./bench.ts
```

---

## [Benchmark Results](https://github.com/IT-IF-OR/bench)

| Client         |       RPS |     Avg |      p99 |    Heap |
| :------------- | --------: | ------: | -------: | ------: |
| undici         | 9.86K rps | 20.22ms | 203.05ms |  155 MB |
| @hyperttp/core | 9.04K rps | 22.10ms |  29.14ms |  295 MB |
| hyperttp       | 7.10K rps | 28.12ms |  40.02ms |  272 MB |
| fetch          | 5.78K rps | 34.47ms | 322.17ms |  289 MB |
| ky             | 4.50K rps | 44.35ms | 440.24ms |  374 MB |
| axios          | 4.08K rps | 48.76ms |  54.92ms |  238 MB |
| node-fetch     | 3.62K rps | 55.10ms |  83.60ms |  434 MB |
| got            | 3.06K rps | 65.31ms |  96.38ms |  164 MB |
| superagent     | 2.96K rps | 67.29ms |  78.96ms | 81.1 MB |

---

## Почему p99 важен

Большинство HTTP-клиентов показывают хороший average latency, но имеют высокий
tail-latency под нагрузкой.

`@hyperttp/core` оптимизирован для:

- стабильного scheduler-поведения,
- предсказуемой concurrency,
- минимизации latency spikes,
- устойчивой работы под burst-нагрузкой.

---

## Установка

### Bun

```bash
bun add @hyperttp/core
```

### npm

```bash
npm install @hyperttp/core
```

---

## Простое использование

```ts
import { HyperCore } from "@hyperttp/core";

const core = new HyperCore({
  verbose: true,
});

const response = await core.get("http://localhost:3000/json");

console.log(response.body);
```

---

## Настройка

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

## Метрики

```ts
const core = new HyperCore({
  trackMetrics: true,
});

const response = await core.get("https://api.example.com");

console.log(response.meta?.timings);
```

Пример:

```ts
{
  networkMs: 12.41;
}
```

---

## Runtime Support

- Node.js 18+
- Bun

---

## Основано на

- `undici`
- `http-cookie-agent`

---

## License

MIT
