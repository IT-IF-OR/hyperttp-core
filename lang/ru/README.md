# @hyperttp/core ⚡

> [English](https://github.com/IT-IF-OR/hyperttp-core) | Русский

[![npm version](https://img.shields.io/npm/v/@hyperttp/core)](https://www.npmjs.com/package/@hyperttp/core)
[![npm downloads](https://img.shields.io/npm/dm/@hyperttp/core)](https://www.npmjs.com/package/@hyperttp/core)
[![license](https://img.shields.io/npm/l/@hyperttp/core)](./LICENSE)
[![typescript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

---

## 🌐 Язык

- 🇺🇸 [English](https://github.com/IT-IF-OR/hyperttp-core)
- 🇷🇺 Русский

---

## 🔗 Быстрые ссылки

- 🏢 **Организация:** [github.com/IT-IF-OR](https://github.com/IT-IF-OR)
- 👤 **Автор:** [github.com/dirold2](https://github.com/dirold2)
- 📦 **npm:** [npmjs.com/org/hyperttp](https://www.npmjs.com/org/hyperttp)
- 🚀 **Высокоуровневый клиент:** [`hyperttp`](https://www.npmjs.com/package/hyperttp) (все плагины уже подключены)

---

**@hyperttp/core** — это низкоуровневое высокопроизводительное ядро экосистемы Hyperttp.
Оно предоставляет тонкое оптимизированное HTTP-ядро с интеллектуальным транспортным слоем и продвинутой
плагинной архитектурой на основе конвейеров — основу, на которой построен функциональный клиент [`hyperttp`](https://www.npmjs.com/package/hyperttp).

> 💡 **Ищете готовое решение "из коробки"?** Установите [`hyperttp`](https://www.npmjs.com/package/hyperttp) — он оборачивает `@hyperttp/core` кэшированием, ограничением скорости, очередями, парсингом и многим другим.

---

## 🔥 Ключевые возможности

- **⚡ Горячие пути с нулевыми накладными расходами:** Быстрое слияние заголовков, маппинг ответов и циклы создания объектов оптимизированы для сред с высокой пропускной способностью. Пулинг объектов `InternalRequest` устраняет аллокации в горячем пути.
- **📍 LRU-кэширование URL:** Встроенный кэш парсинга строковых URL (до 512 записей) с автоматическим вытеснением для обхода повторных вызовов `new URL()`.
- **🔀 Интеллектуальная изоморфность:** Автоматически переключается между оптимальными транспортными слоями (Native Bun, Undici или нативный `fetch` Node.js), сохраняя единый чистый API.
- **🔌 Многоэтапные хуки и конвейеры:** Детальный контроль над жизненным циклом запроса с сортировкой хуков по приоритету и возможностью короткого замыкания (short-circuit).
- **🗜️ Прозрачная декомпрессия:** Автоматическая обработка кодировок `gzip`, `deflate` и `br` (Brotli) "из коробки" как для стандартных буферов `Uint8Array`, так и для данных `ReadableStream`.
- **💎 Сохранение прототипов:** Безопасный внутренний маппинг, который уважает и передаёт пользовательские прототипы, переданные через конфигурации запросов.
- **🦀 Инструментарий на Rust:** Сборка и линтинг с помощью OXC (`oxlint` + `oxfmt`) для молниеносно быстрых циклов разработки.

---

## 📦 Пакеты экосистемы

| Пакет                                                                                  | Описание                                   | Репозиторий                                                   |
| -------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------- |
| **`@hyperttp/core`** (вы здесь)                                                        | Низкоуровневое ядро с транспортным конвейером | [GitHub](https://github.com/IT-IF-OR/hyperttp-core)          |
| [`@hyperttp/types`](https://www.npmjs.com/package/@hyperttp/types)                     | Общие TypeScript-определения типов         | [GitHub](https://github.com/dirold2/hyperttp-types)           |
| [`@hyperttp/transport-bun`](https://www.npmjs.com/package/@hyperttp/transport-bun)     | Нативный транспорт для Bun                 | [GitHub](https://github.com/IT-IF-OR/hyperttp-transport-bun)  |
| [`@hyperttp/transport-undici`](https://www.npmjs.com/package/@hyperttp/transport-undici) | Транспорт Undici для Node.js               | [GitHub](https://github.com/IT-IF-OR/hyperttp-transport-undici) |
| [`hyperttp`](https://www.npmjs.com/package/hyperttp)                                   | Высокоуровневый клиент с подключёнными плагинами | [GitHub](https://github.com/dirold2/hyperttp)                 |

---

## 🏗️ Архитектура и жизненный цикл

`HyperCore` перекладывает тяжёлую работу на структурированные конвейеры выполнения:

```
┌─────────────────────────────────────────────────────────────────┐
│                         HyperCore                               │
│                                                                 │
│  1. Конвейер запросов (onRequest) ─── поддержка short-circuit  │
│                     │                                           │
│  2. Выполнение транспорта (HyperTransport)                      │
│     ├─ BunTransport (нативный Bun fetch)                        │
│     ├─ UndiciTransport (Node.js)                                │
│     └─ NodeTransport (глобальный fetch)                         │
│                     │                                           │
│  3. Конвейер данных ответа (onResponseData)                     │
│                     │                                           │
│  4. Внутренняя обработка (декомпрессия, маппинг)                │
│                     │                                           │
│  5. Конвейер ответа (onResponse)                                │
│     ├─ Мутаторы (синхронная/асинхронная модификация)            │
│     └─ Побочные эффекты (фоновые, неблокирующие)                │
│                     │                                           │
│  6. Конвейер ошибок (onError) ─── поддержка восстановления     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Быстрый старт

### Установка

```bash
npm install @hyperttp/core

# Опционально: установите конкретный транспорт
npm install @hyperttp/transport-bun    # для Bun
npm install @hyperttp/transport-undici # для Node.js
```

### Базовое использование

`HyperCore` возвращает объекты `HttpResponse<T>` с полным контролем над телом ответа:

```typescript
import { HyperCore } from "@hyperttp/core";

const http = new HyperCore({
  network: {
    userAgent: "MyApp/2.0",
    headers: { "X-Custom-Global": "Hyperttp" },
  },
});

// Возвращает HttpResponse<T> с полным контролем
const response = await http.get("https://api.example.com/data");
console.log(response.status);
console.log(response.headers);

// Встроенные методы парсинга
const json = await response.json<User>();
const text = await response.text();
const buffer = await response.arrayBuffer();

// Методы быстрого доступа
const userJson = await http.json<{ name: string }>("/users/123");
const logsText = await http.text("/logs/latest");

// Безопасное потребление/сброс ответа без аллокаций
await http.dump("/analytics/ping");
```

### Потоковая передача

```typescript
// GET-потоки
const streamResponse = await http.stream("https://stream.example.com/audio");
const reader = streamResponse.body.getReader();

// POST-потоки (например, LLM Completions / Audio Pipes)
const chatStream = await http.postStream("/v1/chat/completions", {
  model: "gpt-4",
  stream: true,
});
```

---

## 🔌 Система плагинов

Расширьте `HyperCore` пользовательскими хуками, которые интегрируются в конвейер:

```typescript
import { HyperCore } from "@hyperttp/core";

const http = new HyperCore();

http.use({
  name: "performance-logger",
  priority: 100, // Приоритет выполнения (выше = раньше)
  mode: "background", // Заставляет onResponse выполняться как неблокирующий побочный эффект

  setup: (ctx) => {
    // Вызывается сразу при регистрации
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
    // Верните объект response здесь, чтобы обойти/восстановиться после ошибки
  },
});
```

### Фазы плагинов

| Фаза        | Хук              | Описание                                              |
| ----------- | ---------------- | ----------------------------------------------------- |
| **REQUEST** | `onRequest`      | Перехватывает перед выполнением. Поддерживает short-circuit. |
| **DATA**    | `onResponseData` | Трансформирует сырые ответы транспорта перед маппингом. |
| **FORMAT**  | `onResponse`     | Модифицирует ответы на стороне клиента.               |
| **ERROR**   | `onError`        | Перехватывает и восстанавливает после ошибок.         |

> 💡 **Нужны кэширование, ограничение скорости, очереди, парсинг и другое?** Используйте мета-пакет [`hyperttp`](https://www.npmjs.com/package/hyperttp) — он поставляется с 8 предустановленными плагинами.

---

## 🌍 Транспорты

Hyperttp автоматически выбирает оптимальный транспорт для вашей среды выполнения:

| Транспорт           | Среда выполнения    | Установка                              |
| ------------------- | ------------------- | -------------------------------------- |
| **BunTransport**    | Bun                 | `npm install @hyperttp/transport-bun`  |
| **UndiciTransport** | Node.js             | `npm install @hyperttp/transport-undici` |
| **NodeTransport**   | Node.js / Браузер   | Встроен (использует глобальный `fetch`) |

### Пользовательский транспорт

Реализуйте свой собственный транспорт:

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
    // Очистка ресурсов
  }
}

const http = new HyperCore({}, new MyCustomTransport());
```

---

## 🔄 Расширение конфигурации

Создавайте производные клиенты с объединённой конфигурацией через `.extend()`:

```typescript
// Наследует глобальные пулы и слои, изменяя конкретные предустановки
const authenticatedClient = http.extend({
  network: { headers: { Authorization: "Bearer token_abc" } },
});
```

### Корректное освобождение ресурсов

Всегда очищайте конфигурации транспорта, пулы сокетов и таймеры keep-alive при завершении работы микросервисов:

```typescript
// Выполняет корректную или быструю последовательность завершения работы через селекторы транспорта
await http.destroy(true);
```

---

## 📊 Бенчмарки

### Конфигурация тестов

```txt
Запросы         20000
Параллелизм     200
Длительность    20000
Таймаут         60000 мс
```

Для запуска собственного набора тестов:

```bash
bun run bench.ts && npx tsx bench.ts
```

## 🟦 Bun 1.3.14 — BunTransport

```bash
npm install @hyperttp/transport-bun
```

| Ранг | Клиент             | RPS        | Среднее      | p50          | p90          | p99          | Ошибки |
| ---- | ------------------ | ---------- | ------------ | ------------ | ------------ | ------------ | ------ |
| 🥇 1 | bun-fetch          | 24.34K     | 8.18 мс      | 8.50 мс      | 10.62 мс     | 14.10 мс     | 0      |
| 🥈 2 | node-fetch         | 21.58K     | 9.23 мс      | 9.39 мс      | 12.86 мс     | 14.72 мс     | 0      |
| 🥉 3 | undici             | 20.28K     | 9.83 мс      | 10.12 мс     | 13.80 мс     | 15.35 мс     | 0      |
| 4    | **@hyperttp/core** | **17.39K** | **11.46 мс** | **12.94 мс** | **15.53 мс** | **16.66 мс** | 0      |
| 5    | ky                 | 12.80K     | 15.58 мс     | 13.95 мс     | 20.62 мс     | 22.77 мс     | 0      |
| 6    | request            | 8.31K      | 24.00 мс     | 23.43 мс     | 29.54 мс     | 32.82 мс     | 0      |
| 7    | superagent         | 7.96K      | 25.09 мс     | 24.95 мс     | 26.85 мс     | 28.46 мс     | 0      |
| 8    | axios              | 6.19K      | 32.21 мс     | 31.93 мс     | 34.15 мс     | 39.09 мс     | 0      |
| 9    | got                | 5.13K      | 38.94 мс     | 30.99 мс     | 58.61 мс     | 63.14 мс     | 0      |

## 🟦 Bun 1.3.14 — NodeTransport

| Ранг | Клиент             | RPS        | Среднее      | p50          | p90          | p99          | Ошибки |
| ---- | ------------------ | ---------- | ------------ | ------------ | ------------ | ------------ | ------ |
| 🥇 1 | bun-fetch          | 23.94K     | 8.32 мс      | 8.63 мс      | 10.64 мс     | 13.77 мс     | 0      |
| 🥈 2 | node-fetch         | 21.71K     | 9.18 мс      | 9.35 мс      | 12.58 мс     | 14.40 мс     | 0      |
| 🥉 3 | undici             | 20.22K     | 9.86 мс      | 10.15 мс     | 13.65 мс     | 15.41 мс     | 0      |
| 4    | **@hyperttp/core** | **17.80K** | **11.20 мс** | **12.38 мс** | **15.20 мс** | **17.29 мс** | 0      |
| 5    | ky                 | 12.78K     | 15.63 мс     | 13.92 мс     | 20.59 мс     | 23.70 мс     | 0      |
| 6    | request            | 8.20K      | 24.31 мс     | 23.62 мс     | 29.13 мс     | 34.53 мс     | 0      |
| 7    | superagent         | 8.06K      | 24.79 мс     | 24.79 мс     | 27.26 мс     | 29.52 мс     | 0      |
| 8    | axios              | 6.28K      | 31.72 мс     | 31.81 мс     | 33.53 мс     | 35.65 мс     | 0      |
| 9    | got                | 5.17K      | 38.56 мс     | 30.85 мс     | 58.12 мс     | 61.60 мс     | 0      |

## 🟦 Node.js v24.14.1 — UndiciTransport

```bash
npm install @hyperttp/transport-undici
```

| Ранг | Клиент             | RPS        | Среднее      | p50          | p90          | p99          | Ошибки |
| ---- | ------------------ | ---------- | ------------ | ------------ | ------------ | ------------ | ------ |
| 🥇 1 | undici             | 13.84K     | 14.41 мс     | 13.54 мс     | 15.39 мс     | 26.23 мс     | 0      |
| 🥈 2 | **@hyperttp/core** | **11.95K** | **16.68 мс** | **14.90 мс** | **17.04 мс** | **26.58 мс** | 0      |
| 3    | bun-fetch          | 7.89K      | 25.26 мс     | 23.04 мс     | 33.86 мс     | 39.14 мс     | 0      |
| 4    | request            | 6.99K      | 28.58 мс     | 27.19 мс     | 34.91 мс     | 39.22 мс     | 0      |
| 5    | ky                 | 5.97K      | 33.42 мс     | 30.05 мс     | 41.58 мс     | 64.01 мс     | 0      |
| 6    | axios              | 4.71K      | 42.39 мс     | 40.65 мс     | 48.48 мс     | 56.20 мс     | 0      |
| 7    | node-fetch         | 4.43K      | 45.03 мс     | 42.18 мс     | 53.61 мс     | 65.02 мс     | 0      |
| 8    | got                | 4.20K      | 47.51 мс     | 45.20 мс     | 55.32 мс     | 67.58 мс     | 0      |
| 9    | superagent         | 3.18K      | 62.66 мс     | 61.13 мс     | 70.10 мс     | 75.46 мс     | 0      |

## 🟦 Node.js v24.14.1 — NodeTransport

| Ранг | Клиент             | RPS       | Среднее      | p50          | p90          | p99          | Ошибки |
| ---- | ------------------ | --------- | ------------ | ------------ | ------------ | ------------ | ------ |
| 🥇 1 | undici             | 15.45K    | 12.91 мс     | 12.68 мс     | 13.69 мс     | 16.96 мс     | 0      |
| 🥈 2 | bun-fetch          | 8.31K     | 24.00 мс     | 22.34 мс     | 30.38 мс     | 36.20 мс     | 0      |
| 🥉 3 | request            | 7.34K     | 27.14 мс     | 26.27 мс     | 30.96 мс     | 34.91 мс     | 0      |
| 4    | **@hyperttp/core** | **7.23K** | **27.58 мс** | **25.68 мс** | **33.76 мс** | **42.75 мс** | 0      |
| 5    | ky                 | 6.41K     | 31.14 мс     | 28.43 мс     | 37.55 мс     | 61.30 мс     | 0      |
| 6    | axios              | 4.87K     | 40.96 мс     | 39.70 мс     | 45.47 мс     | 56.43 мс     | 0      |
| 7    | node-fetch         | 4.62K     | 43.15 мс     | 41.12 мс     | 49.25 мс     | 64.28 мс     | 0      |
| 8    | got                | 4.58K     | 43.63 мс     | 41.57 мс     | 48.48 мс     | 65.02 мс     | 0      |
| 9    | superagent         | 3.32K     | 60.11 мс     | 59.08 мс     | 66.02 мс     | 71.26 мс     | 0      |

### 📈 Анализ производительности

**Ключевые выводы:**

- **Bun + BunTransport**: @hyperttp/core достигает **17.39K RPS** — всего на 14% медленнее нативного `bun-fetch` (24.34K)
- **Node.js + UndiciTransport**: @hyperttp/core достигает **11.95K RPS** с p99 задержкой **26.58мс** — практически идентично нативному undici (26.23мс)
- **Нулевой уровень ошибок**: 0% ошибок во всех сценариях во всех бенчмарках
- **Эффективность памяти**: @hyperttp/core использует ~148-184МБ в Bun, меньше чем axios (201МБ) и got (165-170МБ)

---

## 🛠️ Разработка

Этот проект использует инструментарий OXC для молниеносно быстрой разработки:

```bash
# Установка зависимостей
bun install

# Проверка типов
bun run typecheck

# Линтинг (oxlint — ~8мс)
bun run lint

# Форматирование (oxfmt — ~25мс)
bun run format

# Сборка
bun run build

# Запуск тестов
bun run test
```

---

## 📄 Лицензия

MIT

---

<p align="center">
  Сделано с ❤️ <a href="https://github.com/dirold2">dirold2</a>
</p>
