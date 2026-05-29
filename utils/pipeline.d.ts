import type { HyperPlugin, PluginContext, InternalRequest, HttpResponse, HyperttpError, HttpClientOptions } from "@hyperttp/types";
/**
 * @ru Структура записи хука с метаданными для оптимизации и сортировки.
 * @en Hook record structure with metadata for optimization and sorting.
 */
export interface HookRecord<T> {
    readonly name: string;
    readonly priority: number;
    readonly run: T;
}
export interface PipelineContainer {
    readonly request: HookRecord<Required<HyperPlugin>["onRequest"]>[];
    readonly responseMutators: HookRecord<Required<HyperPlugin>["onResponse"]>[];
    readonly responseSideEffects: HookRecord<Required<HyperPlugin>["onResponse"]>[];
    readonly error: HookRecord<Required<HyperPlugin>["onError"]>[];
}
/**
 * @ru Создает пустой контейнер для конвейеров плагинов.
 * @en Creates an empty container for plugin pipelines.
 */
export declare function createPipelines(): PipelineContainer;
/**
 * @ru Вставляет хук в массив с сохранением сортировки по убыванию приоритета (деревья поиска тут избыточны).
 * @en Inserts a hook into the array maintaining descending priority order.
 */
export declare function insertHookSorted<T>(list: HookRecord<T>[], hook: HookRecord<T>): void;
/**
 * @ru Выполняет конвейер пред-запроса. Поддерживает short-circuit (ранний возврат ответа).
 * @en Executes the pre-request pipeline. Supports short-circuiting.
 */
export declare function executeRequestPipeline(hooks: readonly HookRecord<Required<HyperPlugin>["onRequest"]>[], req: InternalRequest, ctx: PluginContext): Promise<HttpResponse<unknown> | null>;
/**
 * @ru Выполняет конвейер пост-ответа. Разделен на мутаторы (последовательно) и сайд-эффекты (в фоне).
 * @en Executes the post-response pipeline. Split into mutators (sequential) and side-effects (background).
 */
export declare function executeResponsePipeline(mutators: readonly HookRecord<Required<HyperPlugin>["onResponse"]>[], sideEffects: readonly HookRecord<Required<HyperPlugin>["onResponse"]>[], res: HttpResponse<unknown>, req: InternalRequest, ctx: PluginContext, logger?: HttpClientOptions["logger"]): Promise<void>;
/**
 * @ru Выполняет конвейер перехвата ошибок. Первый вернувший HttpResponse плагин прерывает панику.
 * @en Executes the error interception pipeline. First plugin to return HttpResponse stops the panic.
 */
export declare function executeErrorPipeline(hooks: readonly HookRecord<Required<HyperPlugin>["onError"]>[], error: HyperttpError, req: InternalRequest, ctx: PluginContext): Promise<HttpResponse<unknown> | null>;
//# sourceMappingURL=pipeline.d.ts.map