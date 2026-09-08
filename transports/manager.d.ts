import type { HyperTransport, LogLevel, SenderProtocol } from "@hyperttp/types";
export type Runtime = "bun" | "node" | "deno" | "browser";
/**
 * @ru Опции разрешения транспорта. `customTransport` имеет приоритет над автовыбором.
 * @en Transport resolution options. `customTransport` takes priority over auto-selection.
 */
export interface ResolveTransportOptions {
    customTransport?: HyperTransport;
    logger?: (level: LogLevel, message: string, meta?: unknown) => void;
    verbose?: boolean;
    [key: string]: unknown;
}
export declare const CURRENT_RUNTIME: Runtime;
/**
 * @ru Разрешает оптимальный транспорт для указанного протокола и текущей среды.
 * Кастомный транспорт из конфигурации имеет приоритет над автовыбором.
 * @en Resolves optimal transport for the given protocol and current runtime.
 * A custom transport from the config takes priority over auto-selection.
 */
export declare function resolveTransport(protocol?: SenderProtocol, config?: ResolveTransportOptions): Promise<HyperTransport>;
/**
 * @ru Синхронно возвращает транспорт из кэша без создания Promise.
 * @en Synchronously returns a cached transport without creating a Promise.
 * @param protocol - Протокол, для которого запрашивается транспорт. @en Protocol whose transport is requested.
 * @returns Кэшированный транспорт или `undefined`. @en Cached transport or `undefined`.
 */
export declare function getCachedTransport(protocol?: SenderProtocol): HyperTransport | undefined;
/**
 * @ru Удаляет все записи кэша, ссылающиеся на указанный транспорт.
 * @en Removes every cache entry that references the given transport.
 * @param transport - Экземпляр транспорта для удаления из кэша. @en Transport instance to evict from the cache.
 */
export declare function evictCachedTransport(transport: HyperTransport): void;
/**
 * @ru Очищает кэш транспортов и ожидающих их разрешений. Не закрывает уже
 * созданные экземпляры транспорта.
 * @en Clears cached transports and pending resolutions. It does not close
 * already-created transport instances.
 */
export declare function resetCachedTransport(): void;
//# sourceMappingURL=manager.d.ts.map