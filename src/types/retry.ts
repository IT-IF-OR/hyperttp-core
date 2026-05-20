export interface RetryOptions {
  /**
   * @ru Максимальное количество повторных попыток
   * @en Maximum number of retry attempts
   */
  maxRetries?: number;

  /**
   * @ru Базовая задержка между попытками (мс)
   * @en Base delay between retries (ms)
   */
  baseDelay?: number;

  /**
   * @ru Максимальная задержка между попытками (мс)
   * @en Maximum retry delay (ms)
   */
  maxDelay?: number;

  /**
   * @ru Коды HTTP, при которых выполняется retry
   * @en HTTP status codes that trigger retry logic
   */
  retryStatusCodes?: readonly number[];

  /**
   * @ru Добавлять случайный jitter к задержке
   * @en Add randomness (jitter) to retry delay
   */
  jitter?: boolean;
}
