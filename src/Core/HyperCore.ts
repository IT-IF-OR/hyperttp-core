import type {
  IHyperCore,
  HyperTransport,
  HttpClientOptions,
  PluginContext,
  HyperPlugin,
  InternalRequest,
  HttpResponse,
  HyperttpError,
  RequestInterface,
  StreamResponse,
  RequestBodyData,
  Method,
} from "@hyperttp/types";
import { defaultConfig } from "../defaultConfig.js";
import {
  mapResponseFast,
  mapStreamFast,
  mergeHeadersFast,
} from "../utils/response.js";
import { createRequire } from "node:module";

type TransportArgs = Parameters<HyperTransport["execute"]>[0];

type HookRecord<T> = {
  name: string;
  run: T;
};

export type Runtime = "bun" | "node";

export function getRuntime(): Runtime {
  if (typeof Bun !== "undefined") return "bun";
  return "node";
}

type TransportDef = {
  name: string;
  runtime: Runtime[];
  pkg: string;
  export: string;
  priority: number;
};

export const TRANSPORTS: TransportDef[] = [
  {
    name: "Bun",
    runtime: ["bun"],
    pkg: "@hyperttp/transport-bun",
    export: "BunTransport",
    priority: 100,
  },
  {
    name: "Undici",
    runtime: ["node"],
    pkg: "@hyperttp/transport-undici",
    export: "UndiciTransport",
    priority: 90,
  },
  {
    name: "Node",
    runtime: ["node", "bun"],
    pkg: "../transports/node.js",
    export: "NodeTransport",
    priority: 10,
  },
];

declare module "@hyperttp/types" {
  interface HttpClientOptions {
    /**
     * @ru Кастомный транспорт, переданный пользователем вручную
     * @en Manually provided custom transport instance
     */
    customTransport?: HyperTransport;
  }
}

export async function resolveTransport(config: HttpClientOptions) {
  const runtime = getRuntime();

  const candidates = TRANSPORTS.filter((t) => t.runtime.includes(runtime)).sort(
    (a, b) => b.priority - a.priority,
  );

  const localRequire = createRequire(process.cwd() + "/package.json");

  for (const t of candidates) {
    config.logger?.("debug", `Loading transport: ${t.name}`);

    try {
      const path = t.pkg.startsWith(".")
        ? new URL(t.pkg, import.meta.url).href
        : localRequire.resolve(t.pkg);

      const mod = await import(path);

      const Transport = mod[t.export] || mod.default;

      if (!Transport) continue;

      config.logger?.("info", `Selected transport: ${t.name}`);
      return new Transport(config);
    } catch (e) {
      config.logger?.("debug", `Skip ${t.name}: ${e}`);
    }
  }

  throw new Error(`No transport for runtime: ${runtime}`);
}

/**
 * @ru Основной оркестратор HTTP-клиента, управляющий жизненным циклом запросов, плагинами и транспортом.
 * @en Main HTTP client orchestrator managing request lifecycle, plugins, and network transports.
 */
export class HyperCore implements IHyperCore {
  /**
   * @ru Текущая конфигурация экземпляра клиента.
   * @en Current client instance configuration.
   */
  public config: HttpClientOptions;

  private transport: HyperTransport | null = null;
  private transportPromise: Promise<HyperTransport> | null = null;
  private readonly defaultHeaders: Record<string, string | string[]>;
  private readonly pluginCtx: PluginContext;

  private readonly requestHooks: HookRecord<
    Required<HyperPlugin>["onRequest"]
  >[] = [];
  private readonly responseHooks: HookRecord<
    Required<HyperPlugin>["onResponse"]
  >[] = [];
  private readonly errorHooks: HookRecord<Required<HyperPlugin>["onError"]>[] =
    [];

  private hasRequestHooks = false;
  private hasResponseHooks = false;
  private hasErrorHooks = false;

  /**
   * @ru Создает новый экземпляр HyperCore.
   * @en Creates a new HyperCore instance.
   * @param config - Client configuration options.
   * @param transport - Pre-configured transport layer.
   */
  constructor(config: HttpClientOptions, transport?: HyperTransport) {
    this.config = {
      ...defaultConfig,
      ...config,
      network: {
        ...defaultConfig.network,
        ...config.network,
      },
    };

    if (transport) {
      this.transport = transport;
      this.transportPromise = Promise.resolve(transport);

      if ("config" in transport) {
        transport.config = this.config;
      }
    }

    this.defaultHeaders = {
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br",
      "User-Agent": this.config.network?.userAgent ?? "Hyperttp/2.0",
      ...(this.config.network?.headers ?? {}),
    };

    this.pluginCtx = {
      config: this.config,
      core: this,
    };
  }

  /**
   * @private
   * @ru Динамически импортирует и инициализирует транспорт в зависимости от рантайма.
   * @en Dynamically imports and initializes transport depending on the runtime environment.
   * @throws Error если не удалось загрузить или инициализировать модуль транспорта.
   * @returns Network transport instance.
   */
  private async createTransport(): Promise<HyperTransport> {
    if (this.config.customTransport) {
      this.config.logger?.("debug", "Using user-provided custom transport.");
      return this.config.customTransport;
    }

    const isBun = typeof Bun !== "undefined";
    const isNode = typeof process !== "undefined" && !!process.versions?.node;

    const strategies = [
      {
        name: "Bun",
        runtime: "bun",
        check: () => isBun,
        pkg: "@hyperttp/transport-bun",
        export: "BunTransport",
      },
      {
        name: "Undici",
        runtime: "node",
        check: () => isNode,
        pkg: "@hyperttp/transport-undici",
        export: "UndiciTransport",
      },
      {
        name: "Node",
        runtime: "all",
        check: () => true,
        pkg: "../transports/node.js",
        export: "NodeTransport",
        isLocal: true,
      },
    ];
    const filtered = strategies.filter((s) => {
      if (s.runtime === "bun") return isBun;
      if (s.runtime === "node") return isNode;
      return true;
    });
    const localRequire = createRequire(process.cwd() + "/package.json");

    for (const strategy of filtered) {
      try {
        this.config.logger?.(
          "debug",
          `Attempting to load ${strategy.name} transport...`,
        );

        const path = strategy.isLocal
          ? new URL(strategy.pkg, import.meta.url).href
          : localRequire.resolve(strategy.pkg);

        const module = await import(path);

        const TransportClass =
          module[strategy.export] ||
          module.default?.[strategy.export] ||
          module.default;

        if (!TransportClass) {
          throw new Error(`Invalid transport export: ${strategy.name}`);
        }

        this.config.logger?.(
          "info",
          `Successfully initialized ${strategy.name} transport.`,
        );

        return new TransportClass(this.config);
      } catch (e) {
        this.config.logger?.("warn", `${strategy.name} transport failed: ${e}`);
      }
    }

    throw new Error("No compatible transport implementation available");
  }

  /**
   * @private
   * @ru Гарантирует синглтон-инициализацию сетевого транспорта.
   * @en Ensures singleton initialization of the network transport layer.
   * @returns Network transport instance promise.
   */
  private ensureTransport(): Promise<HyperTransport> {
    return (
      this.transportPromise ||
      (this.transportPromise = this.createTransport().then((t) => {
        this.transport = t;
        return t;
      }))
    );
  }

  /**
   * @ru Главный конвейер (Hot Path) выполнения запроса, последовательно вызывающий хуки плагинов и сетевой транспорт.
   * @en Main hot path execution pipeline, sequentially running plugin hooks and the network transport.
   * @template T - Type of the expected response body.
   * @param req - Prepared internal request configuration.
   * @returns Formatted HTTP response object.
   */
  public async dispatch<T = unknown>(
    req: InternalRequest,
  ): Promise<HttpResponse<T>> {
    try {
      if (this.hasRequestHooks) {
        for (let i = 0; i < this.requestHooks.length; i++) {
          const shortCircuitResponse = await this.requestHooks[i]!.run(
            req,
            this.pluginCtx,
          );
          if (shortCircuitResponse) {
            return this.executeResponseHooks<T>(shortCircuitResponse, req);
          }
        }
      }

      const transport = this.transport || (await this.ensureTransport());
      const rawResponse = await transport.execute(req as TransportArgs);
      const response = mapResponseFast(rawResponse);

      return this.executeResponseHooks<T>(response, req);
    } catch (error) {
      if (this.hasErrorHooks) {
        const httpError = error as HyperttpError;

        for (let i = 0; i < this.errorHooks.length; i++) {
          const recoveredResponse = await this.errorHooks[i]!.run(
            httpError,
            req,
            this.pluginCtx,
          );
          if (recoveredResponse) {
            return this.executeResponseHooks<T>(recoveredResponse, req);
          }
        }
      }
      throw error;
    }
  }

  /**
   * @private
   * @ru Вспомогательный хелпер прогона сквозной фазы Response.
   * @en Internal helper to run through the cross-cutting Response phase hooks.
   * @template T - Type of the expected response body.
   * @param res - Raw HTTP response object.
   * @param req - Original internal request configuration.
   * @returns Processed response object.
   */
  private async executeResponseHooks<T>(
    res: HttpResponse<any>,
    req: InternalRequest,
  ): Promise<HttpResponse<T>> {
    if (this.hasResponseHooks) {
      for (let i = 0; i < this.responseHooks.length; i++) {
        await this.responseHooks[i]!.run(res, req, this.pluginCtx);
      }
    }
    return res as HttpResponse<T>;
  }

  /**
   * @ru Регистрирует плагин и встраивает его хуки в конвейер выполнения.
   * @en Registers a plugin and injects its hooks into the execution pipeline.
   * @param plugin - Plugin object to register.
   * @returns Current client instance.
   */
  public use(plugin: HyperPlugin): this {
    if (!plugin.enabled(this.config)) {
      return this;
    }

    if (plugin.setup) {
      plugin.setup(this.pluginCtx);
    }

    if (plugin.onRequest) {
      this.requestHooks.push({ name: plugin.name, run: plugin.onRequest });
      this.hasRequestHooks = true;
    }
    if (plugin.onResponse) {
      this.responseHooks.push({ name: plugin.name, run: plugin.onResponse });
      this.hasResponseHooks = true;
    }
    if (plugin.onError) {
      this.errorHooks.push({ name: plugin.name, run: plugin.onError });
      this.hasErrorHooks = true;
    }

    return this;
  }

  /**
   * @ru Выполняет GET-запрос в режиме потоковой передачи (streaming) без прогона через хуки плагинов.
   * @en Executes a GET request in streaming mode, bypassing standard plugin hooks.
   * @param req - Request configurations or targeted URL string.
   * @param signal - Optional signal to abort the stream transport.
   * @returns Stream response mapping container.
   */
  public async stream(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<StreamResponse<unknown>> {
    const isStr = typeof req === "string";
    const url = isStr ? req : req.url;
    const reqHeaders = isStr ? undefined : req.headers;
    const finalSignal = isStr ? signal : (req.signal ?? signal);

    const transportArgs: TransportArgs = {
      method: "GET",
      url,
      headers: mergeHeadersFast(this.defaultHeaders, reqHeaders) as Record<
        string,
        string
      >,
      signal: finalSignal,
    };

    const transport = this.transport || (await this.ensureTransport());
    const rawResponse = await transport.execute(transportArgs);
    return mapStreamFast(rawResponse);
  }

  /**
   * @ru Выполняет HTTP GET-запрос.
   * @en Executes an HTTP GET request.
   * @template T - Type of the expected response body.
   * @param req - Request URL or options object.
   * @param signal - Optional cancellation signal.
   * @returns Wrapped HTTP response.
   */
  public get<T = unknown>(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.dispatch<T>(
      this.buildInternalRequest("GET", req, undefined, signal),
    );
  }

  /**
   * @ru Выполняет HTTP POST-запрос с телом данных.
   * @en Executes an HTTP POST request with a payload body.
   * @template T - Type of the expected response body.
   * @param req - Request URL or options object.
   * @param body - Request body data.
   * @param signal - Optional cancellation signal.
   * @returns Wrapped HTTP response.
   */
  public post<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.dispatch<T>(
      this.buildInternalRequest("POST", req, body, signal),
    );
  }

  /**
   * @ru Выполняет HTTP PUT-запрос с телом данных.
   * @en Executes an HTTP PUT request with a payload body.
   * @template T - Type of the expected response body.
   * @param req - Request URL or options object.
   * @param body - Request body data.
   * @param signal - Optional cancellation signal.
   * @returns Wrapped HTTP response.
   */
  public put<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.dispatch<T>(
      this.buildInternalRequest("PUT", req, body, signal),
    );
  }

  /**
   * @ru Выполняет HTTP PATCH-запрос с телом данных.
   * @en Executes an HTTP PATCH request with a payload body.
   * @template T - Type of the expected response body.
   * @param req - Request URL or options object.
   * @param body - Request body data.
   * @param signal - Optional cancellation signal.
   * @returns Wrapped HTTP response.
   */
  public patch<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.dispatch<T>(
      this.buildInternalRequest("PATCH", req, body, signal),
    );
  }

  /**
   * @ru Выполняет HTTP DELETE-запрос.
   * @en Executes an HTTP DELETE request.
   * @template T - Type of the expected response body.
   * @param req - Request URL or options object.
   * @param signal - Optional cancellation signal.
   * @returns Wrapped HTTP response.
   */
  public delete<T = unknown>(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.dispatch<T>(
      this.buildInternalRequest("DELETE", req, undefined, signal),
    );
  }

  /**
   * @ru Выполняет HTTP OPTIONS-запрос.
   * @en Executes an HTTP OPTIONS request.
   * @template T - Type of the expected response body.
   * @param req - Request URL or options object.
   * @param body - Optional request body data.
   * @param signal - Optional cancellation signal.
   * @returns Wrapped HTTP response.
   */
  public options<T = unknown>(
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.dispatch<T>(
      this.buildInternalRequest("OPTIONS", req, body, signal),
    );
  }

  /**
   * @ru Выполняет HTTP HEAD-запрос. Тело ответа всегда возвращает null.
   * @en Executes an HTTP HEAD request. Response body always resolves to null.
   * @param req - Request URL or options object.
   * @param signal - Optional cancellation signal.
   * @returns Wrapped null response.
   */
  public head(
    req: RequestInterface | string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<null>> {
    return this.dispatch<null>(
      this.buildInternalRequest("HEAD", req, undefined, signal),
    );
  }

  /**
   * @private
   * @ru Быстрый сборщик внутреннего нормализованного состояния запроса.
   * @en Fast compiler of internal normalized request configurations.
   * @param method - HTTP Verb / Method.
   * @param req - User input request target or configuration block.
   * @param body - Request body data.
   * @param signal - Optional AbortSignal.
   * @returns Compiled request payload.
   */
  private buildInternalRequest(
    method: Method,
    req: RequestInterface | string,
    body?: RequestBodyData,
    signal?: AbortSignal,
  ): InternalRequest {
    if (typeof req === "string") {
      return {
        method,
        url: req,
        headers: this.defaultHeaders as Record<string, string>,
        body,
        signal,
        meta: undefined,
      };
    }

    const headers = req.headers
      ? (mergeHeadersFast(this.defaultHeaders, req.headers) as Record<
          string,
          string
        >)
      : (this.defaultHeaders as Record<string, string>);

    return {
      method,
      url: req.url,
      headers,
      body: req.body ?? body,
      signal: req.signal ?? signal,
      meta: req.meta as InternalRequest["meta"],
    };
  }

  /**
   * @ru Создает новую копию ядра, расширяя текущую конфигурацию новыми опциями.
   * @en Creates a new core copy extending the current instance configuration with fresh options.
   * @param options - Partial configuration object override.
   * @returns Extended HyperCore instance.
   */
  public extend(options: Partial<HttpClientOptions>): HyperCore {
    return new HyperCore(
      {
        ...this.config,
        ...options,
        network: { ...this.config.network, ...options.network },
      },
      this.transport ?? undefined,
    );
  }

  /**
   * @ru Алиас метода `extend`. Создает инстанс на базе текущих настроек.
   * @en Alias for `extend` method. Spawn instance configuration based on current setup.
   * @param options - Partial configuration object override.
   * @returns Extended HyperCore instance.
   */
  public create(options: Partial<HttpClientOptions>): HyperCore {
    return this.extend(options);
  }

  /**
   * @ru Завершает работу транспорта и корректно освобождает дескрипторы активных соединений.
   * @en Destroys the transport layer lifecycle and cleans up active sockets accurately.
   * @param graceful - If true, drains pipeline before connection teardown.
   */
  public async destroy(graceful = true): Promise<void> {
    this.config.logger?.("debug", "Destroying transport...");
    const transport = this.transport;
    if (!transport) return;

    if (graceful && typeof transport.close === "function") {
      await transport.close();
    } else if (typeof transport.destroy === "function") {
      await transport.destroy();
    }
  }
}
