/**
 * @ru Создаёт пустой контейнер для конвейеров плагинов.
 * @en Creates an empty container for plugin pipelines.
 * @returns An empty pipeline container.
 */
export function createPipelines() {
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
 * @param list - Target array to insert into.
 * @param hook - Hook record to insert.
 */
export function insertHookSorted(list, hook) {
    const len = list.length;
    let i = 0;
    while (i < len && list[i].priority >= hook.priority) {
        i++;
    }
    list.splice(i, 0, hook);
}
/**
 * @ru Выполняет конвейер пред-запроса. Поддерживает short-circuit.
 * @en Executes the pre-request pipeline. Supports short-circuiting.
 */
export function executeRequestPipeline(hooks, req, ctx) {
    const len = hooks.length;
    if (len === 0)
        return null;
    for (let i = 0; i < len; i++) {
        const hook = hooks[i];
        const res = hook.run(req, ctx);
        if (res !== null && res !== undefined) {
            if (res instanceof Promise) {
                return executeRequestPipelineAsync(hooks, req, ctx, i, res);
            }
            return res;
        }
    }
    return null;
}
/**
 * @ru Выполняет низкоуровневый конвейер трансформации сырых данных транспорта (фаза DATA).
 * @en Executes low-level transport data transformation pipeline (DATA phase).
 */
export function executeResponseDataPipeline(hooks, res, ctx) {
    const len = hooks.length;
    if (len === 0)
        return res;
    let currentRes = res;
    for (let i = 0; i < len; i++) {
        const result = hooks[i].run(currentRes, ctx);
        if (result instanceof Promise) {
            return executeResponseDataPipelineAsync(hooks, ctx, i, result, currentRes);
        }
        if (result != null) {
            currentRes = result;
        }
    }
    return currentRes;
}
/**
 * @ru Выполняет конвейер пост-ответа. Разделен на мутаторы и сайд-эффекты.
 * @en Executes the post-response pipeline. Split into mutators and side-effects.
 */
export function executeResponsePipeline(mutators, sideEffects, res, req, ctx, logger) {
    const seLen = sideEffects.length;
    if (seLen > 0) {
        for (let i = 0; i < seLen; i++) {
            const effect = sideEffects[i];
            try {
                const promise = effect.run(res, req, ctx);
                if (promise instanceof Promise) {
                    safelyAttachSideEffectCatch(promise, effect.name, logger);
                }
            }
            catch (err) {
                handleSideEffectError(err, effect.name, logger);
            }
        }
    }
    const mutLen = mutators.length;
    if (mutLen > 0) {
        for (let i = 0; i < mutLen; i++) {
            const result = mutators[i].run(res, req, ctx);
            if (result instanceof Promise) {
                return executeMutatorsAsync(mutators, res, req, ctx, i, result);
            }
        }
    }
}
/**
 * @ru Выполняет конвейер перехвата ошибок.
 * @en Executes the error interception pipeline.
 */
export function executeErrorPipeline(hooks, error, req, ctx) {
    const len = hooks.length;
    if (len === 0)
        return null;
    for (let i = 0; i < len; i++) {
        const res = hooks[i].run(error, req, ctx);
        if (res instanceof Promise) {
            return executeErrorPipelineAsync(hooks, error, req, ctx, i, res);
        }
        if (res != null)
            return res;
    }
    return null;
}
async function executeRequestPipelineAsync(hooks, req, ctx, startIndex, initialPromise) {
    const shortCircuit = await initialPromise;
    if (shortCircuit != null)
        return shortCircuit;
    const len = hooks.length;
    for (let i = startIndex + 1; i < len; i++) {
        const res = hooks[i].run(req, ctx);
        if (res instanceof Promise) {
            const asyncRes = await res;
            if (asyncRes != null)
                return asyncRes;
        }
        else if (res != null) {
            return res;
        }
    }
    return null;
}
async function executeResponseDataPipelineAsync(hooks, ctx, startIndex, initialPromise, lastRes) {
    let currentRes = lastRes;
    const firstAsyncResult = await initialPromise;
    if (firstAsyncResult != null) {
        currentRes = firstAsyncResult;
    }
    const len = hooks.length;
    for (let i = startIndex + 1; i < len; i++) {
        const result = hooks[i].run(currentRes, ctx);
        if (result instanceof Promise) {
            const asyncResult = await result;
            if (asyncResult != null) {
                currentRes = asyncResult;
            }
        }
        else if (result != null) {
            currentRes = result;
        }
    }
    return currentRes;
}
async function executeMutatorsAsync(mutators, res, req, ctx, startIndex, initialPromise) {
    await initialPromise;
    const len = mutators.length;
    for (let i = startIndex + 1; i < len; i++) {
        const result = mutators[i].run(res, req, ctx);
        if (result instanceof Promise) {
            await result;
        }
    }
}
async function executeErrorPipelineAsync(hooks, error, req, ctx, startIndex, initialPromise) {
    const recovered = await initialPromise;
    if (recovered != null)
        return recovered;
    const len = hooks.length;
    for (let i = startIndex + 1; i < len; i++) {
        const res = hooks[i].run(error, req, ctx);
        if (res instanceof Promise) {
            const asyncRes = await res;
            if (asyncRes != null)
                return asyncRes;
        }
        else if (res != null) {
            return res;
        }
    }
    return null;
}
function safelyAttachSideEffectCatch(promise, hookName, logger) {
    promise.catch((err) => handleSideEffectError(err, hookName, logger));
}
function handleSideEffectError(err, hookName, logger) {
    if (!logger)
        return;
    const errorObject = err instanceof Error ? err : new Error(String(err));
    logger("warn", `Background hook "${hookName}" crashed: ${errorObject.message}`, errorObject);
}
//# sourceMappingURL=pipeline.js.map