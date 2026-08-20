import type { HyperSender, ServerRequestContext, UniversalResponse } from "@hyperttp/types";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS" | "QUERY";

export interface RestInput<TBody = unknown> {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | (string | number | boolean)[]>;
  body?: TBody;
  timeout?: number;
  stream?: boolean;
  followRedirects?: boolean;
  maxRedirects?: number;
  signal?: AbortSignal;
}

export type RestRequestOptions = Omit<RestInput, "method" | "url">;

/**
 * @ru Разобранный серверный REST-запрос, получаемый ресивером из сырого транспорта.
 * @en Parsed server-side REST request produced by the receiver from raw transport input.
 */
export interface RestServerInput {
  readonly method: HttpMethod | (string & {});
  readonly path: string;
  readonly headers: Readonly<Record<string, string | string[]>>;
  readonly query: Readonly<Record<string, string | string[]>>;
  readonly body?: unknown;
}

/**
 * @ru Ответ серверного REST-обработчика, сериализуемый ресивером в транспортный формат.
 * @en Server-side REST handler response, serialized by the receiver into the transport format.
 */
export interface RestServerResponse {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}

/**
 * @ru Серверный обработчик REST-протокола.
 * @en Server-side REST protocol handler.
 * @param request - The parsed server request.
 * @param ctx - The server request context.
 * @returns The response to serialize.
 */
export type RestServerHandler = (
  request: RestServerInput,
  ctx: ServerRequestContext,
) => RestServerResponse | Promise<RestServerResponse>;

export interface RestClientMethods {
  get<T = unknown>(
    url: string,
    options?: RestRequestOptions,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
  post<T = unknown>(
    url: string,
    body?: unknown,
    options?: Omit<RestRequestOptions, "body">,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
  put<T = unknown>(
    url: string,
    body?: unknown,
    options?: Omit<RestRequestOptions, "body">,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
  patch<T = unknown>(
    url: string,
    body?: unknown,
    options?: Omit<RestRequestOptions, "body">,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
  delete<T = unknown>(
    url: string,
    options?: RestRequestOptions,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
  head<T = unknown>(
    url: string,
    options?: RestRequestOptions,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
  options<T = unknown>(
    url: string,
    options?: RestRequestOptions,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
  query<T = unknown>(
    url: string,
    body?: unknown,
    options?: Omit<RestRequestOptions, "body">,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
  request<T = unknown>(
    method: HttpMethod | (string & {}),
    url: string,
    options?: RestRequestOptions,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
  stream<T = unknown>(
    url: string,
    options?: Omit<RestRequestOptions, "stream">,
    signal?: AbortSignal,
  ): Promise<UniversalResponse<T>>;
}

declare module "@hyperttp/types" {
  interface ProtocolInputMap {
    rest: RestInput;
  }

  interface HyperProtocols {
    readonly rest: RestClientMethods;
  }

  interface BaseHyperClientOptions {
    /**
     * @ru Кастомный сендер протокола, заменяющий стандартный сендер для своего протокола.
     * @en Custom protocol sender that overrides the default sender for its protocol.
     */
    customSender?: HyperSender;
  }
}
