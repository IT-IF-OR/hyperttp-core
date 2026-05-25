/**
 * @ru Представляет HTTP заголовки запроса
 * @en Represents HTTP request headers
 */
export type RequestHeaders = Record<string, string>;

/**
 * @ru Представляет параметры URL query
 * @en Represents URL query parameters
 */
export type RequestQuery = Record<
  string,
  string | string[] | number | boolean | undefined | null
>;

/**
 * @ru Данные тела запроса
 * @en Request body data
 */
export type RequestBodyData = any | null | undefined;

/**
 * @ru Конфигурация для создания запроса
 * @en Configuration for request creation
 */
export type RequestConfig = {
  /**
   * @ru Схема протокола (http/https)
   * @en Protocol scheme (http/https)
   */
  scheme: string;
  /**
   * @ru Хост сервера
   * @en Server host
   */
  host: string;
  /**
   * @ru Порт сервера
   * @en Server port
   */
  port?: number;
  /**
   * @ru Путь ресурса
   * @en Resource path
   */
  path?: string;
  /**
   * @ru Заголовки запроса
   * @en Request headers
   */
  headers?: RequestHeaders;
  /**
   * @ru Параметры query строки
   * @en Query string parameters
   */
  query?: RequestQuery;
  /**
   * @ru Данные тела запроса
   * @en Request body data
   */
  bodyData?: RequestBodyData;
};

/**
 * @ru Основной интерфейс запроса (Оптимизирован под плоские объекты и скрытые классы V8)
 * @en Main request interface (Optimized for flat objects and V8 hidden classes)
 */
export interface RequestInterface {
  /**
   * @ru Полный URL запроса
   * @en Full request URL
   */
  url: string;

  /**
   * @ru Заголовки запроса
   * @en Request headers
   */
  headers: RequestHeaders;

  /**
   * @ru Данные тела запроса
   * @en Request body data
   */
  body?: RequestBodyData;

  /**
   * @ru Параметры query строки
   * @en Query parameters
   */
  query?: RequestQuery;

  /**
   * @ru AbortSignal для отмены запроса
   * @en AbortSignal for cancellation
   */
  signal?: AbortSignal;

  /**
   * @ru Метаданные запроса (responseType, внутренние флаги плагинов)
   * @en Request metadata (responseType, internal plugin flags)
   */
  meta?: Record<string, any>;
}

/**
 * @ru Метаданные для конвертации ответа
 * @en Response conversion metadata
 */
export interface ConversionMeta {
  /**
   * @ru Content-Type заголовок
   * @en Content-Type header
   */
  contentType?: string;
  /**
   * @ru Content-Encoding заголовок
   * @en Content-Encoding header
   */
  contentEncoding?: string;
  /**
   * @ru URL запроса
   * @en Request URL
   */
  url?: string;
}
