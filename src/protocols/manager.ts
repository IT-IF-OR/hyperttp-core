import type {
  AnyHyperProtocol,
  HyperProtocol,
  HyperReceiver,
  HyperSender,
  HyperProtocolName,
} from "@hyperttp/types";
import { HyperClientError } from "../utils/errors.js";
import { dynamicImport, isModuleNotFoundError } from "../utils/modules.js";

type ProtocolDef = {
  readonly protocol: HyperProtocolName;
  readonly pkg: string;
  readonly export: string;
};

const PROTOCOL_DEFS: readonly ProtocolDef[] = [
  {
    protocol: "graphql",
    pkg: "@hyperttp/protocol-graphql",
    export: "GraphQLProtocol",
  },
  { protocol: "grpc", pkg: "@hyperttp/protocol-grpc", export: "GrpcProtocol" },
  { protocol: "trpc", pkg: "@hyperttp/protocol-trpc", export: "TrpcProtocol" },
  {
    protocol: "ws",
    pkg: "@hyperttp/protocol-websocket",
    export: "WebSocketProtocol",
  },
  {
    protocol: "websocket",
    pkg: "@hyperttp/protocol-websocket",
    export: "WebSocketProtocol",
  },
  { protocol: "sse", pkg: "@hyperttp/protocol-sse", export: "SseProtocol" },
  { protocol: "mqtt", pkg: "@hyperttp/protocol-mqtt", export: "MqttProtocol" },
  { protocol: "webrtc", pkg: "@hyperttp/protocol-webrtc", export: "WebRtcProtocol" },
];

/**
 * @ru Известные опциональные пакетные протоколы.
 * @en Known optional packaged protocols.
 */
export const KNOWN_PROTOCOLS: readonly HyperProtocolName[] = Object.freeze(
  PROTOCOL_DEFS.map((d) => d.protocol),
);

const protocolCache = new Map<string, AnyHyperProtocol>();
const pendingProtocols = new Map<string, Promise<AnyHyperProtocol>>();
let cacheGeneration = 0;

/**
 * @ru Разрешает опциональный пакетный модуль протокола.
 * @en Resolves an optional packaged protocol module.
 */
export async function resolveProtocol<P extends HyperProtocolName>(
  protocol: P,
  options?: { [key: string]: unknown },
): Promise<HyperProtocol<unknown, unknown, unknown, unknown, P>> {
  const cached = protocolCache.get(protocol);
  if (cached) {
    return cached as AnyHyperProtocol<P>;
  }

  const pending = pendingProtocols.get(protocol);
  if (pending) return (await pending) as AnyHyperProtocol<P>;

  const generation = cacheGeneration;
  const resolution = loadProtocol(protocol, options)
    .then((instance) => {
      if (generation === cacheGeneration) protocolCache.set(protocol, instance);
      return instance;
    })
    .finally(() => {
      // A pre-reset resolution must not remove a newer pending load.
      if (pendingProtocols.get(protocol) === resolution) pendingProtocols.delete(protocol);
    });
  pendingProtocols.set(protocol, resolution);
  return (await resolution) as AnyHyperProtocol<P>;
}

async function loadProtocol(
  protocol: HyperProtocolName,
  options?: { [key: string]: unknown },
): Promise<AnyHyperProtocol> {
  for (let i = 0; i < PROTOCOL_DEFS.length; i++) {
    const def = PROTOCOL_DEFS[i]!;
    if (def.protocol !== protocol) continue;

    try {
      const mod = await dynamicImport(def.pkg);
      const candidate = (mod[def.export] ?? mod.default) as
        | { new (opts?: unknown): AnyHyperProtocol }
        | AnyHyperProtocol
        | undefined;
      const instance =
        typeof candidate === "function" ? new candidate(options) : (candidate as AnyHyperProtocol);

      if (!instance || typeof instance.protocol !== "string") continue;

      return instance;
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
export async function resolveSender<P extends HyperProtocolName>(
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
export async function resolveReceiver<P extends HyperProtocolName>(
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
  cacheGeneration++;
  protocolCache.clear();
  pendingProtocols.clear();
}
