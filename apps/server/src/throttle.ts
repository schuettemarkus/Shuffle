// Per-session throttle. Returns false when the caller is sending too fast,
// so the room can drop the message without erroring out the socket.
//
// Stored in-memory (per server process). Phase 5 will swap this for a token
// bucket backed by Redis when we shard across nodes.

interface Bucket {
  last: number;
}

const buckets = new Map<string, Map<string, Bucket>>();

export function allow(scope: string, key: string, minIntervalMs: number): boolean {
  let inner = buckets.get(scope);
  if (!inner) {
    inner = new Map();
    buckets.set(scope, inner);
  }
  const now = Date.now();
  const b = inner.get(key);
  if (b && now - b.last < minIntervalMs) return false;
  inner.set(key, { last: now });
  return true;
}

export function forget(scope: string, key: string) {
  buckets.get(scope)?.delete(key);
}
