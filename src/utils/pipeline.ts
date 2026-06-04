import type {
  HyperPlugin,
  PluginContext,
  InternalRequest,
  HttpResponse,
  HyperttpError,
  HttpClientOptions,
  TransportResponse,
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
  readonly responseData: HookRecord<Required<HyperPlugin>["onResponseData"]>[];
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
    responseData: [],
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
 * Использует Fast-Path для синхронных хуков без аллокации микротасок.
 * @en Executes the pre-request pipeline. Supports short-circuiting with fast-path for sync hooks.
 */
export function executeRequestPipeline(
  hooks: readonly HookRecord<Required<HyperPlugin>["onRequest"]>[],
  req: InternalRequest,
  ctx: PluginContext,
): Promise<HttpResponse<unknown> | null> | HttpResponse<unknown> | null | void {
  const len = hooks.length;
  if (len === 0) return null;

  for (let i = 0; i < len; i++) {
    const res = hooks[i]!.run(req, ctx);

    // Если хук асинхронный — переключаемся на медленный асинхронный путь
    if (res instanceof Promise) {
      return executeRequestPipelineAsync(hooks, req, ctx, i, res);
    }

    // Если синхронный хук вернул ответ — прерываем выполнение (Short-Circuit)
    if (res != null) return res;
  }
  return null;
}

/**
 * @ru Выполняет низкоуровневый конвейер трансформации сырых данных транспорта (фаза DATA).
 * Если хук возвращает измененный TransportResponse, он передается дальше по цепочке.
 * @en Executes low-level transport data transformation pipeline (DATA phase).
 */
export function executeResponseDataPipeline(
  hooks: readonly HookRecord<Required<HyperPlugin>["onResponseData"]>[],
  res: TransportResponse,
  ctx: PluginContext,
): Promise<TransportResponse> | TransportResponse {
  const len = hooks.length;
  if (len === 0) return res;

  let currentRes = res;
  for (let i = 0; i < len; i++) {
    const result = hooks[i]!.run(currentRes, ctx);

    if (result instanceof Promise) {
      return executeResponseDataPipelineAsync(
        hooks,
        ctx,
        i,
        result,
        currentRes,
      );
    }

    if (result != null) {
      currentRes = result;
    }
  }
  return currentRes;
}

/**
 * @ru Выполняет конвейер пост-ответа. Разделен на мутаторы (последовательно) и сайд-эффекты (в фоне).
 * Оптимизирован для минимизации выделения памяти под замыкания логгера.
 * @en Executes the post-response pipeline. Split into mutators (sequential) and side-effects (background).
 */
export function executeResponsePipeline(
  mutators: readonly HookRecord<Required<HyperPlugin>["onResponse"]>[],
  sideEffects: readonly HookRecord<Required<HyperPlugin>["onResponse"]>[],
  res: HttpResponse<unknown>,
  req: InternalRequest,
  ctx: PluginContext,
  logger?: HttpClientOptions["logger"],
): Promise<void> | void {
  const seLen = sideEffects.length;
  if (seLen > 0) {
    for (let i = 0; i < seLen; i++) {
      const effect = sideEffects[i]!;
      try {
        const promise = effect.run(res, req, ctx);
        if (promise instanceof Promise) {
          promise.catch((err) =>
            handleSideEffectError(err, effect.name, logger),
          );
        }
      } catch (err) {
        handleSideEffectError(err, effect.name, logger);
      }
    }
  }

  const mutLen = mutators.length;
  if (mutLen > 0) {
    for (let i = 0; i < mutLen; i++) {
      const result = mutators[i]!.run(res, req, ctx);

      if (result instanceof Promise) {
        return executeMutatorsAsync(mutators, res, req, ctx, i, result);
      }
    }
  }
}

/**
 * @ru Выполняет конвейер перехвата ошибок. Первый вернувший HttpResponse плагин прерывает панику.
 * @en Executes the error interception pipeline. First plugin to return HttpResponse stops the panic.
 */
export function executeErrorPipeline(
  hooks: readonly HookRecord<Required<HyperPlugin>["onError"]>[],
  error: HyperttpError,
  req: InternalRequest,
  ctx: PluginContext,
): Promise<HttpResponse<unknown> | null> | HttpResponse<unknown> | null | void {
  const len = hooks.length;
  if (len === 0) return null;

  for (let i = 0; i < len; i++) {
    const res = hooks[i]!.run(error, req, ctx);

    if (res instanceof Promise) {
      return executeErrorPipelineAsync(hooks, error, req, ctx, i, res);
    }

    if (res != null) return res;
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// ВНУТРЕННИЕ АСИНХРОННЫЕ СЕГМЕНТЫ (ВЫНЕСЕНЫ ИЗ ГОРЯЧИХ ФУНКЦИЙ ДЛЯ ИДЕАЛЬНОГО JIT INLINING)
// ═════════════════════════════════════════════════════════════════════════════════════════

async function executeRequestPipelineAsync(
  hooks: readonly HookRecord<Required<HyperPlugin>["onRequest"]>[],
  req: InternalRequest,
  ctx: PluginContext,
  startIndex: number,
  initialPromise: Promise<HttpResponse<unknown> | void>,
): Promise<HttpResponse<unknown> | null> {
  const shortCircuit = await initialPromise;
  if (shortCircuit != null) return shortCircuit;

  const len = hooks.length;
  for (let i = startIndex + 1; i < len; i++) {
    const res = await hooks[i]!.run(req, ctx);
    if (res != null) return res;
  }
  return null;
}

async function executeResponseDataPipelineAsync(
  hooks: readonly HookRecord<Required<HyperPlugin>["onResponseData"]>[],
  ctx: PluginContext,
  startIndex: number,
  initialPromise: Promise<TransportResponse | void>,
  lastRes: TransportResponse,
): Promise<TransportResponse> {
  let currentRes = lastRes;
  const firstAsyncResult = await initialPromise;
  if (firstAsyncResult != null) {
    currentRes = firstAsyncResult;
  }

  const len = hooks.length;
  for (let i = startIndex + 1; i < len; i++) {
    const result = await hooks[i]!.run(currentRes, ctx);
    if (result != null) {
      currentRes = result;
    }
  }
  return currentRes;
}

async function executeMutatorsAsync(
  mutators: readonly HookRecord<Required<HyperPlugin>["onResponse"]>[],
  res: HttpResponse<unknown>,
  req: InternalRequest,
  ctx: PluginContext,
  startIndex: number,
  initialPromise: Promise<unknown>,
): Promise<void> {
  await initialPromise;
  const len = mutators.length;
  for (let i = startIndex + 1; i < len; i++) {
    await mutators[i]!.run(res, req, ctx);
  }
}

async function executeErrorPipelineAsync(
  hooks: readonly HookRecord<Required<HyperPlugin>["onError"]>[],
  error: HyperttpError,
  req: InternalRequest,
  ctx: PluginContext,
  startIndex: number,
  initialPromise: Promise<HttpResponse<unknown> | void>,
): Promise<HttpResponse<unknown> | null> {
  const recovered = await initialPromise;
  if (recovered != null) return recovered;

  const len = hooks.length;
  for (let i = startIndex + 1; i < len; i++) {
    const res = await hooks[i]!.run(error, req, ctx);
    if (res != null) return res;
  }
  return null;
}

/**
 * @ru Статический обработчик падений фоновых хуков. Изолирован для предотвращения регенерации замыканий.
 */
function handleSideEffectError(
  err: unknown,
  hookName: string,
  logger?: HttpClientOptions["logger"],
): void {
  logger?.(
    "warn",
    `Background hook ${hookName} crashed: ${err instanceof Error ? err.message : String(err)}`,
  );
}
