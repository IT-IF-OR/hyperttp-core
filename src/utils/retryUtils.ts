import type { RetryOptions } from "@hyperttp/types";

/**
 * @ru Коды статуса HTTP, по которым повторные попытки выполняются по умолчанию.
 * @en Default HTTP status codes that trigger retries when no explicit codes are provided.
 */
const DEFAULT_RETRY_STATUS_CODES = new Set<number>([502, 503, 504]);

/**
 * @ru Вычисляет задержку перед повторной попыткой с экспоненциальной задержкой и возможным джиттером.
 * @en Calculates the delay before a retry using exponential backoff and optional jitter.
 */
export function calcDelay(attempt: number, retryOptions: RetryOptions): number {
  const { baseDelay = 1000, maxDelay = 10000, jitter = true } = retryOptions;
  const safeAttempt = Math.min(attempt, 31);
  const base = Math.min(baseDelay * Math.pow(2, safeAttempt), maxDelay);
  if (!jitter) return base;
  const jittered = base * (0.75 + Math.random() * 0.5);
  return Math.min(Math.max(0, jittered), maxDelay);
}

/**
 * @ru Пытается освободить ресурсы тела ответа, не дожидаясь полного потребления. Поддерживает методы dump, resume, destroy.
 * @en Attempts to release response body resources without fully consuming it. Supports dump, resume, destroy methods.
 */
export async function drainBody(body: unknown): Promise<void> {
  if (!body || typeof body !== "object") return;
  try {
    const stream = body as Record<string, unknown>;

    if (typeof stream.dump === "function") {
      await (stream.dump as () => Promise<void>)();
      return;
    }

    if (typeof stream.destroy === "function") {
      (stream.destroy as () => void)();
      return;
    }

    if (typeof stream.resume === "function") {
      (stream.resume as () => void)();
    }
  } catch {
    //
  }
}

/**
 * @ru Определяет, следует ли выполнить повторную попытку для данного кода статуса на основе настроек.
 * @en Determines whether to retry for the given status code based on retry options.
 */
export function shouldRetry(status: number, retryOptions: RetryOptions): boolean {
  const codes = retryOptions.retryStatusCodes;
  if (codes !== undefined && codes.length > 0) {
    return codes.includes(status);
  }
  return DEFAULT_RETRY_STATUS_CODES.has(status);
}
