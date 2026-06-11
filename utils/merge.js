/**
 * @ru Рекурсивно объединяет два объекта. Избегает лишних аллокаций памяти и защищает от разделения ссылок nested-структур.
 * @en Recursively merges two objects. Avoids redundant memory allocations and prevents shared reference leakage for nested structures.
 */
export function deepMerge(target, source) {
    const output = { ...target };
    for (const key of Object.keys(source)) {
        const sourceValue = source[key];
        const targetValue = output[key];
        if (isObject(sourceValue) && isObject(targetValue)) {
            output[key] = deepMerge(targetValue, sourceValue);
            continue;
        }
        if (sourceValue !== undefined) {
            output[key] = isObject(sourceValue)
                ? deepMerge({}, sourceValue)
                : sourceValue;
        }
    }
    return output;
}
/**
 * @ru Быстрая проверка, является ли переданный элемент чистым объектом (исключая массивы и null).
 * @en Fast check verifying if the provided item is a plain object layout (excluding arrays and null).
 */
function isObject(item) {
    return Object.prototype.toString.call(item) === "[object Object]";
}
//# sourceMappingURL=merge.js.map