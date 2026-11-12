import type { HyperProtocol, HyperReceiver, HyperSender, HyperProtocolName } from "@hyperttp/types";
/**
 * @ru Известные опциональные пакетные протоколы.
 * @en Known optional packaged protocols.
 */
export declare const KNOWN_PROTOCOLS: readonly HyperProtocolName[];
/**
 * @ru Разрешает опциональный пакетный модуль протокола.
 * @en Resolves an optional packaged protocol module.
 */
export declare function resolveProtocol<P extends HyperProtocolName>(protocol: P, options?: {
    [key: string]: unknown;
}): Promise<HyperProtocol<unknown, unknown, unknown, unknown, P>>;
/**
 * @ru Разрешает клиентский сендер протокола.
 * @en Resolves the client sender of a protocol.
 */
export declare function resolveSender<P extends HyperProtocolName>(protocol: P, options?: {
    [key: string]: unknown;
}): Promise<HyperSender<unknown, unknown, unknown, unknown, P>>;
/**
 * @ru Разрешает серверный ресивер протокола.
 * @en Resolves the server receiver of a protocol.
 */
export declare function resolveReceiver<P extends HyperProtocolName>(protocol: P, options?: {
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