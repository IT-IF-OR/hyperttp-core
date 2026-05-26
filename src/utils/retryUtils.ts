import type { RetryOptions } from "@hyperttp/types";

const DEFAULT_RETRY_STATUS_CODES = [502, 503, 504];

export function calcDelay(attempt: number, retryOptions: RetryOptions): number {
  const { baseDelay = 1000, maxDelay = 10000, jitter = true } = retryOptions;

  const base = Math.min(baseDelay * 2 ** attempt, maxDelay);
  return jitter ? base * (0.75 + Math.random() * 0.5) : base;
}

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
