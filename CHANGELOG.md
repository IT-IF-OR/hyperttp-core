# Changelog

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
