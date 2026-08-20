/**
 * @ru Базовый класс ошибок клиента Hyperttp, агрегирующий контекст неудачного сетевого запроса.
 * @en Base error class for the Hyperttp client, providing explicit layout context for failed requests.
 */
export class HyperClientError extends Error {
  /**
   * @ru Создает новый экземпляр HttpClientError.
   * @en Creates a new HttpClientError instance.
   */
  constructor(
    message: string,
    public code: string = "HYPER_ERROR",
    public statusCode?: number,
    public originalError?: Error,
    public url?: string,
    public method?: string,
  ) {
    super(message, originalError ? { cause: originalError } : undefined);
    this.name = "HyperClientError";
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * @ru Проверяет, является ли ошибка экземпляром HttpClientError (безопасно для разрозненных бандлов).
   * @en Checks if an error is an HttpClientError instance (bundle boundary safe).
   */
  public static isHyperClientError(err: unknown): err is HyperClientError {
    return (
      err instanceof HyperClientError ||
      (err instanceof Error && (err as any).code === "HYPER_ERROR")
    );
  }
}

/**
 * @ru Ошибка, возникающая при превышении лимита времени ожидания ответа от сервера.
 * @en Error thrown when a network request exceeds its allocated execution timeout threshold.
 */
export class TimeoutError extends HyperClientError {
  /**
   * @ru Создает новый экземпляр TimeoutError.
   * @en Creates a new TimeoutError instance.
   */
  constructor(url: string, timeout: number) {
    super(`Timeout after ${timeout}ms`, "TIMEOUT", 408, undefined, url);
    this.name = "TimeoutError";
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * @ru Проверяет, является ли ошибка экземпляром TimeoutError.
   * @en Checks if an error is a TimeoutError instance.
   */
  public static isTimeoutError(err: unknown): err is TimeoutError {
    return err instanceof TimeoutError || (err instanceof Error && (err as any).code === "TIMEOUT");
  }
}
