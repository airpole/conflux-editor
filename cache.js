// ============================================================
//  CACHE — generic dirty-flag cache with declared dependencies
// ============================================================
// Each cache is a (key, deps[], build) triple:
//   - deps[]: identifiers of what the cache depends on
//     (typically D.xxx field names like 'shapeEvents', 'lineEvents')
//   - build(): pure function producing the current value
//
// Mutators call `invalidate(['shapeEvents'])` instead of a bespoke
// `invalidateShapeCache()`. Every cache declaring that dep is marked dirty.
// Readers call `get('leftChain')` which rebuilds on demand and memoizes.
//
// This replaces five hand-rolled dirty-flag pairs in v19 with one pattern.

const caches = new Map();

/**
 * Register a cache.
 * @param {string} key           unique cache name
 * @param {string[]} deps        source-of-truth identifiers this cache depends on
 * @param {() => any} build      builder function; called lazily, memoized until invalidated
 */
export function defineCache(key, deps, build) {
  if (caches.has(key)) throw new Error(`Cache already defined: ${key}`);
  caches.set(key, { deps, build, value: undefined, dirty: true });
}

/** Read a cache's value. Builds on first access and after invalidation. */
export function get(key) {
  const c = caches.get(key);
  if (!c) throw new Error(`Unknown cache: ${key}`);
  if (c.dirty) {
    c.value = c.build();
    c.dirty = false;
  }
  return c.value;
}

/**
 * Mark every cache that depends on any of the given keys as dirty.
 * Caches rebuild lazily on the next `get()`.
 */
export function invalidate(depKeys) {
  for (const c of caches.values()) {
    if (c.deps.some(d => depKeys.includes(d))) c.dirty = true;
  }
}

/** Force all caches dirty. Used after whole-chart reload. */
export function invalidateAll() {
  for (const c of caches.values()) c.dirty = true;
}
