# Changelog

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
