/**
 * @ru Создаёт AbortSignal с тайм-аутом и привязкой к пользовательскому сигналу отмены.
 * @en Creates an AbortSignal with timeout and user abort signal binding.
 * @param userSignal - Optional external abort signal.
 * @param timeoutMs - Timeout in milliseconds.
 * @param meta - Metadata object receiving the cleanup function.
 * @returns AbortSignal bound to the timeout and user signal.
 */
export declare function createTimeoutSignal(userSignal: AbortSignal | undefined, timeoutMs: number, meta: {
    cleanupSignal?: () => void;
}, timeoutReason?: unknown | (() => unknown)): AbortSignal;
/**
 * @ru Применяет тайм-аут к сигналу отмены.
 * @en Applies a timeout to the abort signal.
 * @param signal - Optional external abort signal.
 * @param timeout - Timeout in milliseconds (skip if null/<=0).
 * @param meta - Metadata object receiving the cleanup function.
 * @returns New abort signal with timeout, or the original signal.
 */
export declare function applyTimeout(signal: AbortSignal | undefined, timeout: number | undefined, meta: {
    cleanupSignal?: () => void;
}, timeoutReason?: unknown | (() => unknown)): AbortSignal | undefined;
//# sourceMappingURL=abort.d.ts.map