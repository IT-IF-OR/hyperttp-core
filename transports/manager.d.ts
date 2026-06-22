import type { HttpClientOptions, HyperTransport } from "@hyperttp/types";
/**
 * @ru Поддерживаемые среды выполнения для автоматического выбора транспорта.
 * @en Supported runtime environments for automatic transport selection.
 */
export type Runtime = "bun" | "node" | "deno" | "browser";
/**
 * @ru Определяет текущую среду выполнения при загрузке модуля.
 * Порядок проверки: Bun → Deno → Node.js → Browser.
 * @en Detects the current runtime at module load time.
 * Detection order: Bun → Deno → Node.js → Browser.
 */
export declare const CURRENT_RUNTIME: Runtime;
/**
 * @ru Разрешает и создаёт оптимальный транспорт для текущей среды.
 * Перебирает кандидатов по приоритету, кэширует первый успешный результат.
 * @en Resolves and creates the optimal transport for the current runtime.
 * Iterates candidates by priority, caches the first successful result.
 * @param config - Client configuration options.
 * @returns Promise resolving to the instantiated transport.
 * @throws Error if no compatible transport is found.
 */
export declare function resolveTransport(config: HttpClientOptions): Promise<HyperTransport>;
/**
 * @ru Менеджер транспорта с ленивой инициализацией и кэшированием.
 * Поддерживает синхронный доступ, отложенную инициализацию и корректное завершение.
 * @en Transport manager with lazy initialization and caching.
 * Supports synchronous access, deferred initialization, and graceful shutdown.
 */
export declare class TransportManager {
    /**
     * @ru Текущий экземпляр транспорта (null до инициализации).
     * @en Current transport instance (null before initialization).
     */
    transport: HyperTransport | null;
    /**
     * @ru Промис отложенной инициализации транспорта.
     * @en Deferred transport initialization promise.
     */
    private promise;
    /**
     * @ru Конфигурация клиента для создания транспорта.
     * @en Client configuration for transport creation.
     */
    private config;
    /**
     * @ru Создаёт менеджер транспорта с опциональным пользовательским транспортом.
     * @en Creates a transport manager with an optional custom transport.
     * @param config - Client configuration options.
     * @param custom - Optional custom transport instance.
     */
    constructor(config: HttpClientOptions, custom?: HyperTransport);
    /**
     * @ru Синхронно возвращает текущий транспорт или null, если не инициализирован.
     * @en Synchronously returns the current transport or null if not initialized.
     * @returns The transport instance or null.
     */
    getSync(): HyperTransport | null;
    /**
     * @ru Гарантирует наличие транспорта, инициализируя его при необходимости.
     * Повторные вызовы возвращают один и тот же промис.
     * @en Ensures a transport exists, initializing it if necessary.
     * Repeated calls return the same promise.
     * @returns Promise resolving to the transport instance.
     */
    ensure(): Promise<HyperTransport>;
    /**
     * @ru Возвращает транспорт синхронно или промис, если требуется инициализация.
     * @en Returns the transport synchronously or a promise if initialization is needed.
     * @returns The transport instance or a promise resolving to it.
     */
    get(): HyperTransport | Promise<HyperTransport>;
    /**
     * @ru Обновляет конфигурацию транспорта, если он поддерживает setConfig.
     * @en Updates the transport configuration if it supports setConfig.
     * @param config - New client configuration options.
     */
    setConfig(config: HttpClientOptions): void;
    /**
     * @ru Завершает работу транспорта и освобождает ресурсы.
     * В graceful-режиме вызывает close(), иначе — destroy().
     * @en Shuts down the transport and releases resources.
     * In graceful mode calls close(), otherwise calls destroy().
     * @param graceful - If true, waits for active requests to complete.
     * @returns Promise that resolves when shutdown is complete.
     */
    destroy(graceful?: boolean): Promise<void>;
}
//# sourceMappingURL=manager.d.ts.map