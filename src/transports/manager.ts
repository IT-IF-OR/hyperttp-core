import type { HyperTransport, SenderProtocol } from "@hyperttp/types";
import { FetchTransport, type FetchTransportOptions } from "./fetch.js";

declare const Bun: unknown;
declare const Deno: unknown;

export type Runtime = "bun" | "node" | "deno" | "browser";

/**
 * @ru Опции разрешения транспорта. `customTransport` имеет приоритет над автовыбором.
 * @en Transport resolution options. `customTransport` takes priority over auto-selection.
 */
export interface ResolveTransportOptions {
  customTransport?: HyperTransport;
  [key: string]: unknown;
}

export const CURRENT_RUNTIME: Runtime = (() => {
  if (typeof Bun !== "undefined") return "bun";
  if (typeof Deno !== "undefined") return "deno";
  if (typeof process !== "undefined" && process.versions?.node) return "node";
  return "browser";
})();

type TransportDef = {
  readonly runtime: readonly Runtime[];
  readonly pkg: string;
  readonly export: string;
  readonly priority: number;
};

const TRANSPORT_DEFS: readonly TransportDef[] = [
  { runtime: ["bun"], pkg: "@hyperttp/transport-bun", export: "BunTransport", priority: 100 },
  { runtime: ["node"], pkg: "@hyperttp/transport-undici", export: "UndiciTransport", priority: 90 },
  { runtime: ["deno"], pkg: "@hyperttp/transport-deno", export: "DenoTransport", priority: 85 },
];

const CANDIDATES: readonly TransportDef[] = TRANSPORT_DEFS.filter((t) =>
  t.runtime.includes(CURRENT_RUNTIME),
).sort((a, b) => b.priority - a.priority);

const transportCache = new Map<string, HyperTransport>();
const transportResolutions = new Map<string, Promise<HyperTransport>>();

function isModuleNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  if (e.code === "ERR_MODULE_NOT_FOUND" || e.code === "MODULE_NOT_FOUND") return true;

  const msg = err instanceof Error ? err.message : String(e.message ?? "");
  return (
    msg.includes("Cannot find module") ||
    msg.includes("Failed to resolve") ||
    msg.includes("Failed to load")
  );
}

async function dynamicImport(pkg: string): Promise<Record<string, unknown>> {
  /* @vite-ignore */
  return import(/* webpackIgnore: true */ pkg);
}

function supportsProtocol(transport: HyperTransport, protocol: SenderProtocol): boolean {
  return typeof transport.supports === "function"
    ? transport.supports(protocol)
    : (transport.protocols?.includes(protocol) ?? true);
}

async function disposeUnusedTransport(transport: HyperTransport): Promise<void> {
  if (typeof transport.destroy === "function") {
    await transport.destroy();
  } else if (typeof transport.close === "function") {
    await transport.close();
  }
}

async function createTransport(
  protocol: SenderProtocol,
  config?: ResolveTransportOptions,
): Promise<HyperTransport> {
  for (let i = 0; i < CANDIDATES.length; i++) {
    const t = CANDIDATES[i]!;
    try {
      const mod = await dynamicImport(t.pkg);
      const candidate = (mod[t.export] ?? mod.default) as
        | { new (opts?: unknown): HyperTransport }
        | undefined;
      if (typeof candidate !== "function") continue;

      const instance = new candidate(config ?? {});
      if (!supportsProtocol(instance, protocol)) {
        await disposeUnusedTransport(instance);
        continue;
      }

      return instance;
    } catch (err) {
      if (!isModuleNotFoundError(err)) throw err;
    }
  }

  console.warn(
    `[HyperCore] Fast transport (e.g. @hyperttp/transport-undici) unavailable for runtime "${CURRENT_RUNTIME}". Falling back to slow FetchTransport.`,
  );

  const fetchTransport = new FetchTransport(config as unknown as FetchTransportOptions);
  if (supportsProtocol(fetchTransport, protocol)) return fetchTransport;

  await disposeUnusedTransport(fetchTransport);
  throw new Error(
    `[HyperCore] No transport available for protocol "${protocol}" in runtime "${CURRENT_RUNTIME}".`,
  );
}

/**
 * @ru Разрешает оптимальный транспорт для указанного протокола и текущей среды.
 * Кастомный транспорт из конфигурации имеет приоритет над автовыбором.
 * @en Resolves optimal transport for the given protocol and current runtime.
 * A custom transport from the config takes priority over auto-selection.
 */
export async function resolveTransport(
  protocol: SenderProtocol = "rest",
  config?: ResolveTransportOptions,
): Promise<HyperTransport> {
  if (config?.customTransport) {
    if (!supportsProtocol(config.customTransport, protocol)) {
      throw new Error(`[HyperCore] Custom transport does not support protocol "${protocol}".`);
    }
    return config.customTransport;
  }

  const cached = transportCache.get(protocol);
  if (cached) return cached;

  const pending = transportResolutions.get(protocol);
  if (pending) return pending;

  const resolution = createTransport(protocol, config)
    .then((transport) => {
      transportCache.set(protocol, transport);
      return transport;
    })
    .finally(() => {
      transportResolutions.delete(protocol);
    });

  transportResolutions.set(protocol, resolution);
  return resolution;
}

/**
 * @ru Синхронно возвращает транспорт из кэша без создания Promise.
 * @en Synchronously returns a cached transport without creating a Promise.
 * @param protocol - Протокол, для которого запрашивается транспорт. @en Protocol whose transport is requested.
 * @returns Кэшированный транспорт или `undefined`. @en Cached transport or `undefined`.
 */
export function getCachedTransport(protocol: SenderProtocol = "rest"): HyperTransport | undefined {
  return transportCache.get(protocol);
}

/**
 * @ru Удаляет все записи кэша, ссылающиеся на указанный транспорт.
 * @en Removes every cache entry that references the given transport.
 * @param transport - Экземпляр транспорта для удаления из кэша. @en Transport instance to evict from the cache.
 */
export function evictCachedTransport(transport: HyperTransport): void {
  for (const [protocol, cached] of transportCache) {
    if (cached === transport) {
      transportCache.delete(protocol);
    }
  }
}

/**
 * @ru Очищает кэш транспортов и ожидающих их разрешений. Не закрывает уже
 * созданные экземпляры транспорта.
 * @en Clears cached transports and pending resolutions. It does not close
 * already-created transport instances.
 */
export function resetCachedTransport(): void {
  transportCache.clear();
  transportResolutions.clear();
}
