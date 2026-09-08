/**
 * @ru Рекурсивно объединяет два объекта. Избегает лишних аллокаций памяти и защищает от разделения ссылок nested-структур.
 * @en Recursively merges two objects. Avoids redundant memory allocations and prevents shared reference leakage for nested structures.
 */
export declare function deepMerge<T extends Record<string, unknown>, S extends Record<string, unknown>>(target: T, source: S): T & S;
//# sourceMappingURL=merge.d.ts.map