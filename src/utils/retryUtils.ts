import type { RetryOptions } from "@hyperttp/types";

/**
 * @ru Коды статуса HTTP, по которым повторные попытки выполняются по умолчанию, если не указаны явные коды в retryOptions.
 * @en Default HTTP status codes that trigger retries when no explicit codes are provided in retryOptions.
 */
const DEFAULT_RETRY_STATUS_CODES = [502, 503, 504];

/**
 * @ru Вычисляет задержку перед повторной попыткой с экспоненциальной задержкой и возможным джиттером.
 * @en Calculates the delay before a retry using exponential backoff and optional jitter.
 * @param attempt - Attempt number (starting from 0).
 * @param retryOptions - Options controlling retry behavior (baseDelay, maxDelay, jitter).
 * @returns Delay in milliseconds.
 */
export function calcDelay(attempt: number, retryOptions: RetryOptions): number {
  const { baseDelay = 1000, maxDelay = 10000, jitter = true } = retryOptions;

  const base = Math.min(baseDelay * 2 ** attempt, maxDelay);
  return jitter ? base * (0.75 + Math.random() * 0.5) : base;
}

/**
 * @ru Пытается освободить ресурсы тела ответа, не дожидаясь полного потребления. Поддерживает методы dump, resume, destroy.
 * @en Attempts to release response body resources without fully consuming it. Supports dump, resume, destroy methods.
 * @param body - Response body (ReadableStream, Node.js Stream, or similar).
 * @returns Promise that resolves after resource disposal is complete.
 */
export async function drainBody(body: unknown): Promise<void> {
  if (!body || typeof body !== "object") return;

  try {
    const stream = body as Record<string, unknown>;

    if (typeof stream.dump === "function") {
      await (stream.dump as () => Promise<void>)();
      return;
    }

    if (typeof stream.resume === "function") {
      (stream.resume as () => void)();
      return;
    }

    if (typeof stream.destroy === "function") {
      (stream.destroy as () => void)();
    }
  } catch {
    //
  }
}

/**
 * @ru Определяет, следует ли выполнить повторную попытку для данного кода статуса на основе настроек. Если retryStatusCodes не указаны, используется DEFAULT_RETRY_STATUS_CODES.
 * @en Determines whether to retry for the given status code based on retry options. If retryStatusCodes is not provided, uses DEFAULT_RETRY_STATUS_CODES.
 * @param status - HTTP status code.
 * @param retryOptions - Options controlling retry behavior, may include retryStatusCodes.
 * @returns True if the request should be retried.
 */
export function shouldRetry(
  status: number,
  retryOptions: RetryOptions,
): boolean {
  const codes = retryOptions.retryStatusCodes;

  if (codes && codes.length > 0) {
    return codes.includes(status);
  }

  return DEFAULT_RETRY_STATUS_CODES.includes(status);
}
