# @hyperttp/core

> Протокол-независимое ядро выполнения для клиентских и серверных коммуникаций.

**Русский** | [English](../../README.md)

[![CI](https://github.com/IT-IF-OR/hyperttp-core/actions/workflows/ci.yml/badge.svg)](https://github.com/IT-IF-OR/hyperttp-core/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@hyperttp/core)](https://www.npmjs.com/package/@hyperttp/core)
[![npm downloads](https://img.shields.io/npm/dm/@hyperttp/core)](https://www.npmjs.com/package/@hyperttp/core)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@hyperttp/core)](https://bundlephobia.com/package/@hyperttp/core)
[![license](https://img.shields.io/npm/l/@hyperttp/core)](../../LICENSE)
[![typescript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

## Позиционирование

`@hyperttp/core` — небольшое оркестрационное ядро, а не очередная обёртка над `fetch` и не
HTTP-фреймворк «со всем из коробки». Оно связывает три независимые точки расширения:

- **Протоколы** определяют семантику коммуникации. Протокол может отправлять через `HyperSender`,
  принимать через `HyperReceiver` или реализовывать обе роли как `HyperProtocol`.
- **Транспорты** отвечают за физический I/O. Текущий контракт транспорта выполняет исходящие
  запросы и может дополнительно слушать входящие запросы.
- **Плагины** добавляют политики клиентских запросов и сквозное поведение, не расширяя само ядро.

Ядро отвечает за диспетчеризацию, lifecycle, выполнение плагинов и управление ресурсами. REST входит
в базовую поставку; дополнительные протоколы, оптимизированные транспорты и высокоуровневое поведение
живут в отдельных пакетах.

```text
Приложение
    │
    ├── Плагины: retry, cache, auth, tracing, metrics, logging, policy
    │
 HyperCore
    │
    ├── Протокол: prepare → send → parse
    │              receive → handle → respond
    │
    └── Транспорт: execute (клиент) / listen (сервер)
                   Node.js / Bun / Deno / Browser / custom runtime
```

Эта граница намеренная. Новые повторы клиентских запросов, кэши, способы аутентификации,
observability и другие политики запросов должны быть плагинами. Новая сетевая семантика должна
поставляться пакетами протоколов. Новые способы I/O должны поставляться пакетами транспортов.

> Нужен готовый HTTP-клиент с настроенными возможностями? Используйте
> [`hyperttp`](https://www.npmjs.com/package/hyperttp), который компонует ядро с прикладными плагинами
> и настройками по умолчанию.

## Свойства ядра

- Оркестрация клиентских и серверных ролей.
- Протокол-независимый конверт запроса и универсальная форма ответа.
- Клиентский lifecycle: `prepare → send → parse`.
- Серверный lifecycle: `receive → handle → respond`.
- Разрешение транспортов по протоколу и координированное владение ими.
- Блокирующие и фоновые hooks клиентских плагинов.
- Выбор транспорта по runtime с browser-safe fetch fallback.
- Строгие TypeScript-контракты и module augmentation для типизированных namespace протоколов.
- Отсутствие встроенных runtime-зависимостей.

## Установка

```bash
npm install @hyperttp/core @hyperttp/types
```

Совместимые оптимизированные транспорты устанавливаются отдельно. Убедитесь, что выбранная версия
транспорта объявляет совместимость с `@hyperttp/types@^0.3.0`: старые версии транспортов рассчитаны
на контракты типов v1 и не могут быть установлены вместе с core 2.0. Без опционального пакета
транспорта ядро использует встроенный `FetchTransport`.

## Быстрый старт клиента

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

Тот же запрос через протокол-независимый API:

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

## Быстрый старт сервера

Транспорт также может предоставлять `listen()`. `HyperCore` связывает его с принимающей стороной
выбранного протокола:

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

// Закрывает активные серверы и освобождает все транспорты ядра.
await core.destroy();
```

Протоколы могут быть только клиентскими, только серверными или предоставлять обе роли. Текущий
контракт транспорта всегда предоставляет клиентский `execute()` и может дополнительно предоставлять
серверный `listen()`.

## Протоколы

REST — единственный протокол, реализованный внутри ядра. Внешние модули протоколов загружаются
лениво:

| Протокол  | Пакет                          | Namespace                    |
| --------- | ------------------------------ | ---------------------------- |
| REST      | встроен                        | `core.rest`                  |
| GraphQL   | `@hyperttp/protocol-graphql`   | `core.graphql`               |
| gRPC      | `@hyperttp/protocol-grpc`      | `core.grpc`                  |
| tRPC      | `@hyperttp/protocol-trpc`      | `core.trpc`                  |
| WebSocket | `@hyperttp/protocol-websocket` | `core.ws` / `core.websocket` |
| SSE       | `@hyperttp/protocol-sse`       | `core.sse`                   |
| MQTT      | `@hyperttp/protocol-mqtt`      | `core.mqtt`                  |

Если опциональный пакет протокола не установлен, разрешение завершается понятной подсказкой по
установке, а не молча выбирает другой протокол.

### Роли протокола

Единый модуль протокола может предоставлять одну или обе роли:

```ts
const protocol = {
  protocol: "my-protocol",
  sender: mySender, // опциональная клиентская роль
  receiver: myReceiver, // опциональная серверная роль
};

core.registerProtocol(protocol);
```

Sender переводит входные данные протокола в транспортный запрос и разбирает транспортный ответ.
Receiver переводит входящий транспортный запрос в данные протокола и сериализует ответ приложения.

Пакеты протоколов могут расширять типизированные входы и namespace через module augmentation
`@hyperttp/types`:

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

## Транспорты

Транспорт описывает свои клиентские возможности и опциональную серверную возможность:

```ts
interface HyperTransport {
  execute(request: TransportRequest): Promise<TransportResponse>;
  listen?(options: TransportListenOptions): Promise<TransportServer>;
  close?(): Promise<void> | void;
  destroy?(): Promise<void> | void;
}
```

- `execute()` — обязательная клиентская роль.
- `listen()` — опциональная серверная роль.
- `protocols` или `supports()` объявляет возможности протоколов.
- Ядро разрешает и удерживает транспорты по протоколу и закрывает общий экземпляр только после
  освобождения последнего владельца.

Выбор по runtime:

| Runtime        | Предпочтительный пакет       | Fallback                    |
| -------------- | ---------------------------- | --------------------------- |
| Node.js        | `@hyperttp/transport-undici` | встроенный `FetchTransport` |
| Bun            | `@hyperttp/transport-bun`    | встроенный `FetchTransport` |
| Deno           | `@hyperttp/transport-deno`   | встроенный `FetchTransport` |
| Browser / edge | custom transport             | встроенный `FetchTransport` |

Транспорт можно передать явно:

```ts
import { HyperCore } from "@hyperttp/core";
import { UndiciTransport } from "@hyperttp/transport-undici";

const core = new HyperCore({
  customTransport: new UndiciTransport(),
});
```

## Плагины

Плагины — основной механизм расширения поведения клиентских запросов, которое не относится к
семантике протокола или физическому I/O. Текущие hooks выполняются в клиентском lifecycle `send()`:

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

- `onRequest` может изменить запрос или вернуть ранний ответ.
- `onResponse` может проверить или заменить ответ.
- `onError` может восстановить выполнение, вернув ответ.
- `mode: "background"` отделяет response-side работу от блокирующего пути.
- `enabled(config)` управляет регистрацией.
- `setup(context)` инициализирует плагин.

Примеры функциональности для плагинов:

- retries и circuit breakers;
- кэширование и дедупликация запросов;
- аутентификация и подпись запросов;
- tracing, metrics и структурированное логирование;
- rate limiting, concurrency control и scheduling;
- валидация схем и прикладные политики.

## Встроенный REST-протокол

REST предоставляет клиентскую и серверную роли через `RestProtocol`.

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

REST поддерживает:

- сериализацию query с повторяющимися параметрами массивов;
- нормализацию заголовков;
- JSON-сериализацию plain object и array request body;
- обработку JSON, text и binary response;
- timeout и пользовательский abort;
- небуферизованный stream mode;
- декодирование запросов и сериализацию ответов для серверной роли.

Публичные REST-типы доступны из `@hyperttp/core/rest`.

## Lifecycle

```ts
const child = core.extend({ verbose: true }); // разделяет transport leases
const isolated = core.create({}); // независимый lifecycle транспорта

await child.destroy();
await isolated.destroy();
await core.destroy();
```

- `extend()` создаёт связанное ядро и разделяет владение уже разрешёнными транспортами.
- `create()` создаёт независимое ядро и по умолчанию не наследует `customTransport`.
- `destroy()` идемпотентен, закрывает отслеживаемые серверы и освобождает транспорты.
- `destroy(false)` запрашивает принудительное завершение, если транспорт его поддерживает.

## Обработка ошибок

```ts
import { HyperClientError, TimeoutError } from "@hyperttp/core";

try {
  await core.rest.get("/slow", { timeout: 1_000 });
} catch (error) {
  if (TimeoutError.isTimeoutError(error)) {
    console.error("Истёк таймаут запроса");
  } else if (HyperClientError.isHyperClientError(error)) {
    console.error(error.code, error.message);
  }
}
```

## Границы ядра

Стабильное ядро намеренно ограничено:

1. регистрацией и диспетчеризацией протоколов;
2. разрешением, разделением и завершением транспортов;
3. оркестрацией клиентского и серверного lifecycle;
4. выполнением плагинов;
5. базовым REST-протоколом и универсальными контрактами ошибок.

Развитие функциональности должно происходить через плагины, пакеты протоколов и пакеты транспортов.
Маленькая граница делает runtime-поведение предсказуемым и позволяет стабилизировать API ядра
независимо от окружающей экосистемы.

## Поддержка runtime

- Node.js 20 и новее;
- актуальный стабильный Bun;
- актуальный стабильный Deno;
- современные браузеры и edge runtime с Fetch и Web Streams.

## Разработка

```bash
npm install
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

Обязательный порядок: `lint → typecheck → test → build`. CI дополнительно проверяет browser bundle,
runtime smoke tests и установку собранного npm tarball.

## Лицензия

MIT
