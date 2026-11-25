const MODULE_NOT_FOUND_CODES = new Set(["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"]);

export function isModuleNotFoundError(err: unknown, specifier: string): boolean {
  if (!err || typeof err !== "object") return false;

  const error = err as { code?: unknown; message?: unknown };
  const message = typeof error.message === "string" ? error.message : "";
  const knownCode = typeof error.code === "string" && MODULE_NOT_FOUND_CODES.has(error.code);

  if (!knownCode || !message.includes(specifier)) return false;

  return /Cannot find (?:module|package)|Module not found|Failed to resolve|Failed to load|__vite-optional-peer-dep/i.test(
    message,
  );
}

export async function dynamicImport(pkg: string): Promise<Record<string, unknown>> {
  try {
    return await import(/* @vite-ignore */ pkg);
  } catch (err) {
    const message =
      err && typeof err === "object" ? String((err as { message?: unknown }).message ?? "") : "";

    if (!message.includes("Failed to load url")) throw err;

    // Vite SSR cannot resolve arbitrary bare package specifiers.
    // oxlint-disable-next-line no-eval -- pkg remains a lexical variable.
    return eval("import(/* @vite-ignore */ pkg)");
  }
}
