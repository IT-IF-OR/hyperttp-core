import type { HyperProtocol, HyperReceiver, HyperSender, SenderProtocol } from "@hyperttp/types";
/**
 * @ru Известные протоколы ядра: встроенный rest и пакетные модули.
 * @en Known core protocols: the built-in rest and packaged modules.
 */
export declare const KNOWN_PROTOCOLS: readonly SenderProtocol[];
/**
 * @ru Разрешает модуль протокола. Встроенный rest возвращается статически,
 * остальные протоколы загружаются из пакетных модулей по требованию.
 * @en Resolves a protocol module. The built-in rest is returned statically,
 * other protocols are loaded from packaged modules on demand.
 */
export declare function resolveProtocol<P extends SenderProtocol>(protocol: P, options?: {
    [key: string]: unknown;
}): Promise<HyperProtocol<unknown, unknown, unknown, unknown, P>>;
/**
 * @ru Разрешает клиентский сендер протокола.
 * @en Resolves the client sender of a protocol.
 */
export declare function resolveSender<P extends SenderProtocol>(protocol: P, options?: {
    [key: string]: unknown;
}): Promise<HyperSender<unknown, unknown, unknown, unknown, P>>;
/**
 * @ru Разрешает серверный ресивер протокола.
 * @en Resolves the server receiver of a protocol.
 */
export declare function resolveReceiver<P extends SenderProtocol>(protocol: P, options?: {
    [key: string]: unknown;
}): Promise<HyperReceiver<unknown, unknown, unknown, unknown, P>>;
/**
 * @ru Очищает кэш загруженных модулей протоколов. Не выгружает уже импортированные
 * JavaScript-модули из runtime.
 * @en Clears the loaded protocol-module cache. It does not unload JavaScript
 * modules already imported by the runtime.
 */
export declare function resetCachedProtocols(): void;
//# sourceMappingURL=manager.d.ts.map