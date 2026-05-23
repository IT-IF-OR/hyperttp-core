import type { HttpClientOptions } from "./options.js";
import type { HttpResponse, InternalRequest } from "./hyper.js";

/**
 * Фазы жизненного цикла, определяющие строгий порядок выполнения в "луковичной" (onion) архитектуре.
 * Запрос движется снаружи внутрь: от мониторинга к сети (START -> PREPARE -> CONTROL -> FORMAT -> NETWORK).
 * Ответ возвращается в обратном порядке: изнутри наружу (NETWORK -> FORMAT -> CONTROL -> PREPARE -> START).
 */
export type PluginPhase =
  | "START" // Метрики, логирование, трассировка (самый внешний слой)
  | "PREPARE" // Кэширование, дедупликация (могут вернуть ответ сразу, минуя сеть)
  | "CONTROL" // Rate-limiting, очереди коннектов, менеджмент инфлайт-запросов
  | "FORMAT" // Сериализация тела запроса, парсинг ответов (JSON, XML, HTML)
  | "NETWORK"; // Чистый сетевой транспорт ядра (самый глубокий слой)

/**
 * Сигнатура функции диспетчеризации запроса.
 */
export type DispatchFn = <T = unknown>(
  req: InternalRequest,
) => Promise<HttpResponse<T>>;

/**
 * Функция-обертка (декоратор) для диспетчера.
 * Принимает ссылку на следующий слой луковицы (`next`) и контекст клиента.
 */
export type WrapDispatch = (
  next: DispatchFn,
  ctx: { config: HttpClientOptions; core: any }, // core передаем для доступа к низкоуровневым методам вроде destroy
) => DispatchFn;

/**
 * Единый интерфейс для создания плагинов Hyperttp.
 * Любой внешний пакет (cache, metrics) обязан реализовать этот контракт.
 */
export interface HyperPlugin {
  /** Уникальное имя плагина для логирования и предотвращения дублирования */
  name: string;

  /** Фаза, определяющая место плагина в конвейере выполнения */
  phase: PluginPhase;

  /** Динамическая проверка: должен ли плагин активироваться на основе переданного конфига */
  enabled: (config: HttpClientOptions) => boolean;

  /**
   * Хук инициализации. Вызывается один раз при создании клиента.
   * Здесь плагин может безопасно расширять методы ядра или вешать подписки.
   */
  setup?: (core: any, config: HttpClientOptions) => void;

  /**
   * Чистая функция-обертка для конвейера запросов.
   * Больше никаких побочных эффектов внутри!
   */
  wrapDispatch?: WrapDispatch;
}
