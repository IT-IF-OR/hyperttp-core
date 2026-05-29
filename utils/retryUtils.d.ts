import type { RetryOptions } from "@hyperttp/types";
export declare function calcDelay(attempt: number, retryOptions: RetryOptions): number;
export declare function drainBody(body: unknown): Promise<void>;
export declare function shouldRetry(status: number, retryOptions: RetryOptions): boolean;
//# sourceMappingURL=retryUtils.d.ts.map