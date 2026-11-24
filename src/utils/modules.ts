export function isModuleNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  if (e.code === "ERR_MODULE_NOT_FOUND" || e.code === "MODULE_NOT_FOUND") return true;

  const message = err instanceof Error ? err.message : String(e.message ?? "");
  return (
    message.includes("Cannot find module") ||
    message.includes("Failed to resolve") ||
    message.includes("Failed to load")
  );
}

export async function dynamicImport(pkg: string): Promise<Record<string, unknown>> {
  try {
    return await import(/* @vite-ignore */ pkg);
  } catch (err) {
    const message =
      err && typeof err === "object" ? String((err as { message?: unknown }).message ?? "") : "";
    if (!message.includes("Failed to load url")) throw err;

    // Vite's SSR resolver cannot load arbitrary bare package specifiers.
    // oxlint-disable-next-line no-eval -- The code is static; pkg stays lexical.
    return eval("import(/* @vite-ignore */ pkg)");
  }
}
