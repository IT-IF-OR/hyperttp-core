import type {
  HyperPlugin,
  PluginContext,
  InternalRequest,
  HttpResponse,
  HyperttpError,
  HttpClientOptions,
} from "@hyperttp/types";

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
  readonly responseSideEffects: HookRecord<
    Required<HyperPlugin>["onResponse"]
  >[];
  readonly error: HookRecord<Required<HyperPlugin>["onError"]>[];
}

/**
 * @ru Создает пустой контейнер для конвейеров плагинов.
 * @en Creates an empty container for plugin pipelines.
 */
export function createPipelines(): PipelineContainer {
  return {
    request: [],
    responseMutators: [],
    responseSideEffects: [],
    error: [],
  };
}

/**
 * @ru Вставляет хук в массив с сохранением сортировки по убыванию приоритета (деревья поиска тут избыточны).
 * @en Inserts a hook into the array maintaining descending priority order.
 */
export function insertHookSorted<T>(
  list: HookRecord<T>[],
  hook: HookRecord<T>,
): void {
  const len = list.length;
  let i = 0;
  while (i < len && list[i]!.priority >= hook.priority) {
    i++;
  }
  list.splice(i, 0, hook);
}

/**
 * @ru Выполняет конвейер пред-запроса. Поддерживает short-circuit (ранний возврат ответа).
 * @en Executes the pre-request pipeline. Supports short-circuiting.
 */
export async function executeRequestPipeline(
  hooks: readonly HookRecord<Required<HyperPlugin>["onRequest"]>[],
  req: InternalRequest,
  ctx: PluginContext,
): Promise<HttpResponse<unknown> | null> {
  const len = hooks.length;
  if (len === 0) return null;

  for (let i = 0; i < len; i++) {
    const shortCircuit = await hooks[i]!.run(req, ctx);
    if (shortCircuit) {
      return shortCircuit;
    }
  }
  return null;
}

/**
 * @ru Выполняет конвейер пост-ответа. Разделен на мутаторы (последовательно) и сайд-эффекты (в фоне).
 * @en Executes the post-response pipeline. Split into mutators (sequential) and side-effects (background).
 */
export async function executeResponsePipeline(
  mutators: readonly HookRecord<Required<HyperPlugin>["onResponse"]>[],
  sideEffects: readonly HookRecord<Required<HyperPlugin>["onResponse"]>[],
  res: HttpResponse<unknown>,
  req: InternalRequest,
  ctx: PluginContext,
  logger?: HttpClientOptions["logger"],
): Promise<void> {
  // 1. Запуск фоновых сайд-эффектов (Background Phase) - Fire and Forget безопасно для основного потока
  const seLen = sideEffects.length;
  if (seLen > 0) {
    for (let i = 0; i < seLen; i++) {
      const effect = sideEffects[i]!;
      try {
        const promise = effect.run(res, req, ctx);
        if (promise && typeof promise.catch === "function") {
          promise.catch((err: unknown) =>
            logger?.(
              "warn",
              `Background hook ${effect.name} crashed: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        }
      } catch (err) {
        logger?.(
          "warn",
          `Sync background hook ${effect.name} crashed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // 2. Запуск мутаторов ответа (Mutator Phase) - Изменяют объект ответа последовательно
  const mutLen = mutators.length;
  if (mutLen > 0) {
    for (let i = 0; i < mutLen; i++) {
      await mutators[i]!.run(res, req, ctx);
    }
  }
}

/**
 * @ru Выполняет конвейер перехвата ошибок. Первый вернувший HttpResponse плагин прерывает панику.
 * @en Executes the error interception pipeline. First plugin to return HttpResponse stops the panic.
 */
export async function executeErrorPipeline(
  hooks: readonly HookRecord<Required<HyperPlugin>["onError"]>[],
  error: HyperttpError,
  req: InternalRequest,
  ctx: PluginContext,
): Promise<HttpResponse<unknown> | null> {
  const len = hooks.length;
  if (len === 0) return null;

  for (let i = 0; i < len; i++) {
    const recovered = await hooks[i]!.run(error, req, ctx);
    if (recovered) {
      return recovered;
    }
  }
  return null;
}
