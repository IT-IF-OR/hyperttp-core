import type { HyperReceiver, ServerRequestContext, TransportRequest, TransportResponse } from "@hyperttp/types";
import type { RestServerHandler, RestServerInput, RestServerResponse } from "./type.js";
/**
 * @ru REST/HTTP серверный адаптер. Зеркальная к `RestSender` реализация
 * трёхфазного цикла receive → handle → respond.
 * @en REST/HTTP server adapter. Mirror implementation of `RestSender` for the
 * three-phase receive → handle → respond cycle.
 */
export declare class RestReceiver implements HyperReceiver<RestServerInput, RestServerResponse, TransportRequest, TransportResponse> {
    readonly protocol = "rest";
    protected readonly handler?: RestServerHandler;
    /**
     * @ru Создаёт REST-ресивер с необязательным application handler.
     * @en Creates a REST receiver with an optional application handler.
     * @param options - Настройки ресивера и его обработчик. @en Receiver settings and its handler.
     */
    constructor(options?: {
        handler?: RestServerHandler;
    });
    /**
     * @ru Фаза приёма: разбирает сырой запрос транспорта в REST-структуру.
     * @en Receive phase: parses raw transport request into REST input structure.
     */
    receive(raw: TransportRequest, _ctx: ServerRequestContext): RestServerInput;
    /**
     * @ru Фаза обработки: вызывает зарегистрированный handler.
     * @en Handle phase: executes the registered application handler.
     */
    handle(request: RestServerInput, ctx: ServerRequestContext): RestServerResponse | Promise<RestServerResponse>;
    /**
     * @ru Фаза ответа: сериализует протокольный ответ в транспортный формат.
     * @en Respond phase: serializes protocol response to raw transport format.
     */
    respond(response: RestServerResponse, _ctx: ServerRequestContext): TransportResponse;
}
//# sourceMappingURL=receiver.d.ts.map