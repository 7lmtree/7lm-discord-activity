/** Simple in-memory TTL cache (trending / anime / sources) */

export function createTtlCache({ defaultTtlMs = 90_000, maxEntries = 200 } = {}) {
  const map = new Map();

  function prune() {
    if (map.size <= maxEntries) return;
    const excess = map.size - maxEntries;
    let i = 0;
    for (const key of map.keys()) {
      map.delete(key);
      i += 1;
      if (i >= excess) break;
    }
  }

  function get(key) {
    const hit = map.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > hit.ttlMs) {
      map.delete(key);
      return null;
    }
    return hit.body;
  }

  function set(key, body, ttlMs = defaultTtlMs) {
    map.set(key, { body, at: Date.now(), ttlMs });
    prune();
  }

  function stats() {
    return { size: map.size, maxEntries };
  }

  return { get, set, stats };
}
