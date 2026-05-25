import type { Method } from "../types/http.js";
import type { RequestBodyData } from "../types/request.js";

export interface TransportRequest {
  method: Method;
  url: string;
  headers: Record<string, string | string[]>;
  body?: RequestBodyData;
  signal?: AbortSignal;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string | string[]>;
  body: any;
  url: string;
}

export interface HyperTransport {
  execute(req: TransportRequest): Promise<TransportResponse>;
  /** * Graceful shutdown: дожидается завершения текущих запросов.
   */
  close?(): Promise<void>;
  /** * Forceful shutdown: немедленное закрытие соединений.
   */
  destroy?(): Promise<void>;
}
