import type { HttpClientOptions, HyperTransport } from "@hyperttp/types";
/**
 * @ru Поддерживаемые среды выполнения для автоматического выбора транспорта.
 * @en Supported runtime environments for automatic transport selection.
 */
export type Runtime = "bun" | "node" | "deno" | "browser";
/**
 * @ru Описание транспорта: имя, поддерживаемые среды, пакет, экспорт и приоритет.
 * @en Transport descriptor: name, supported runtimes, package, export, and priority.
 */
type TransportDef = {
    /** @ru Имя транспорта для логирования. @en Transport name for logging. */
    name: string;
    /** @ru Список сред, в которых транспорт может работать. @en List of runtimes where the transport can operate. */
    runtime: Runtime[];
    /** @ru Имя пакета npm или относительный путь для встроенных транспортов. @en npm package name or relative path for built-in transports. */
    pkg: string;
    /** @ru Имя экспортируемого класса транспорта. @en Exported transport class name. */
    export: string;
    /** @ru Приоритет выбора (выше значение = раньше попытка загрузки). @en Selection priority (higher value = earlier load attempt). */
    priority: number;
};
export declare const CURRENT_RUNTIME: Runtime;
export declare const TRANSPORTS: TransportDef[];
export declare const runtimeImport: <T = unknown>(specifier: string) => Promise<T>;
export declare function resolveTransport(config: HttpClientOptions): Promise<HyperTransport>;
export declare class TransportManager {
    transport: HyperTransport | null;
    private promise;
    private config;
    constructor(config: HttpClientOptions, custom?: HyperTransport);
    getSync(): HyperTransport | null;
    ensure(): Promise<HyperTransport>;
    get(): HyperTransport | Promise<HyperTransport>;
    setConfig(config: HttpClientOptions): void;
    destroy(graceful?: boolean): Promise<void>;
}
export {};
//# sourceMappingURL=manager.d.ts.map