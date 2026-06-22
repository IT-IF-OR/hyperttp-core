import type { HyperPlugin, PluginContext, InternalRequest, HttpResponse, HyperttpError, HttpClientOptions, TransportResponse } from "@hyperttp/types";
/**
 * @ru Структура записи хука с метаданными для оптимизации и сортировки.
 * @en Hook record structure with metadata for optimization and sorting.
 */
export interface HookRecord<T> {
    /** @ru Уникальное имя хука. @en Unique hook name. */
    readonly name: string;
    /** @ru Приоритет выполнения (выше значение — раньше выполнение). @en Execution priority (higher value runs earlier). */
    readonly priority: number;
    /** @ru Функция-обработчик. @en Handler function. */
    readonly run: T;
}
/**
 * @ru Контейнер конвейеров для различных фаз обработки запроса/ответа.
 * @en Pipeline container for different request/response processing phases.
 */
export interface PipelineContainer {
    /** @ru Хуки, выполняемые перед отправкой запроса. @en Hooks executed before sending the request. */
    readonly request: HookRecord<Required<HyperPlugin>["onRequest"]>[];
    /** @ru Хуки, обрабатывающие сырые данные транспорта. @en Hooks processing raw transport data. */
    readonly responseData: HookRecord<Required<HyperPlugin>["onResponseData"]>[];
    /** @ru Хуки, мутирующие ответ (последовательное выполнение). @en Hooks that mutate the response (sequential execution). */
    readonly responseMutators: HookRecord<Required<HyperPlugin>["onResponse"]>[];
    /** @ru Хуки с побочными эффектами (выполняются в фоне). @en Side-effect hooks (executed in the background). */
    readonly responseSideEffects: HookRecord<Required<HyperPlugin>["onResponse"]>[];
    /** @ru Хуки для перехвата ошибок. @en Error interception hooks. */
    readonly error: HookRecord<Required<HyperPlugin>["onError"]>[];
}
/**
 * @ru Создаёт пустой контейнер для конвейеров плагинов.
 * @en Creates an empty container for plugin pipelines.
 * @returns An empty pipeline container.
 */
export declare function createPipelines(): PipelineContainer;
/**
 * @ru Вставляет хук в массив с сохранением сортировки по убыванию приоритета (деревья поиска тут избыточны).
 * @en Inserts a hook into the array maintaining descending priority order.
 * @param list - Target array to insert into.
 * @param hook - Hook record to insert.
 */
export declare function insertHookSorted<T>(list: HookRecord<T>[], hook: HookRecord<T>): void;
/**
 * @ru Выполняет конвейер пред-запроса. Поддерживает short-circuit.
 * @en Executes the pre-request pipeline. Supports short-circuiting.
 */
export declare function executeRequestPipeline(hooks: readonly HookRecord<Required<HyperPlugin>["onRequest"]>[], req: InternalRequest, ctx: PluginContext): Promise<HttpResponse<unknown> | null> | HttpResponse<unknown> | null;
/**
 * @ru Выполняет низкоуровневый конвейер трансформации сырых данных транспорта (фаза DATA).
 * @en Executes low-level transport data transformation pipeline (DATA phase).
 */
export declare function executeResponseDataPipeline(hooks: readonly HookRecord<Required<HyperPlugin>["onResponseData"]>[], res: TransportResponse, ctx: PluginContext): Promise<TransportResponse> | TransportResponse;
/**
 * @ru Выполняет конвейер пост-ответа. Разделен на мутаторы и сайд-эффекты.
 * @en Executes the post-response pipeline. Split into mutators and side-effects.
 */
export declare function executeResponsePipeline(mutators: readonly HookRecord<Required<HyperPlugin>["onResponse"]>[], sideEffects: readonly HookRecord<Required<HyperPlugin>["onResponse"]>[], res: HttpResponse<unknown>, req: InternalRequest, ctx: PluginContext, logger?: HttpClientOptions["logger"]): Promise<void> | void;
/**
 * @ru Выполняет конвейер перехвата ошибок.
 * @en Executes the error interception pipeline.
 */
export declare function executeErrorPipeline(hooks: readonly HookRecord<Required<HyperPlugin>["onError"]>[], error: HyperttpError, req: InternalRequest, ctx: PluginContext): Promise<HttpResponse<unknown> | null> | HttpResponse<unknown> | null;
//# sourceMappingURL=pipeline.d.ts.map