/**
 * @ru Рекурсивно объединяет два объекта. Избегает лишних аллокаций памяти и защищает от разделения ссылок nested-структур.
 * @en Recursively merges two objects. Avoids redundant memory allocations and prevents shared reference leakage for nested structures.
 * @param target - Foundational target base object layout.
 * @param source - High-priority source object containing overrides.
 * @returns New deeply merged intersection object.
 */
export function deepMerge(target, source) {
    const output = { ...target };
    if (isObject(target) && isObject(source)) {
        for (const key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                const sourceValue = source[key];
                const targetValue = output[key];
                if (isObject(sourceValue)) {
                    if (key in output && isObject(targetValue)) {
                        output[key] = deepMerge(targetValue, sourceValue);
                    }
                    else {
                        output[key] = deepMerge({}, sourceValue);
                    }
                }
                else if (sourceValue !== undefined) {
                    output[key] = sourceValue;
                }
            }
        }
    }
    return output;
}
/**
 * @ru Быстрая проверка, является ли переданный элемент чистым объектом (исключая массивы и null).
 * @en Fast check verifying if the provided item is a plain object layout (excluding arrays and null).
 * @param item - Evaluated runtime variable value context.
 */
function isObject(item) {
    return typeof item === "object" && item !== null && !Array.isArray(item);
}
//# sourceMappingURL=merge.js.map