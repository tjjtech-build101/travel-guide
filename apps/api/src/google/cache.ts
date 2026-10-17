// Cache en memoria (por instancia de la función) con TTL. Clave = input serializado.
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 500;
const store = new Map<string, { exp: number; value: unknown }>();

export async function cached<T>(key: string, fn: () => Promise<T>, ttlMs = TTL_MS): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.exp > now) return hit.value as T;
  const value = await fn();
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { exp: now + ttlMs, value });
  return value;
}

export function clearCache() {
  store.clear();
}
