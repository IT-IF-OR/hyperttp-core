export { HyperCore } from "./Core/index.js";
export { HyperClientError, TimeoutError } from "./utils/errors.js";
export { deepMerge } from "./utils/merge.js";
export {
  KNOWN_PROTOCOLS,
  resetCachedProtocols,
  resolveProtocol,
  resolveReceiver,
  resolveSender,
} from "./protocols/manager.js";

export type { CorePluginFactory, ServerPluginContext, ServerRequestOutcome } from "@hyperttp/types";
