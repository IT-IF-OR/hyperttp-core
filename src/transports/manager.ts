import type { HyperTransport, LogLevel, HyperProtocolName } from "@hyperttp/types";
import { dynamicImport, isModuleNotFoundError } from "../utils/modules.js";

declare const Bun: unknown;
declare const Deno: unknown;

export type Runtime = "bun" | "node" | "deno" | "browser";

/**
 * @ru Опции разрешения транспорта. `customTransport` имеет приоритет над автовыбором.
 * @en Transport resolution options. `customTransport` takes priority over auto-selection.
 */
export interface ResolveTransportOptions {
  customTransport?: HyperTransport;
  /** Stable configuration identity for sharing automatic transports across calls. */
  cacheKey?: object;
  /** Requires the transport server role. */
  requireListen?: boolean;
  /** Prefer an HTTP/2 transport for REST and gRPC when one is available. */
  http2?: boolean;
  logger?: (level: LogLevel, message: string, meta?: unknown) => void;
  verbose?: boolean;
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
  /** Protocols that require this transport family. Omitted for generic transports. */
  readonly protocols?: readonly HyperProtocolName[];
};

const ALL_RUNTIMES: readonly Runtime[] = ["bun", "node", "deno", "browser"];

const HTTP2_TRANSPORT_DEFS: readonly TransportDef[] = [
  {
    protocols: ["rest"],
    runtime: ["bun"],
    pkg: "@hyperttp/transport-bun",
    export: "BunTransport",
  },
  {
    protocols: ["rest"],
    runtime: ["node"],
    pkg: "@hyperttp/transport-undici",
    export: "UndiciTransport",
  },
  {
    protocols: ["rest"],
    runtime: ["deno"],
    pkg: "@hyperttp/transport-deno",
    export: "DenoTransport",
  },
  {
    protocols: ["rest", "grpc"],
    runtime: ["bun", "node", "deno"],
    pkg: "@hyperttp/transport-node",
    export: "Http2Transport",
  },
];

const TRANSPORT_DEFS: readonly TransportDef[] = [
  {
    protocols: ["webrtc"],
    runtime: ALL_RUNTIMES,
    pkg: "@hyperttp/transport-webrtc",
    export: "WebRtcTransport",
  },
  {
    protocols: ["grpc"],
    runtime: ["bun", "node", "deno"],
    pkg: "@hyperttp/transport-node",
    export: "Http2Transport",
  },
  { runtime: ["bun"], pkg: "@hyperttp/transport-bun", export: "BunTransport" },
  {
    runtime: ["bun"],
    pkg: "@hyperttp/transport-node",
    export: "FetchTransport",
  },
  { runtime: ["node"], pkg: "@hyperttp/transport-undici", export: "UndiciTransport" },
  { runtime: ["node"], pkg: "@hyperttp/transport-node", export: "FetchTransport" },
  { runtime: ["deno"], pkg: "@hyperttp/transport-deno", export: "DenoTransport" },
  {
    runtime: ["deno"],
    pkg: "@hyperttp/transport-node",
    export: "FetchTransport",
  },
  {
    runtime: ["browser"],
    pkg: "@hyperttp/transport-node/fetch",
    export: "FetchTransport",
  },
];

function getCandidates(protocol: HyperProtocolName): readonly TransportDef[] {
  return TRANSPORT_DEFS.filter(
    (transport) =>
      transport.runtime.includes(CURRENT_RUNTIME) &&
      (!transport.protocols || transport.protocols.includes(protocol)),
  );
}

function getCandidatesForProtocols(
  protocols: readonly HyperProtocolName[],
  config?: ResolveTransportOptions,
): readonly TransportDef[] {
  const preferred =
    config?.http2 === true
      ? HTTP2_TRANSPORT_DEFS.filter((transport) => {
          const supportedProtocols = transport.protocols;
          return (
            transport.runtime.includes(CURRENT_RUNTIME) &&
            (!supportedProtocols ||
              protocols.some((protocol) => supportedProtocols.includes(protocol)))
          );
        })
      : [];
  const lists = protocols.map((protocol) => getCandidates(protocol));
  // Start with the most constrained protocol so a dedicated transport such as
  // GrpcTransport is tried before a generic REST transport.
  lists.sort((a, b) => a.length - b.length);

  const defs = new Map<string, TransportDef>();
  for (const transport of [...preferred, ...lists.flat()]) {
    const key = `${transport.pkg}:${transport.export}`;
    if (!defs.has(key)) defs.set(key, transport);
  }
  return [...defs.values()];
}

function getTransportInstallHint(
  protocols: readonly HyperProtocolName[],
  config?: ResolveTransportOptions,
): string {
  const packages = new Set(
    getCandidatesForProtocols(protocols, config).map((transport) => transport.pkg),
  );
  if (packages.size === 0) return "";

  return ` Install ${[...packages].map((pkg) => `"${pkg}"`).join(" or ")}.`;
}

type TransportCache = {
  client: Map<string, HyperTransport>;
  listen: Map<string, HyperTransport>;
  multi: Map<string, HyperTransport>;
  clientResolutions: Map<string, Promise<HyperTransport>>;
  listenResolutions: Map<string, Promise<HyperTransport>>;
  multiResolutions: Map<string, Promise<HyperTransport>>;
};

const defaultCacheKey = {};
let transportCaches = new WeakMap<object, TransportCache>();
let transportEntries = new WeakMap<HyperTransport, Set<Map<string, HyperTransport>>>();

function getCache(config?: ResolveTransportOptions): TransportCache {
  const identity = config?.cacheKey ?? config ?? defaultCacheKey;
  let cache = transportCaches.get(identity);
  if (!cache) {
    cache = {
      client: new Map(),
      listen: new Map(),
      multi: new Map(),
      clientResolutions: new Map(),
      listenResolutions: new Map(),
      multiResolutions: new Map(),
    };
    transportCaches.set(identity, cache);
  }
  return cache;
}

function supportsListen(transport: HyperTransport): boolean {
  return typeof transport.listen === "function";
}

function supportsProtocol(transport: HyperTransport, protocol: HyperProtocolName): boolean {
  return typeof transport.supports === "function"
    ? transport.supports(protocol)
    : (transport.protocols?.includes(protocol) ?? true);
}

function supportsAll(transport: HyperTransport, protocols: readonly HyperProtocolName[]): boolean {
  return protocols.every((protocol) => supportsProtocol(transport, protocol));
}

async function disposeUnusedTransport(transport: HyperTransport): Promise<void> {
  try {
    if (typeof transport.destroy === "function") {
      await transport.destroy();
    } else if (typeof transport.close === "function") {
      await transport.close();
    }
  } catch {
    //
  }
}

async function createTransport(
  protocols: readonly HyperProtocolName[],
  config?: ResolveTransportOptions,
): Promise<HyperTransport> {
  const candidates = getCandidatesForProtocols(protocols, config);
  for (let i = 0; i < candidates.length; i++) {
    const t = candidates[i]!;
    let mod: Record<string, unknown>;
    try {
      mod = await dynamicImport(t.pkg);
    } catch (err) {
      if (!isModuleNotFoundError(err)) throw err;
      continue;
    }
    const candidate = (mod[t.export] ?? mod.default) as
      | { new (opts?: unknown): HyperTransport }
      | undefined;
    if (typeof candidate !== "function") continue;

    const instance = new candidate(config ?? {});
    if (!supportsAll(instance, protocols) || (config?.requireListen && !supportsListen(instance))) {
      await disposeUnusedTransport(instance);
      continue;
    }

    return instance;
  }

  const label = protocols.length === 1 ? "protocol" : "protocols";
  throw new Error(
    `[HyperCore] No transport available for ${label} ${protocols.map((p) => `"${p}"`).join(", ")} in runtime "${CURRENT_RUNTIME}".${getTransportInstallHint(protocols, config)}`,
  );
}

function cacheTransport(
  transport: HyperTransport,
  cache: Map<string, HyperTransport>,
  key: string,
): HyperTransport {
  cache.set(key, transport);
  let entries = transportEntries.get(transport);
  if (!entries) {
    entries = new Set();
    transportEntries.set(transport, entries);
  }
  entries.add(cache);
  return transport;
}

/**
 * @ru Разрешает оптимальный транспорт для указанного протокола и текущей среды.
 * Кастомный транспорт из конфигурации имеет приоритет над автовыбором.
 * @en Resolves optimal transport for the given protocol and current runtime.
 * A custom transport from the config takes priority over auto-selection.
 */
export async function resolveTransport(
  protocol: HyperProtocolName = "rest",
  config?: ResolveTransportOptions,
): Promise<HyperTransport> {
  const requireListen = config?.requireListen ?? false;

  if (config?.customTransport) {
    if (!supportsProtocol(config.customTransport, protocol)) {
      throw new Error(`[HyperCore] Custom transport does not support protocol "${protocol}".`);
    }

    if (requireListen && !supportsListen(config.customTransport)) {
      throw new Error("[HyperCore] Custom transport does not support listen().");
    }
    return config.customTransport;
  }

  const cache = getCache(config);
  const transportCache = requireListen ? cache.listen : cache.client;
  const transportResolutions = requireListen ? cache.listenResolutions : cache.clientResolutions;
  const cached = transportCache.get(protocol);
  if (cached) return cached;

  const pending = transportResolutions.get(protocol);
  if (pending) return pending;

  const resolution = createTransport([protocol], config)
    .then((transport) => cacheTransport(transport, transportCache, protocol))
    .finally(() => {
      transportResolutions.delete(protocol);
    });

  transportResolutions.set(protocol, resolution);
  return resolution;
}

/**
 * @ru Разрешает один транспорт, поддерживающий сразу все указанные протоколы.
 * Используется мультипротокольным `listen({ protocols })`, чтобы не открывать
 * несколько слушателей на одном порту.
 * @en Resolves one transport supporting every requested protocol. Used by the
 * multi-protocol `listen({ protocols })` so one port is not opened multiple times.
 */
export async function resolveTransportForProtocols(
  protocols: readonly HyperProtocolName[],
  config?: ResolveTransportOptions,
): Promise<HyperTransport> {
  if (protocols.length === 0) {
    throw new Error("[HyperCore] At least one protocol is required to resolve a transport.");
  }
  if (protocols.length === 1) return resolveTransport(protocols[0], config);

  const requireListen = config?.requireListen ?? false;

  if (config?.customTransport) {
    if (!supportsAll(config.customTransport, protocols)) {
      throw new Error(
        `[HyperCore] Custom transport does not support protocols ${protocols.map((p) => `"${p}"`).join(", ")}.`,
      );
    }
    if (requireListen && !supportsListen(config.customTransport)) {
      throw new Error("[HyperCore] Custom transport does not support listen().");
    }
    return config.customTransport;
  }

  const cache = getCache(config);
  const key = JSON.stringify([...protocols].sort());
  const cached = cache.multi.get(key);
  if (cached) return cached;

  const pending = cache.multiResolutions.get(key);
  if (pending) return pending;

  const resolution = createTransport(protocols, config)
    .then((transport) => cacheTransport(transport, cache.multi, key))
    .finally(() => {
      cache.multiResolutions.delete(key);
    });

  cache.multiResolutions.set(key, resolution);
  return resolution;
}

/**
 * @ru Синхронно возвращает транспорт из кэша без создания Promise.
 * @en Synchronously returns a cached transport without creating a Promise.
 * @param protocol - Протокол, для которого запрашивается транспорт. @en Protocol whose transport is requested.
 * @returns Кэшированный транспорт или `undefined`. @en Cached transport or `undefined`.
 */
export function getCachedTransport(
  protocol: HyperProtocolName = "rest",
  config?: ResolveTransportOptions,
): HyperTransport | undefined {
  const cache = getCache(config);
  return (config?.requireListen ? cache.listen : cache.client).get(protocol);
}

/**
 * @ru Удаляет все записи кэша, ссылающиеся на указанный транспорт.
 * @en Removes every cache entry that references the given transport.
 * @param transport - Экземпляр транспорта для удаления из кэша. @en Transport instance to evict from the cache.
 */
export function evictCachedTransport(transport: HyperTransport): void {
  for (const entries of transportEntries.get(transport) ?? []) {
    for (const [key, cached] of entries) {
      if (cached === transport) entries.delete(key);
    }
  }
  transportEntries.delete(transport);
}

/**
 * @ru Очищает кэш транспортов и ожидающих их разрешений. Не закрывает уже
 * созданные экземпляры транспорта.
 * @en Clears cached transports and pending resolutions. It does not close
 * already-created transport instances.
 */
export function resetCachedTransport(): void {
  transportCaches = new WeakMap();
  transportEntries = new WeakMap();
}
