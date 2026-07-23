# @hyperttp/core ⚡

> **Высокопроизводительный HTTP-движок для Node.js и Bun.**

**Русский** | [English](https://github.com/IT-IF-OR/hyperttp-core)

[![npm version](https://img.shields.io/npm/v/@hyperttp/core)](https://www.npmjs.com/package/@hyperttp/core)
[![npm downloads](https://img.shields.io/npm/dm/@hyperttp/core)](https://www.npmjs.com/package/@hyperttp/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@hyperttp/core)](https://bundlephobia.com/package/@hyperttp/core)
[![license](https://img.shields.io/npm/l/@hyperttp/core)](./LICENSE)
[![typescript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

---

## Что такое @hyperttp/core?

**@hyperttp/core** — это низкоуровневый высокопроизводительный HTTP-движок,
предназначенный для создания быстрых HTTP-клиентов, SDK и API-обёрток.

Он предоставляет:

- ⚡ оптимизированный конвейер выполнения запросов;
- 🔀 абстракцию транспортов с автоматическим выбором под окружение;
- 🔌 систему плагинов и lifecycle-хуков;
- 🛡️ безопасную обработку запросов и ответов;
- 📦 отсутствие runtime-зависимостей.

`@hyperttp/core` является фундаментом **hyperttp**, но также отлично подходит для создания собственных HTTP-клиентов,
внутренних инструментов, SDK и API-библиотек.

> 💡 Нужен готовый HTTP-клиент «из коробки»?
>
> Используйте **[`hyperttp`](https://www.npmjs.com/package/hyperttp)** — он уже включает повторы запросов (Retry),
> кэширование, парсер ответов, Rate Limit и другие плагины.

---

## Почему @hyperttp/core?

В отличие от стандартного `fetch()`, HyperCore — это полноценный HTTP-движок, а не просто API для отправки запросов.

| Возможность                 | fetch | @hyperttp/core |
| --------------------------- | :---: | :------------: |
| Абстракция транспортов      |  ❌   |       ✅       |
| Система плагинов            |  ❌   |       ✅       |
| Lifecycle-хуки              |  ❌   |       ✅       |
| Пользовательские транспорты |  ❌   |       ✅       |
| Подходит для SDK            |  ⚠️   |       ✅       |
| Безопасная очистка Response |  ❌   |       ✅       |
| Автовыбор транспорта        |  ❌   |       ✅       |

---

## Возможности

- ⚡ Минимум аллокаций на горячих путях
- 🚀 Быстрая ручная сериализация Query String
- 🔀 Автоматический выбор транспорта
- 🔌 Расширяемая система плагинов
- 🧠 Lifecycle-хуки запросов и ответов
- 🛡️ Защита от Prototype Pollution
- 🛡️ Проверка заголовков на CRLF-инъекции
- 🛡️ Безопасная работа с `ArrayBuffer`
- 📦 Ноль runtime-зависимостей
- 🌊 Полноценная поддержка потоков (Streams)
- 🧹 Автоматическое освобождение ресурсов
- 📈 Оптимизирован для высокой конкуренции запросов

---

## Архитектура

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

## Установка

```bash
npm install @hyperttp/core
```

Рекомендуемые транспорты:

```bash
# Bun
npm install @hyperttp/transport-bun

# Node.js
npm install @hyperttp/transport-undici
```

---

## Быстрый старт

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

## Обработка ошибок

```ts
import { HyperCore, HttpClientError, TimeoutError } from "@hyperttp/core";

try {
  const response = await http.get("/users");

  console.log(await response.json());
} catch (error) {
  if (TimeoutError.isTimeoutError(error)) {
    console.error("Превышено время ожидания запроса.");
  }

  if (HttpClientError.isHttpClientError(error)) {
    console.error(error.statusCode, error.message);
  }

  throw error;
}
```

---

## Потоки (Streaming)

Чтение потокового ответа:

```ts
const response = await http.stream("https://stream.example.com/audio");

const reader = response.body.getReader();

while (true) {
  const { done, value } = await reader.read();

  if (done) break;

  console.log(value.length);
}
```

Освободить тело ответа без чтения в память:

```ts
await http.dump("https://api.example.com/ping");
```

---

## Плагины

HyperCore предоставляет lifecycle-хуки для перехвата запросов, ответов и ошибок.

```ts
http.use({
  name: "logger",
  priority: 10,

  onRequest(req) {
    req.meta.start = performance.now();
  },

  onResponse(res, req) {
    const elapsed = performance.now() - (req.meta.start as number);

    console.log(`${req.method} ${req.url} → ${res.status} (${elapsed.toFixed(2)} ms)`);
  },

  onError(error, req) {
    console.error(`${req.url}: ${error.message}`);
  },
});
```

---

## Транспорты

HyperCore автоматически определяет среду выполнения, либо можно указать собственный транспорт.

| Транспорт        | Среда         |
| ---------------- | ------------- |
| BunTransport     | Bun           |
| UndiciTransport  | Node.js       |
| NodeTransport    | Node.js / Bun |
| BrowserTransport | Browser       |
| Custom Transport | Любая         |

Пример:

```ts
import { HyperCore } from "@hyperttp/core";
import { UndiciTransport } from "@hyperttp/transport-undici";

const http = new HyperCore({
  customTransport: new UndiciTransport(),
});
```

---

## Производительность

HyperCore проектируется для стабильной работы под высокой нагрузкой.

Последние стресс-тесты:

- **200 000 запросов**
- **1000 одновременных соединений**
- **120 секунд непрерывной нагрузки**
- **0 ошибок**

Основные оптимизации:

- минимальное количество аллокаций;
- повторное использование объектов;
- высокопроизводительный ring-buffer семафора;
- ручная сериализация Query String;
- быстрая нормализация HTTP-заголовков;
- отсутствие runtime-зависимостей.

---

## Экосистема

| Пакет                        | Назначение             |
| ---------------------------- | ---------------------- |
| `hyperttp`                   | Готовый HTTP-клиент    |
| `@hyperttp/core`             | HTTP-движок            |
| `@hyperttp/parser`           | Парсер ответов         |
| `@hyperttp/cache`            | Кэширование            |
| `@hyperttp/transport-undici` | Транспорт для Node.js  |
| `@hyperttp/transport-bun`    | Нативный транспорт Bun |

---

## Разработка

```bash
bun install

bun run lint
bun run typecheck
bun run test
bun run build
```

---

## Лицензия

MIT
