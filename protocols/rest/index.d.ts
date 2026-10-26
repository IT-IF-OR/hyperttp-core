import type { HyperProtocol } from "@hyperttp/types";
import type { RestInput, RestServerInput, RestServerResponse } from "./type.js";
/**
 * @ru Единый REST-модуль протокола, объединяющий клиентский сендер и серверный ресивер.
 * @en Unified REST protocol module combining a client sender and a server receiver.
 */
export declare const RestProtocol: HyperProtocol<RestInput, unknown, RestServerInput, RestServerResponse, "rest">;
export { RestReceiver } from "./receiver.js";
export { RestSender } from "./sender.js";
//# sourceMappingURL=index.d.ts.map