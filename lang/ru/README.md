# @hyperttp/core ⚡

> [Русский](https://github.com/IT-IF-OR/hyperttp-core/tree/main/lang/ru) | English

---

## 🌐 Язык

- 🇺🇸 [English](https://github.com/IT-IF-OR/hyperttp-core)
- 🇷🇺 **Русский**

---

**Hyperttp** — это высокопроизводительный изоморфный HTTP-клиент, разработанный для современных сред Node.js и Bun.
Он представляет собой легковесное, глубоко оптимизированное ядро с интеллектуальным выбором транспорта и мощной
архитектурой плагинов на основе конвейеров (pipelines).

## 🔥 Ключевые особенности

- **⚡ Горячие пути без оверхеда (Zero-Overhead Hot Paths):** Оптимизированные циклы слияния заголовков, маппинга
  ответов и создания объектов для высоконагруженных систем.
- **📍 LRU-кэширование URL:** Встроенный кэш парсинга строк URL (до 512 записей) с автоматическим вытеснением
  для обхода накладных расходов на `new URL()`.
- **🔀 Интеллектуальный изоморфизм:** Автоматическое переключение между оптимальными транспортами (Native Bun,
  Undici или нативный `http` в Node.js) при сохранении единого и чистого API.
- **🔌 Многоэтапные хуки и конвейеры:** Гранулярный контроль жизненного цикла запроса с сортировкой приоритетов
  хуков и возможностью раннего завершения (short-circuit).
- **🗜️ Прозрачная декомпрессия:** Автоматическая обработка кодировок `gzip`, `deflate` и `br` (Brotli) «из коробки»
  как для стандартных буферов `Uint8Array`, так и для потоков `ReadableStream`.
- **💎 Сохранение прототипов:** Безопасный внутренний маппинг, который уважает и сохраняет кастомные прототипы,
  переданные через конфигурации запросов.

---

## 🏗️ Архитектура и жизненный цикл

Hyperttp переносит всю тяжелую работу в структурированные конвейеры выполнения:

1. **Конвейер запроса (`onRequest`):** Перехватывает конфигурацию перед выполнением. Поддерживает **раннее завершение**
   (short-circuit) — если хук возвращает ответ, выполнение на уровне сетевого транспорта полностью обходится.
2. **Выполнение транспорта (`HyperTransport`):** Низкоуровневый движок (например, Undici, Bun) обрабатывает запрос
   на уровне сокета.
3. **Конвейер данных ответа (`onResponseData`):** Трансформирует или перехватывает сырые ответы транспорта прямо перед
   маппингом и извлечением данных.
4. **Внутренняя обработка:** К сырым буферам или потокам применяется прозрачная декомпрессия.
5. **Конвейер ответа (`onResponse`):**

- **Мутаторы (Mutators):** Синхронно или асинхронно модифицируют клиентский объект ответа.
- **Побочные эффекты (Side Effects / Background):** Запускает фоновую обработку или логирование параллельно основному
  потоку, если `plugin.mode === "background"`.

6. **Конвейер ошибок (`onError`):** Перехватывает обрывы соединений, ошибки парсинга или протокола, позволяя плагинам
   восстанавливать выполнение и плавно переключаться на резервные ответы.

---

## 📊 Бенчмарки

### Конфигурация теста

```txt
Requests        20000
Concurrency     200
Duration        20000
Timeout         60000 ms

```

Запуск бенчмарка:

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

## 🚀 Быстрый старт

### Установка

```bash
npm install @hyperttp/core

```

### Базовые HTTP-операции

```typescript
import { HyperCore } from "@hyperttp/core";

const http = new HyperCore({
  network: {
    userAgent: "MyApp/2.0",
    headers: { "X-Custom-Global": "Hyperttp" },
  },
});

// Стандартные запросы
const response = await http.get("https://api.example.com/data");

// Удобные методы для быстрого извлечения данных
const userJson = await http.json<{ name: string }>("/users/123");
const logsText = await http.text("/logs/latest");

// Безопасное поглощение (очистка) ответа без выделения памяти
await http.dump("/analytics/ping");
```

### Высокопроизводительный стриминг

```typescript
// GET-потоки (Стриминг)
const streamResponse = await http.stream("https://stream.example.com/audio");
const reader = streamResponse.body.getReader();

// POST-потоки (например, ответы от LLM / аудио-пайпы)
const chatStream = await http.postStream("/v1/chat/completions", {
  model: "gpt-4",
  stream: true,
});
```

---

## 🔌 Продвинутые плагины и расширения

Вы можете контекстуально расширять существующие конфигурации с помощью метода `.extend()` (или его алиаса `.create()`)
и устанавливать плагины с приоритезацией хуков.

```typescript
// Наследование глобальных пулов соединений с изменением локальных настроек
const authenticatedClient = http.extend({
  network: { headers: { Authorization: "Bearer token_abc" } },
});

authenticatedClient.use({
  name: "performance-logger",
  priority: 100, // Фоновый приоритет выполнения (чем выше, тем раньше вызовется)
  mode: "background", // onResponse будет выполняться как неблокирующий побочный эффект

  setup: (ctx) => {
    // Вызывается мгновенно при регистрации плагина
    ctx.config.logger?.info?.("Плагин успешно активирован");
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
    console.error(`Ошибка запроса к ${req.url}: ${error.message}`);
    // Здесь можно вернуть объект ответа (HttpResponse), чтобы перехватить ошибку и восстановить поток
  },
});
```

### Плавное завершение работы (Cleanup)

Не забывайте корректно освобождать ресурсы, закрывать сокет-пулы и keep-alive таймеры при остановке микросервисов:

```typescript
// Запускает процесс плавного или быстрого закрытия активных транспортов
await http.destroy(true);
```

---

## 📄 Лицензия

MIT
