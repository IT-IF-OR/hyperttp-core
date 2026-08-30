import type { HyperProtocol, HyperReceiver, HyperSender, SenderProtocol } from "@hyperttp/types";
import { HyperClientError } from "../utils/errors.js";
import { RestProtocol } from "./rest/index.js";

type ProtocolDef = {
  readonly protocol: SenderProtocol;
  readonly pkg: string;
  readonly export: string;
  readonly priority: number;
};

const PROTOCOL_DEFS: readonly ProtocolDef[] = [
  {
    protocol: "graphql",
    pkg: "@hyperttp/protocol-graphql",
    export: "GraphQLProtocol",
    priority: 100,
  },
  { protocol: "grpc", pkg: "@hyperttp/protocol-grpc", export: "GrpcProtocol", priority: 100 },
  { protocol: "trpc", pkg: "@hyperttp/protocol-trpc", export: "TrpcProtocol", priority: 100 },
  {
    protocol: "ws",
    pkg: "@hyperttp/protocol-websocket",
    export: "WebSocketProtocol",
    priority: 100,
  },
  {
    protocol: "websocket",
    pkg: "@hyperttp/protocol-websocket",
    export: "WebSocketProtocol",
    priority: 90,
  },
  { protocol: "sse", pkg: "@hyperttp/protocol-sse", export: "SseProtocol", priority: 100 },
  { protocol: "mqtt", pkg: "@hyperttp/protocol-mqtt", export: "MqttProtocol", priority: 100 },
];

/**
 * @ru Известные протоколы ядра: встроенный rest и пакетные модули.
 * @en Known core protocols: the built-in rest and packaged modules.
 */
export const KNOWN_PROTOCOLS: readonly SenderProtocol[] = Object.freeze([
  "rest",
  ...PROTOCOL_DEFS.map((d) => d.protocol),
]);

const protocolCache = new Map<string, HyperProtocol>();

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

/**
 * @ru Разрешает модуль протокола. Встроенный rest возвращается статически,
 * остальные протоколы загружаются из пакетных модулей по требованию.
 * @en Resolves a protocol module. The built-in rest is returned statically,
 * other protocols are loaded from packaged modules on demand.
 */
export async function resolveProtocol<P extends SenderProtocol>(
  protocol: P,
  options?: { [key: string]: unknown },
): Promise<HyperProtocol<unknown, unknown, unknown, unknown, P>> {
  const cached = protocolCache.get(protocol);
  if (cached) {
    return cached as HyperProtocol<unknown, unknown, unknown, unknown, P>;
  }

  if (protocol === "rest") {
    protocolCache.set(protocol, RestProtocol);
    return RestProtocol as HyperProtocol<unknown, unknown, unknown, unknown, P>;
  }

  for (let i = 0; i < PROTOCOL_DEFS.length; i++) {
    const def = PROTOCOL_DEFS[i]!;
    if (def.protocol !== protocol) continue;

    try {
      const mod = await dynamicImport(def.pkg);
      const candidate = (mod[def.export] ?? mod.default) as
        | { new (opts?: unknown): HyperProtocol }
        | HyperProtocol
        | undefined;
      const instance =
        typeof candidate === "function" ? new candidate(options) : (candidate as HyperProtocol);

      if (!instance || typeof instance.protocol !== "string") continue;

      protocolCache.set(protocol, instance);
      return instance as HyperProtocol<unknown, unknown, unknown, unknown, P>;
    } catch (err) {
      if (!isModuleNotFoundError(err)) throw err;
    }
  }

  const pkgDef = PROTOCOL_DEFS.find((d) => d.protocol === protocol);
  const hint = pkgDef ? ` Did you forget to install "${pkgDef.pkg}"?` : "";

  throw new HyperClientError(`[HyperCore] No protocol available for "${protocol}".${hint}`);
}

/**
 * @ru Разрешает клиентский сендер протокола.
 * @en Resolves the client sender of a protocol.
 */
export async function resolveSender<P extends SenderProtocol>(
  protocol: P,
  options?: { [key: string]: unknown },
): Promise<HyperSender<unknown, unknown, unknown, unknown, P>> {
  const resolved = await resolveProtocol(protocol, options);
  if (!resolved.sender) {
    throw new HyperClientError(`[HyperCore] Protocol "${protocol}" has no sender (client role).`);
  }
  return resolved.sender;
}

/**
 * @ru Разрешает серверный ресивер протокола.
 * @en Resolves the server receiver of a protocol.
 */
export async function resolveReceiver<P extends SenderProtocol>(
  protocol: P,
  options?: { [key: string]: unknown },
): Promise<HyperReceiver<unknown, unknown, unknown, unknown, P>> {
  const resolved = await resolveProtocol(protocol, options);
  if (!resolved.receiver) {
    throw new HyperClientError(`[HyperCore] Protocol "${protocol}" has no receiver (server role).`);
  }
  return resolved.receiver;
}

/**
 * @ru Очищает кэш загруженных модулей протоколов. Не выгружает уже импортированные
 * JavaScript-модули из runtime.
 * @en Clears the loaded protocol-module cache. It does not unload JavaScript
 * modules already imported by the runtime.
 */
export function resetCachedProtocols(): void {
  protocolCache.clear();
}
