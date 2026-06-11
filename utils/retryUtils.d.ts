import type { RetryOptions } from "@hyperttp/types";
/**
 * @ru Вычисляет задержку перед повторной попыткой с экспоненциальной задержкой и возможным джиттером.
 * @en Calculates the delay before a retry using exponential backoff and optional jitter.
 */
export declare function calcDelay(attempt: number, retryOptions: RetryOptions): number;
/**
 * @ru Пытается освободить ресурсы тела ответа, не дожидаясь полного потребления. Поддерживает методы dump, resume, destroy.
 * @en Attempts to release response body resources without fully consuming it. Supports dump, resume, destroy methods.
 */
export declare function drainBody(body: unknown): Promise<void>;
/**
 * @ru Определяет, следует ли выполнить повторную попытку для данного кода статуса на основе настроек.
 * @en Determines whether to retry for the given status code based on retry options.
 */
export declare function shouldRetry(status: number, retryOptions: RetryOptions): boolean;
//# sourceMappingURL=retryUtils.d.ts.map