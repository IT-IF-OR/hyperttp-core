# @hyperttp/core ⚡

> [English](https://github.com/IT-IF-OR/hyperttp-core) | Русский

---

## 🌐 Language / Язык

- 🇺🇸 [English](https://github.com/IT-IF-OR/hyperttp-core)
- 🇷🇺 [Русский](https://github.com/IT-IF-OR/hyperttp-core/tree/main/lang/ru)

---

**Hyperttp** — это высокопроизводительный, изоморфный HTTP-клиент, созданный для современных Node.js и Bun окружений.
Он спроектирован как "тонкое" ядро с умной стратегией выбора транспорта и мощной системой плагинов.

## Почему Hyperttp?

- **⚡ Производительность:** оптимизированный hot-path выполнения HTTP-запросов в Node.js и Bun
- **🧩 Изоморфность:** Единый API для Node.js и Bun. Система сама выбирает лучший транспорт
  (native Bun, Undici или стандартный Node.js `http`).
- **🔌 Система плагинов:** Легко расширяйте функционал через хуки
  (`onRequest`, `onResponse`, `onError`).
- **🛠️ Стратегия транспорта:** Легко добавляйте поддержку новых рантаймов
  (Deno, Browser) через интерфейс `HyperTransport`.

## Бенчмарки

### Конфигурация теста

```txt
Запросов      100000
Конкурентность 500
Прогрев       500
Тайм-аут      60000 мс
```

Запуск бенчмарка:

```bash
bun run bench.ts && npx tsx bench.ts

```

---

## [Результаты бенчмарков](https://github.com/IT-IF-OR/bench)

---

# 🟦 Node.js v24.14.1 — Undici transport

### 🏆 Leaderboard (by RPS)

| Rank | Client         | RPS    | p99      | AVG     | Heap    |
| ---- | -------------- | ------ | -------- | ------- | ------- |
| 🥇 1 | @hyperttp/core | 27.72K | 43.45ms  | 17.95ms | 18.7 MB |
| 🥈 2 | undici         | 19.80K | 59.51ms  | 25.17ms | 20.6 MB |
| 🥉 3 | ky             | 7.82K  | 119.80ms | 63.86ms | 34.1 MB |
| 4    | node-fetch     | 6.39K  | 125.38ms | 77.95ms | 15.2 MB |
| 5    | superagent     | 6.28K  | 127.06ms | 79.50ms | 15.1 MB |
| 6    | axios          | 6.19K  | 110.82ms | 80.53ms | 21.4 MB |
| 7    | got            | 5.84K  | 130.92ms | 85.49ms | 15.7 MB |

---

# 🟨 Bun v1.3.14 — Bun transport

### 🏆 Leaderboard (by RPS)

| Rank | Client         | RPS    | p99     | AVG     | Heap    |
| ---- | -------------- | ------ | ------- | ------- | ------- |
| 🥇 1 | undici         | 36.42K | 15.67ms | 13.68ms | 31.8 MB |
| 🥈 2 | node-fetch     | 36.29K | 16.70ms | 13.74ms | 4.07 MB |
| 🥉 3 | @hyperttp/core | 34.26K | 21.61ms | 14.54ms | 34.9 MB |
| 4    | ky             | 31.10K | 22.78ms | 16.05ms | 9.88 MB |
| 5    | superagent     | 13.86K | 69.78ms | 36.00ms | 18.1 MB |
| 6    | axios          | 8.98K  | 66.58ms | 55.52ms | 18.8 MB |
| 7    | got            | 7.15K  | 86.70ms | 69.83ms | 25.2 MB |

---

# 🟩 Node.js v24.14.1 — Node transport

### 🏆 Leaderboard (by RPS)

| Rank | Client         | RPS    | p99      | AVG     | Heap    |
| ---- | -------------- | ------ | -------- | ------- | ------- |
| 🥇 1 | undici         | 20.08K | 66.21ms  | 24.76ms | 20.6 MB |
| 🥈 2 | @hyperttp/core | 12.52K | 66.42ms  | 39.80ms | 14.1 MB |
| 🥉 3 | ky             | 7.98K  | 113.21ms | 62.55ms | 23.1 MB |
| 4    | node-fetch     | 6.71K  | 114.06ms | 74.23ms | 15.9 MB |
| 5    | axios          | 6.29K  | 116.21ms | 79.22ms | 22.2 MB |
| 6    | superagent     | 6.19K  | 125.31ms | 80.73ms | 15.2 MB |
| 7    | got            | 5.86K  | 135.85ms | 85.18ms | 19.3 MB |

---

# 🟪 Bun v1.3.14 — Node transport

### 🏆 Leaderboard (by RPS)

| Rank | Client         | RPS    | p99      | AVG     | Heap    |
| ---- | -------------- | ------ | -------- | ------- | ------- |
| 🥇 1 | node-fetch     | 35.87K | 17.00ms  | 13.90ms | 6.21 MB |
| 🥈 2 | undici         | 35.79K | 16.59ms  | 13.92ms | 25.4 MB |
| 🥉 3 | ky             | 29.68K | 37.27ms  | 16.80ms | 17.3 MB |
| 4    | @hyperttp/core | 17.32K | 50.71ms  | 28.79ms | 17.5 MB |
| 5    | superagent     | 13.73K | 122.70ms | 36.37ms | 34.4 MB |
| 6    | axios          | 8.77K  | 86.39ms  | 56.84ms | 18.9 MB |
| 7    | got            | 6.97K  | 98.33ms  | 71.64ms | 25.3 MB |

---

## Быстрый старт

### Установка

```bash
npm install @hyperttp/core

```

### Использование

```typescript
import { HyperCore } from "@hyperttp/core";

const http = new HyperCore({
  network: { userAgent: "MyApp/1.0" },
});

// GET запрос
const response = await http.get("https://api.example.com/data");

// POST запрос
const result = await http.post("/users", { name: "John" });
```

### Расширение и плагины

`HyperCore` поддерживает создание изолированных экземпляров с собственной конфигурацией и использование плагинов.

```typescript
const apiClient = http.extend({
  network: { headers: { "X-Auth": "secret" } },
});

apiClient.use({
  name: "logger-plugin",
  enabled: () => true,
  onRequest: async (req) => {
    console.log(`Sending ${req.method} to ${req.url}`);
  },
});
```

---

## Архитектура

Hyperttp построен на паттерне **Strategy**.

1. **Ядро (`HyperCore`)**: Оркестратор, управляющий жизненным циклом запроса.
2. **Транспорты (`HyperTransport`)**: Низкоуровневые реализации для разных рантаймов.
   Выбираются динамически, что позволяет минимизировать объем пакета.
3. **Хуки**: Выполняются на этапе запроса (до отправки),
   ответа (после получения) и обработки ошибок,
   позволяя перехватывать и изменять поток выполнения без изменения основного кода.

---

## Лицензия

MIT
