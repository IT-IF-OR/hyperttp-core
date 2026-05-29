import { defaultConfig } from "../defaultConfig.js";
import { mapResponseFast, mapStreamFast, mergeHeadersFast, } from "../utils/response.js";
import { createRequire } from "node:module";
import { createPipelines, executeErrorPipeline, executeRequestPipeline, executeResponsePipeline, insertHookSorted, } from "../utils/pipeline.js";
import { normalizeBody, normalizeHeaders, normalizeMethod, } from "../utils/normalize.js";
export function getRuntime() {
    if (typeof Bun !== "undefined")
        return "bun";
    return "node";
}
export const TRANSPORTS = [
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
export async function resolveTransport(config) {
    if (config.customTransport) {
        config.logger?.("debug", "Using user-provided custom transport.");
        return config.customTransport;
    }
    const runtime = getRuntime();
    const candidates = TRANSPORTS.filter((t) => t.runtime.includes(runtime)).sort((a, b) => b.priority - a.priority);
    const localRequire = createRequire(process.cwd() + "/package.json");
    for (const t of candidates) {
        config.logger?.("debug", `Loading transport: ${t.name}`);
        try {
            const path = t.pkg.startsWith(".")
                ? new URL(t.pkg, import.meta.url).href
                : localRequire.resolve(t.pkg);
            const mod = await import(path);
            const Transport = mod[t.export] || mod.default?.[t.export] || mod.default;
            if (!Transport)
                continue;
            config.logger?.("info", `Selected transport: ${t.name}`);
            return new Transport(config);
        }
        catch (e) {
            config.logger?.("debug", `Skip ${t.name}: ${e}`);
        }
    }
    throw new Error(`No compatible transport implementation available for runtime: ${runtime}`);
}
export class HyperCore {
    config;
    transport = null;
    transportPromise = null;
    defaultHeaders;
    pluginCtx;
    pipelines = createPipelines();
    constructor(config = defaultConfig, transport) {
        this.config = {
            ...defaultConfig,
            ...config,
            network: { ...defaultConfig.network, ...config.network },
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
            ...this.config.network?.headers,
        };
        this.pluginCtx = { config: this.config, core: this };
    }
    async createTransport() {
        return resolveTransport(this.config);
    }
    ensureTransport() {
        return (this.transportPromise ||
            (this.transportPromise = this.createTransport().then((t) => {
                this.transport = t;
                return t;
            })));
    }
    async dispatch(req) {
        try {
            const shortCircuit = await executeRequestPipeline(this.pipelines.request, req, this.pluginCtx);
            if (shortCircuit) {
                await executeResponsePipeline(this.pipelines.responseMutators, this.pipelines.responseSideEffects, shortCircuit, req, this.pluginCtx, this.config.logger);
                return shortCircuit;
            }
            const transport = this.transport || (await this.ensureTransport());
            const rawResponse = await transport.execute(req);
            const response = mapResponseFast(rawResponse);
            await executeResponsePipeline(this.pipelines.responseMutators, this.pipelines.responseSideEffects, response, req, this.pluginCtx, this.config.logger);
            return response;
        }
        catch (error) {
            const httpError = error;
            const recovered = await executeErrorPipeline(this.pipelines.error, httpError, req, this.pluginCtx);
            if (recovered) {
                await executeResponsePipeline(this.pipelines.responseMutators, this.pipelines.responseSideEffects, recovered, req, this.pluginCtx, this.config.logger);
                return recovered;
            }
            throw error;
        }
    }
    use(plugin) {
        const isEnabled = plugin.enabled ? plugin.enabled(this.config) : true;
        if (!isEnabled)
            return this;
        if (plugin.setup)
            plugin.setup(this.pluginCtx);
        const priority = plugin.priority ?? 0;
        if (plugin.onRequest) {
            insertHookSorted(this.pipelines.request, {
                name: plugin.name,
                priority,
                run: plugin.onRequest,
            });
        }
        if (plugin.onResponse) {
            if (plugin.mode === "background") {
                insertHookSorted(this.pipelines.responseSideEffects, {
                    name: plugin.name,
                    priority,
                    run: plugin.onResponse,
                });
            }
            else {
                insertHookSorted(this.pipelines.responseMutators, {
                    name: plugin.name,
                    priority,
                    run: plugin.onResponse,
                });
            }
        }
        if (plugin.onError) {
            insertHookSorted(this.pipelines.error, {
                name: plugin.name,
                priority,
                run: plugin.onError,
            });
        }
        return this;
    }
    async stream(req, signal) {
        const isStr = typeof req === "string";
        const url = isStr ? req : req.url;
        const reqHeaders = isStr ? undefined : req.headers;
        const finalSignal = isStr ? signal : (req.signal ?? signal);
        const transportArgs = {
            method: normalizeMethod("GET"),
            url,
            headers: normalizeHeaders(mergeHeadersFast(this.defaultHeaders, reqHeaders)),
            signal: finalSignal,
        };
        const transport = this.transport || (await this.ensureTransport());
        const rawResponse = await transport.execute(transportArgs);
        return mapStreamFast(rawResponse);
    }
    get(req, signal) {
        return this.dispatch(this.buildInternalRequest("GET", req, undefined, signal));
    }
    post(req, body, signal) {
        return this.dispatch(this.buildInternalRequest("POST", req, body, signal));
    }
    async postStream(req, body, signal) {
        const isStr = typeof req === "string";
        const url = isStr ? req : req.url;
        const reqHeaders = isStr ? undefined : req.headers;
        const finalSignal = isStr ? signal : (req.signal ?? signal);
        const transportArgs = {
            method: normalizeMethod("POST"),
            url,
            headers: normalizeHeaders(mergeHeadersFast(this.defaultHeaders, reqHeaders)),
            body: normalizeBody("POST", isStr ? body : (req.body ?? body)),
            signal: finalSignal,
        };
        const transport = this.transport || (await this.ensureTransport());
        const rawResponse = await transport.execute(transportArgs);
        return mapStreamFast(rawResponse);
    }
    put(req, body, signal) {
        return this.dispatch(this.buildInternalRequest("PUT", req, body, signal));
    }
    patch(req, body, signal) {
        return this.dispatch(this.buildInternalRequest("PATCH", req, body, signal));
    }
    delete(req, signal) {
        return this.dispatch(this.buildInternalRequest("DELETE", req, undefined, signal));
    }
    options(req, body, signal) {
        return this.dispatch(this.buildInternalRequest("OPTIONS", req, body, signal));
    }
    head(req, signal) {
        return this.dispatch(this.buildInternalRequest("HEAD", req, undefined, signal));
    }
    buildInternalRequest(method, req, body, signal) {
        const isStr = typeof req === "string";
        let rawUrl = isStr ? req : req?.url;
        if (!rawUrl && !isStr && req && "scheme" in req && "host" in req) {
            const casted = req;
            try {
                const cleanHost = String(casted.host).replace(/^https?:\/\//i, "");
                const urlObj = new URL(`${casted.scheme}://${cleanHost}`);
                if (casted.port)
                    urlObj.port = String(casted.port);
                if (casted.path)
                    urlObj.pathname = casted.path;
                if (casted.query) {
                    for (const [key, value] of Object.entries(casted.query)) {
                        if (value == null)
                            continue;
                        if (Array.isArray(value)) {
                            value.forEach((v) => urlObj.searchParams.append(key, String(v)));
                        }
                        else {
                            urlObj.searchParams.set(key, String(value));
                        }
                    }
                }
                rawUrl = urlObj.toString();
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
            }
            catch (_e) {
                //
            }
        }
        if (this.config.baseURL && rawUrl && !/^https?:\/\//i.test(rawUrl)) {
            rawUrl = new URL(rawUrl, this.config.baseURL).toString();
        }
        if (!rawUrl) {
            throw new Error(`[HyperttpCore] Critical execution failure during ${method} method invocation: 'url' resolved to undefined. ` +
                `Verify incoming arguments or environment configurations.`);
        }
        if (isStr) {
            return {
                method: normalizeMethod(method),
                url: rawUrl,
                headers: normalizeHeaders(this.defaultHeaders),
                body,
                signal,
                meta: undefined,
            };
        }
        const castedReq = req;
        const rawHeaders = req.headers ?? castedReq._headers;
        const headers = rawHeaders
            ? mergeHeadersFast(this.defaultHeaders, rawHeaders)
            : { ...this.defaultHeaders };
        const internalRequest = {
            method: normalizeMethod(method),
            url: rawUrl,
            headers: normalizeHeaders(headers),
            body: normalizeBody(method, castedReq.body ?? castedReq._bodyData ?? body),
            signal: req.signal ?? castedReq._signal ?? signal,
            meta: (req.meta ?? castedReq._meta),
        };
        this.config.logger?.("debug", `[HyperttpCore] Internal request dispatched: { ` +
            `method: "${internalRequest.method}", ` +
            `url: "${internalRequest.url}", ` +
            `headersCount: ${Object.keys(internalRequest.headers).length}, ` +
            `bodyType: "${typeof internalRequest.body}", ` +
            `bodyLength: ${typeof internalRequest.body === "string" ? internalRequest.body.length : 0} ` +
            `}`);
        return internalRequest;
    }
    extend(options) {
        this.config = {
            ...this.config,
            ...options,
            network: { ...this.config.network, ...options.network },
        };
        this.pluginCtx.config = this.config;
        return this;
    }
    create(options) {
        return new HyperCore({
            ...this.config,
            ...options,
            network: { ...this.config.network, ...options.network },
        }, this.transport ?? undefined);
    }
    async destroy(graceful = true) {
        this.config.logger?.("debug", "Destroying transport...");
        const transport = this.transport;
        if (!transport)
            return;
        if (graceful && typeof transport.close === "function") {
            await transport.close();
        }
        else if (typeof transport.destroy === "function") {
            await transport.destroy();
        }
    }
    async json(req, signal) {
        const method = typeof req === "string"
            ? "GET"
            : (req.method ?? "GET");
        const res = await this.dispatch(this.buildInternalRequest(method, req, undefined, signal));
        return res.json();
    }
    async text(req, signal) {
        const method = typeof req === "string"
            ? "GET"
            : (req.method ?? "GET");
        const res = await this.dispatch(this.buildInternalRequest(method, req, undefined, signal));
        return res.text();
    }
    async dump(req, signal) {
        const method = typeof req === "string"
            ? "GET"
            : (req.method ?? "GET");
        const res = await this.dispatch(this.buildInternalRequest(method, req, undefined, signal));
        await res.dump();
    }
}
//# sourceMappingURL=HyperCore.js.map