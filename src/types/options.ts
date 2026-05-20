import type { LogLevel } from "./http.js";
import type { NetworkOptions } from "./network.js";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface HyperttpPluginsExtension {}

/**
 * @ru Базовые настройки HTTP-клиента, входящие в состав основного ядра.
 * @en Core HTTP client configuration options always available in the engine.
 */
export interface BaseHttpClientOptions {
  /**
   * @ru Базовые настройки сети (таймауты, заголовки, keep-alive)
   * @en Base network configuration (timeouts, headers, keep-alive)
   */
  network?: Partial<NetworkOptions>;

  /**
   * @ru Кастомная функция логирования работы клиента
   * @en Custom logging function for client operations
   * @param level - @ru Уровень логирования @en Log level
   * @param message - @ru Текст лога @en Log message
   * @param meta - @ru Дополнительные метаданные @en Additional metadata
   */
  logger?: (level: LogLevel, message: string, meta?: unknown) => void;

  /**
   * @ru Режим подробного (verbose) логирования в консоль
   * @en Enable verbose logging output to the console
   */
  verbose?: boolean;

  /**
   * @ru Список путей к папкам для автоматического сканирования и ленивой загрузки локальных плагинов
   * @en List of directory paths for automatic scanning and lazy loading of local plugins
   */
  pluginDirs?: string[];

  /**
   * @ru Список явно подключенных плагинов (готовые объекты или строки с именами npm-пакетов)
   * @en List of explicitly registered plugins (direct objects or npm package name strings)
   */
  plugins?: any[];

  trackMetrics?: any;
}

export type HttpClientOptions = BaseHttpClientOptions &
  HyperttpPluginsExtension;
