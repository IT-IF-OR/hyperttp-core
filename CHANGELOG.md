# Changelog

## [2.0.2] — 2026-09-09

### Added

- Added REST module augmentation for `ProtocolServerRequestMap` and
  `ProtocolServerResponseMap`, enabling typed `core.listen()` handlers.
- Added asynchronous `HyperCore.create()` factory for loading plugins from module paths.
- Added `logger` integration for transport fallback messages, background plugin errors
  and Node.js server errors.
- Added `FetchTransportOptions.onError` for observing incoming server request failures.
- Added coverage measurement through `npm run test:coverage`.

### Fixed

- Fixed `RestProtocol` generic typing for compatibility with
  `@hyperttp/types@0.4.2` contracts.
- Fixed REST header input typing to support `Headers`, header records and tuple arrays.
- Fixed transport diagnostics to use the configured logger when available.
- Pinned GitHub Actions dependencies to immutable commit SHAs.

### Changed

- REST transport requests now use the universal `stream`, `followRedirects` and
  `maxRedirects` fields from `@hyperttp/types`.
- Plugin module paths are resolved through the asynchronous `HyperCore.create()` factory;
  the synchronous constructor remains synchronous and rejects unresolved module paths.

## [2.0.1] — 2026-08-30

### Fixed

- Failed lazy transport resolution no longer leaves a rejected promise cached per protocol, so a later request can retry after a transient transport capability or initialization failure.
- Plugin registration now uses copy-on-write ordering and each request captures one plugin snapshot, preventing a concurrently registered plugin from being skipped, repeated, or applied mid-flight.
- Protocol method registration now ignores inherited enumerable properties and exposes only methods owned by the sender method surface.

### Security

- Pinned every GitHub Actions dependency in CI to a verified full commit SHA, preventing mutable-tag supply-chain substitution.

### Changed

- Clarified that graceful shutdown delegates in-flight server request draining to the transport server's `close()` implementation.
- Expanded public API documentation with bilingual `@ru`/`@en` JSDoc, parameter descriptions, return contracts and usage examples.

## [2.0.0] — 2026-08-21

**Major rewrite and product boundary reset.** The v1 HTTP-specific pipeline is replaced by a small,
protocol-agnostic client/server execution core. The client lifecycle
**prepare → send → parse** is complemented by the server lifecycle
**receive → handle → respond**. Protocols own communication semantics, transports own physical I/O,
and client request plugins own policy and cross-cutting behavior.

### Positioning

- Repositioned `@hyperttp/core` from a high-performance HTTP client to a protocol-agnostic
  client/server orchestration core.
- Defined the stable core boundary as protocol dispatch, transport lifecycle, plugin execution,
  universal errors and the baseline REST protocol.
- Retry execution, caching, authentication, observability, concurrency policies and other
  client request behavior belong in plugins.
- Additional wire semantics belong in `@hyperttp/protocol-*` packages; additional I/O backends
  belong in `@hyperttp/transport-*` packages.
- A protocol may provide a Sender, a Receiver or both. The current `HyperTransport` contract always
  provides client execution and may additionally provide server listening.

### Breaking

- Removed the v1 request/response pipeline: `RequestBuilder`, `NodeTransport`/`BrowserTransport`,
  `Semaphore`, normalization helpers, `HyperHttpResponse` and retry execution/pipeline utilities.
  Retry-shaped configuration remains available for plugin compatibility, but core does not perform
  retries.
- Requests now use `core.send({ protocol, input })` or a typed protocol namespace such as
  `core.rest.get()`. The v1 chainable client API is gone.
- The built-in HTTP protocol identifier is now `rest` (`core.rest.*`, `protocol: "rest"`).
- Raised the supported Node.js version to 20.
- Packaged protocol naming now follows `@hyperttp/protocol-*` instead of separate sender packages.

### Added

- Universal `HyperCore` dispatcher with protocol registration, lazy external protocol loading and
  typed namespaces.
- Unified `HyperProtocol` modules that can contain a client `sender`, a server `receiver`, or both.
- Client lifecycle: `prepare` performs protocol formatting, `send` delegates physical I/O and
  `parse` creates a universal response.
- Server lifecycle: `receive` decodes a transport request, `handle` executes application behavior
  and `respond` serializes the transport response.
- Built-in `RestProtocol`, `RestSender` and `RestReceiver` with client and server roles.
- REST helpers: `get`, `post`, `put`, `patch`, `delete`, `head`, `options`, `request` and `stream`.
- REST query serialization, normalized headers, JSON request bodies, content-aware response
  parsing, timeout propagation and unbuffered stream mode.
- Universal response contract:
  `{ protocol, ok, status, headers, data, statusText?, url?, metadata?, raw? }`.
- `HyperCore.listen()` for connecting a transport server to a protocol receiver and application
  handler.
- Per-request `RequestContext` and `ServerRequestContext` with request ID, timing, signal, metadata
  and shared state.
- Protocol-aware transport resolution for Node.js, Bun and Deno with a browser-safe built-in
  `FetchTransport` fallback.
- Per-protocol transport leases with shared ownership across related cores.
- Client request plugin phases and `onRequest`, `onResponse`, `onError`, `enabled` and `setup` hooks.
- Blocking and background client response hook execution.
- `registerProtocol`, `registerSender`, `registerReceiver` and matching lookup helpers.
- `resolveProtocol`, `resolveSender`, `resolveReceiver` and protocol cache reset helpers.
- `getTransportName`, `getProtocolName`, `getSenderName` and `getReceiverName` introspection.
- `extend()` for related cores, `create()` for isolated cores and idempotent `destroy()`.
- Public REST type entry point at `@hyperttp/core/rest`.
- CI checks for formatting, linting, source and test types, unit tests, build output, browser
  bundling, Node/Bun/Deno smoke tests and installation of the generated package tarball.

### Fixed

- Transport selection now uses the final request protocol instead of always resolving for REST.
- Closed transports are evicted from the global cache before reuse.
- Concurrent transport resolutions are deduplicated and shared transports are closed only after
  the final owner releases them.
- `extend()` shares both resolved and pending transport leases.
- `listen()` no longer leaks a server that resolves while core shutdown is in progress.
- Concurrent `destroy()` calls now share one shutdown promise; forced shutdown falls back to
  `close()` when `destroy()` is unavailable.
- Sender and transport resolution now happen after `onRequest`, so plugins can safely replace the
  request protocol.
- Errors thrown by request hooks now pass through `onError`; early responses also pass through
  response hooks.
- Synchronous failures in background response hooks no longer block the request.
- REST convenience methods preserve `options.signal` when no positional signal is passed.
- REST timeout aborts now use the exported `TimeoutError` contract.
- Non-stream REST responses normalize `ArrayBuffer`, typed views, Blob-like bodies and readable
  streams before parsing.
- `stream()` preserves the live response stream instead of forcing full buffering.
- REST header lookup is fully case-insensitive.
- The Node server adapter passes a relative request target, propagates client disconnects and
  handles already-aborted listen signals.
- Absolute and relative REST URLs now produce a consistent pathname and query representation.

### Changed

- `HyperCore` now resolves, retains and releases transports per protocol rather than owning one
  REST-selected instance.
- Plugin execution follows declared phases while preserving registration order within a phase.
- `config.plugins` accepts plugin instances; module path strings fail explicitly in the synchronous
  constructor.
- Compatibility retry defaults are cloned and merged instead of being shared between core
  instances; retry execution itself is no longer part of core.
- The no-plugin request path, context allocation, transport lookup and REST parsing hot paths were
  optimized for steady-state execution.
- `FetchTransport` loads `node:http` only when `listen()` is called, keeping client imports safe for
  browser bundlers.
- The package description, keywords and documentation now reflect the protocol/transport/plugin
  architecture instead of positioning the package as an HTTP client.
- Tests are included in linting, formatting and TypeScript validation.

### Security

- The built-in Node server fallback limits request bodies by default to reduce memory exhaustion
  risk; custom transports remain responsible for their own limits.
- Dynamic protocol names are validated against core members and prototype-sensitive keys.
- Safe merge protection continues to reject `__proto__`, `constructor` and `prototype` keys.

### Removed

- Deprecated `@hyperttp/sender-rest`; REST is now the baseline protocol in the core.
- The unused `hcacher` peer dependency.
- Separate `src/senders`, `src/receivers`, Node/browser transport implementations and v1 response,
  normalization, retry and pipeline modules.
- The custom npm lifecycle script named `publish`; explicit package publication now uses
  `release:npm`.

## [1.5.6] — 2026-07-23

### Fixed

- **Critical:** fixed global `defaultHeaders` mutation when creating requests with a body or custom headers. Headers are now cloned on demand, preventing `Content-Type: application/json` from leaking into subsequent requests.
- **Critical:** fixed potential raw memory exposure in `HyperHttpResponse.arrayBuffer()` when reading subarray/view buffers (e.g., from Node.js/Bun buffer pools). Safely slices the underlying buffer when `byteOffset` or `byteLength` does not match the parent buffer.
- Fixed repeated `res.json()` calls throwing `Response body is not available as JSON` by properly populating and returning the cached result from `JSON_CACHE`.
- Fixed race condition where requests queued in `Semaphore` would still trigger transport execution even if their `AbortSignal` was aborted while waiting for a slot.
- Fixed user-initiated `AbortSignal` cancellations being incorrectly overridden and re-thrown as `TimeoutError`. Added explicit `isTimeout` tracking on signal controllers.
- Fixed unhandled promise rejection in `drainBody()` when cancelling `ReadableStream` readers during body cleanup.
- Fixed prototype chain breakdown during bundling/transpilation for `HttpClientError` and `TimeoutError` using `Object.setPrototypeOf`.

### Changed

- Replaced `new URL()` and `searchParams` with fast manual query string serialization (`appendQueryString`) in `RequestBuilder`, bypassing C++ binding overhead on hot paths while correctly handling existing `?`/`&` delimiters.
- Replaced `CacheManager` in `normalize.ts` (`fastLowercaseKey`) with a lightweight, flat `Object.create(null)` dictionary map, eliminating TTL/LRU tracking overhead for finite HTTP header keys.
- Streamlined transport loading in `loadCtor` by eliminating redundant `import.meta.resolve` checks before dynamic `import()`.
- Optimized `TransportManager` lifecycle methods (`destroy`, `setConfig`) with direct type-safe method checks.
- Optimized `calcDelay()` in `retryUtils.ts` by replacing floating-point `Math.pow()` with bitwise shift operations (`1 << attempt`).
- Optimized `deepMerge()` by replacing `Object.prototype.toString.call()` with fast direct object checks and removing `Object.keys()` array allocations in favor of `for...in` loops.

### Security

- Added Prototype Pollution protection in `deepMerge()` by filtering out `__proto__`, `constructor`, and `prototype` keys during recursive merging.

### Added

- Added static type guards `HttpClientError.isHttpClientError()` and `TimeoutError.isTimeoutError()` for safe error validation across worker thread and bundle boundaries.

## [1.5.5] — 2026-07-18

### Fixed

- **Critical:** `Semaphore.release()` monotonically incremented `current` when passing a slot to a queued waiter, never decrementing for the finishing request. Under load `current` grew unbounded past `max`, disabling the fast-path in `tryAcquire()`/`acquire()` and forcing every request through `new Promise()` + queue push — a cascade of allocations that overwhelmed GC and bloated heap to ~600 MB.

### Changed

- `Semaphore` rewritten with a ring buffer (pre-allocated array + `head`/`tail` indices). Eliminates `Array.push()`/`.slice()` allocations in steady state; `queue[head] = undefined` releases resolve references immediately for young-generation GC. Buffer only grows (`grow()`) on rare load spikes.

## [1.5.4] — 2026-07-18

### Fixed

- **Critical:** removed `AbortController` pool — at high concurrency (1000+) the 64-entry pool was instantly exhausted and recycled aborted controllers caused cascade `TimeoutError` failures. Each timeout now creates a fresh controller that is simply GC'd after use.

## [1.5.3] — 2026-07-18

### Changed

- Replaced hand-rolled caches (`LRUMap`, ring buffer, `Record`-based `HEADER_KEY_CACHE`) with `CacheManager` from `hcacher` in `RequestBuilder`, `normalize`, and `NodeTransport`.

## [1.5.1] — 2026-07-18

### Added

- Full JSDoc (`@ru`/`@en` + `@param`/`@returns`) for every exported symbol across all `src/` files:
  - `defaultConfig`, `RequestBuilder`, `HyperCore`, `Semaphore`
  - `normalizeUrl`, `normalizeHeaders`, `normalizeBody`, `normalizeBodyForTransport`
  - `cloneBodyFast`, `HyperHttpResponse`, `mapResponseFast`, `recycleResponse`, `mapStreamFast`, `mergeHeadersFast`
- `CHANGELOG.md` file.
