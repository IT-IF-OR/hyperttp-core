import type { HyperCore } from "../Core/HyperCore.js";
import type { HttpClientOptions } from "./options.js";

/**
 * @ru
 * Фазы жизненного цикла запроса (выполняются строго по очереди от начала до отправки).
 * Конвейер запроса: START -> PREPARE -> CONTROL -> FORMAT -> SEND.
 * Конвейер ответа:  SEND -> FORMAT -> CONTROL -> PREPARE -> START.
 * @en
 * Request lifecycle phases (executed strictly in order from start to dispatch).
 * Request pipeline: START -> PREPARE -> CONTROL -> FORMAT -> SEND.
 * Response pipeline: SEND -> FORMAT -> CONTROL -> PREPARE -> START.
 */
export type PluginPhase =
  | /**
   * @ru Самое начало. Тут запускаются таймеры метрик и пишутся первые логи.
   * @en The very beginning. Metrics timers start and initial logs are written here.
   */
  "START" /**
   * @ru Подготовка запроса. Проверка кэша (чтобы вернуть ответ сразу) или добавление токенов авторизации.
   * @en Request preparation. Checking cache (to return early) or injecting auth tokens.
   */
  | "PREPARE" /**
   * @ru Контроль потока. Управление очередью запросов, лимитами частоты и повторами при ошибках.
   * @en Flow control. Managing request queues, rate limits, and error retries.
   */
  | "CONTROL" /**
   * @ru Форматирование. Превращение объектов в JSON/FormData перед отправкой и парсинг ответов сервера.
   * @en Data formatting. Serializing objects to JSON/FormData before sending and parsing server responses.
   */
  | "FORMAT" /**
   * @ru Отправка. Низкоуровневый fetch, работа через прокси или утилиты обхода (Zapret, Xray).
   * @en Dispatching. Low-level fetch operations, proxy routing, or bypass utilities (Zapret, Xray).
   */
  | "NETWORK";

export interface HyperPlugin<T extends HyperCore = HyperCore> {
  name: string;
  phase: PluginPhase;
  enabled: (config: HttpClientOptions) => boolean;
  apply: (client: HyperCore, config: HttpClientOptions) => T;
}

export interface PluginMetric {
  pluginName: string;
  phase: string;
  inboundMs: number;
  outboundMs: number;
  selfTimeMs: number;
  totalTimeMs: number;
}
