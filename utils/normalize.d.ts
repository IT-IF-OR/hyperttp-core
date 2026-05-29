import type { Method, RequestBodyData } from "@hyperttp/types";
export type NormalizedBody = string | Uint8Array | ArrayBuffer | FormData | URLSearchParams | ReadableStream | Blob | null | undefined;
export declare function normalizeHeaders(headers: unknown): Record<string, string>;
export declare function normalizeMethod(method: string): Method;
export declare function normalizeBody(method: Method, body: RequestBodyData | undefined): RequestBodyData | undefined;
//# sourceMappingURL=normalize.d.ts.map