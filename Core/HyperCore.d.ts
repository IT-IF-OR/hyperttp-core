import type { AnyHyperSender, HyperClientOptions, HyperPlugin, HyperProtocol, HyperProtocols, HyperReceiver, HyperSender, HyperServerListenOptions, HyperTransport, IHyperCore, SenderProtocol, SendRequest, TransportServer, UniversalResponse } from "@hyperttp/types";
export interface HyperCore extends HyperProtocols {
}
/**
 * @ru Универсальное ядро v2.0.0. Протокол-независимый диспетчер: регистрирует
 * единые модули протоколов (Sender + Receiver), выполняет клиентский цикл
 * prepare → send → parse и серверный цикл receive → handle → respond через
 * физический транспорт, а также прогоняет хуки плагинов.
 * @en Universal core v2.0.0. Protocol-agnostic dispatcher: registers unified
 * protocol modules (Sender + Receiver), runs the client cycle prepare → send → parse
 * and the server cycle receive → handle → respond through the physical transport,
 * and executes plugin hooks.
 */
export declare class HyperCore implements IHyperCore {
    readonly config: HyperClientOptions;
    private readonly registry;
    private readonly pluginCtx;
    private plugins;
    private readonly servers;
    private readonly protocolNamespaces;
    private readonly generatedFlatMethods;
    private readonly transportPromises;
    private readonly transports;
    private readonly retainedTransports;
    private readonly fixedTransport;
    private destroyPromise;
    private isDestroyed;
    constructor(config?: Partial<HyperClientOptions>, transport?: HyperTransport, sharedTransportPromises?: ReadonlyMap<SenderProtocol, Promise<HyperTransport>>);
    /**
     * @ru Получает зарегистрированный модуль протокола (Sender + Receiver).
     * @en Gets a registered protocol module (Sender + Receiver).
     */
    getProtocol<P extends SenderProtocol>(protocol: P): HyperProtocol<unknown, unknown, unknown, unknown, P> | undefined;
    /**
     * @ru Получает зарегистрированный сендер протокола.
     * @en Gets a registered protocol sender.
     */
    getSender<P extends SenderProtocol>(protocol: P): HyperSender<unknown, unknown, unknown, unknown, P> | undefined;
    /**
     * @ru Получает зарегистрированный ресивер протокола.
     * @en Gets a registered protocol receiver.
     */
    getReceiver<P extends SenderProtocol>(protocol: P): HyperReceiver<unknown, unknown, unknown, unknown, P> | undefined;
    /**
     * @ru Возвращает имя текущего транспорта.
     * @en Returns the name of the current transport.
     * @returns Transport constructor name.
     */
    getTransportName(): Promise<string>;
    /**
     * @ru Возвращает имя сендера протокола (по умолчанию — "rest").
     * Протокол резолвится лениво, если ещё не зарегистрирован.
     * @en Returns the sender constructor name for a protocol (default "rest").
     * The protocol is resolved lazily if not registered yet.
     * @param protocol - The protocol to inspect.
     * @returns Sender constructor name.
     */
    getSenderName(protocol?: SenderProtocol): Promise<string>;
    /**
     * @ru Возвращает имя ресивера протокола (по умолчанию — "rest").
     * Протокол резолвится лениво, если ещё не зарегистрирован.
     * @en Returns the receiver constructor name for a protocol (default "rest").
     * The protocol is resolved lazily if not registered yet.
     * @param protocol - The protocol to inspect.
     * @returns Receiver constructor name.
     */
    getReceiverName(protocol?: SenderProtocol): Promise<string>;
    /**
     * @ru Возвращает имя модуля протокола (по умолчанию — "rest"): предпочитает
     * `name`, затем `constructor.name`, затем идентификатор протокола.
     * Протокол резолвится лениво, если ещё не зарегистрирован.
     * @en Returns the protocol module name (default "rest"): prefers `name`, then
     * `constructor.name`, then the protocol identifier.
     * The protocol is resolved lazily if not registered yet.
     * @param protocol - The protocol to inspect.
     * @returns The protocol module display name.
     */
    getProtocolName(protocol?: SenderProtocol): Promise<string>;
    /**
     * @ru Регистрирует единый модуль протокола и раскрывает методы его сендера
     * на ядре (например, `core.rest` для REST).
     * @en Registers a unified protocol module and exposes its sender methods on the
     * core (e.g., `core.rest` for REST).
     * @param protocol - The protocol module to register.
     * @returns This instance for chaining.
     */
    registerProtocol<P extends SenderProtocol>(protocol: HyperProtocol<unknown, unknown, unknown, unknown, P>): this;
    /**
     * @ru Регистрирует сендер протокола, оборачивая его в модуль протокола.
     * Существующий ресивер того же протокола сохраняется.
     * @en Registers a protocol sender, wrapping it into a protocol module.
     * An existing receiver for the same protocol is preserved.
     * @param sender - The protocol sender to register.
     * @returns This instance for chaining.
     */
    registerSender<P extends SenderProtocol>(sender: AnyHyperSender<P>): this;
    /**
     * @ru Регистрирует ресивер протокола, оборачивая его в модуль протокола.
     * Существующий сендер того же протокола сохраняется.
     * @en Registers a protocol receiver, wrapping it into a protocol module.
     * An existing sender for the same protocol is preserved.
     * @param receiver - The protocol receiver to register.
     * @returns This instance for chaining.
     */
    registerReceiver<P extends SenderProtocol>(receiver: HyperReceiver<unknown, unknown, unknown, unknown, P>): this;
    /**
     * @ru Создаёт ленивый namespace методов протокола: методы доступны ещё до
     * регистрации протокола и резолвятся по требованию при первом вызове.
     * @en Creates a lazy protocol methods namespace: methods are reachable before
     * the protocol is registered and are resolved on first call.
     * @param protocol - The protocol to expose lazily.
     * @returns A Proxy that dispatches method calls to the resolved protocol sender.
     */
    private createLazyNamespace;
    /**
     * @ru Разрешает протокол по требованию и вызывает метод `methods`-поверхности
     * его сендера, биндя ядро первым аргументом.
     * @en Resolves the protocol on demand and calls a method on its sender
     * `methods` surface, binding the core as the first argument.
     * @param protocol - The protocol identifier.
     * @param name - The method name on the sender surface.
     * @param args - Arguments forwarded after the core instance.
     * @returns The result of the sender method call.
     */
    private dispatchLazyMethod;
    /**
     * @ru Основной метод диспетчеризации: выбирает сендер по протоколу и выполняет
     * трёхфазный цикл с поддержкой плагинов.
     * @en Main dispatch method: resolves the sender by protocol and runs the three-phase
     * cycle with plugin support.
     * @param req - The universal request envelope.
     * @returns A promise resolving to the normalized universal response.
     */
    send<TInput = unknown, TOutput = unknown, P extends string = string>(req: SendRequest<TInput, P>): Promise<UniversalResponse<TOutput>>;
    private resolveRequestSender;
    private runResponseHooks;
    private reportBackgroundPluginError;
    private log;
    /**
     * @ru Атомарно получает транспорт для конкретного протокола и удерживает
     * каждый физический экземпляр ровно один раз за время жизни ядра.
     * @en Atomically acquires a transport for a protocol and retains each physical
     * instance exactly once for the lifetime of this core.
     */
    private acquireTransport;
    private resolveAndRetainTransport;
    private retainResolvedTransport;
    /**
     * @ru Выполняет ядро цикла запроса: prepare → send → parse через физический
     * транспорт. Транспорт получается через `acquireTransport()`.
     * @en Runs the core request cycle: prepare → send → parse through the physical
     * transport. The transport is acquired via `acquireTransport()`.
     * @param sender - The resolved protocol sender.
     * @param req - The (possibly plugin-modified) universal request.
     * @param ctx - The per-request execution context.
     * @returns The normalized universal response.
     */
    private runSender;
    /**
     * @ru Запускает сервер для указанного протокола: связывает транспорт, ресивер и
     * application handler в цепочку receive → handle → respond.
     * @en Starts a server for the given protocol, wiring transport, receiver, and
     * application handler into the receive → handle → respond pipeline.
     * @template P - The protocol identifier.
     * @param options - The server listen options.
     * @returns A promise resolving to the transport server handle.
     */
    listen<P extends SenderProtocol = SenderProtocol>(options: HyperServerListenOptions<P>): Promise<TransportServer>;
    /**
     * @ru Регистрирует плагин. Пропускает отключённые плагины.
     * @en Registers a plugin. Skips disabled plugins.
     * @param plugin - The plugin instance to register.
     * @returns This instance for chaining.
     */
    /**
     * Creates a core asynchronously and resolves plugin module paths before construction.
     */
    static create(config?: Partial<HyperClientOptions>): Promise<HyperCore>;
    use(plugin: HyperPlugin): this;
    /**
     * @ru Создаёт новый экземпляр ядра с расширенной/переопределённой конфигурацией,
     * переиспользуя текущий транспорт.
     * @en Creates a new core instance with extended/overridden configuration,
     * reusing the current transport.
     * @param options - Partial configuration overrides.
     * @returns A new IHyperCore instance.
     */
    extend(options: Partial<HyperClientOptions>): IHyperCore;
    /**
     * @ru Создаёт полностью независимый экземпляр ядра на основе текущей
     * конфигурации: не переиспользует текущий транспорт и по умолчанию не
     * наследует `customTransport`.
     * @en Creates a fully independent core instance based on the current config:
     * it does not reuse the current transport and does not inherit
     * `customTransport` by default.
     * @param options - Partial configuration overrides.
     * @returns A new IHyperCore instance.
     */
    create(options: Partial<HyperClientOptions>): IHyperCore;
    /**
     * @ru Завершает работу ядра и освобождает ресурсы: закрывает активные серверы,
     * затем освобождает удержание транспорта. Graceful-дренирование активных запросов
     * определяется реализацией `TransportServer.close()`.
     * @en Shuts down the core and releases resources: closes active servers, then
     * releases the transport hold. Graceful draining of in-flight requests is defined
     * by the `TransportServer.close()` implementation.
     * @param graceful - If true, prefers `transport.close()`; otherwise prefers `transport.destroy()`.
     * @returns Promise that resolves when shutdown is complete.
     */
    destroy(graceful?: boolean): Promise<void>;
    private performDestroy;
}
//# sourceMappingURL=HyperCore.d.ts.map