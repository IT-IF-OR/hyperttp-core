import type { HyperSender, HyperTransport, RequestContext, SendRequest, TransportRequest, TransportResponse, UniversalResponse } from "@hyperttp/types";
import type { RestInput } from "./type.js";
export declare class RestSender implements HyperSender<RestInput, unknown, TransportRequest, TransportResponse> {
    readonly protocol = "rest";
    readonly methods: Readonly<Record<string, (...args: any[]) => any>>;
    prepare(request: SendRequest<RestInput, string>, ctx: RequestContext): TransportRequest;
    send(prepared: TransportRequest, transport: HyperTransport, _ctx: RequestContext): Promise<TransportResponse>;
    parse(raw: TransportResponse, _ctx: RequestContext): UniversalResponse<unknown>;
    private dispatch;
    private buildUrl;
}
//# sourceMappingURL=sender.d.ts.map