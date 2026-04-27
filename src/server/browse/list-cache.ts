import type { Entry, StorageProvider } from "@/server/storage/types";

type CacheRecord = {
  entries: Entry[] | null; // null until first successful fetch
  freshUntil: number;
  staleUntil: number;
  refreshing: Promise<Entry[]> | null;
};

const cache = new Map<string, CacheRecord>();

const TTL_FRESH_MS = Number(process.env.MINIFOLD_LIST_CACHE_FRESH_MS ?? 30_000);
const TTL_STALE_MS = Number(process.env.MINIFOLD_LIST_CACHE_STALE_MS ?? 300_000);

function key(slug: string, path: string): string {
  return `${slug}/${path}`;
}

function fresh(entries: Entry[]): CacheRecord {
  const now = Date.now();
  return {
    entries,
    freshUntil: now + TTL_FRESH_MS,
    staleUntil: now + TTL_STALE_MS,
    refreshing: null,
  };
}

export async function listWithCache(
  provider: StorageProvider,
  path: string,
): Promise<Entry[]> {
  const k = key(provider.slug, path);
  const now = Date.now();
  const rec = cache.get(k);

  // Fresh: serve cache, no work.
  if (rec?.entries && now < rec.freshUntil) {
    return rec.entries;
  }

  // Stale-while-revalidate: serve cached, refresh in background.
  if (rec?.entries && now < rec.staleUntil) {
    if (!rec.refreshing) {
      rec.refreshing = provider
        .list(path)
        .then((entries) => {
          cache.set(k, fresh(entries));
          return entries;
        })
        .catch(() => {
          // Background refresh failed; keep serving stale until staleUntil.
          if (rec.refreshing) rec.refreshing = null;
          return rec.entries!;
        });
    }
    return rec.entries;
  }

  // Cold or expired: must wait for a real list.
  if (rec?.refreshing) return rec.refreshing;

  const promise = provider
    .list(path)
    .then((entries) => {
      cache.set(k, fresh(entries));
      return entries;
    })
    .catch((err) => {
      // Cold-fetch failed; clear in-flight marker so the next call retries.
      const cur = cache.get(k);
      if (cur && cur.refreshing === promise) cur.refreshing = null;
      throw err;
    });

  // Mark in-flight so concurrent cold callers dedupe.
  if (rec) {
    rec.refreshing = promise;
  } else {
    cache.set(k, {
      entries: null,
      freshUntil: 0,
      staleUntil: 0,
      refreshing: promise,
    });
  }

  return promise;
}

// Test-only: clear all cached entries.
export function __clearListCache(): void {
  cache.clear();
}
