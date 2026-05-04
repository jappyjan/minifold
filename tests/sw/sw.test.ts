import { describe, it, expect, beforeEach, vi } from "vitest";

type CacheRecord = { keys: Set<string>; entries: Map<string, Response> };

function makeMockCache(): { store: CacheRecord; api: Cache } {
  const store: CacheRecord = { keys: new Set(), entries: new Map() };
  const api = {
    async addAll(reqs: string[]) {
      for (const r of reqs) {
        store.keys.add(r);
        store.entries.set(r, new Response("body"));
      }
    },
    async match(req: string | Request) {
      const key = typeof req === "string" ? req : req.url;
      return store.entries.get(key);
    },
    async put(req: string | Request, res: Response) {
      const key = typeof req === "string" ? req : req.url;
      store.entries.set(key, res);
      store.keys.add(key);
    },
  } as unknown as Cache;
  return { store, api };
}

type EventListener = (...args: unknown[]) => unknown;

function makeMockSelf() {
  const cacheStores = new Map<string, ReturnType<typeof makeMockCache>>();
  const listeners = new Map<string, EventListener>();
  const skipWaiting = vi.fn(async () => {});
  const claim = vi.fn(async () => {});
  return {
    listeners,
    cacheStores,
    skipWaiting,
    claim,
    self: {
      addEventListener: (type: string, fn: EventListener) => listeners.set(type, fn),
      skipWaiting,
      registration: undefined as unknown,
      clients: { claim },
      caches: {
        async open(name: string) {
          let entry = cacheStores.get(name);
          if (!entry) {
            entry = makeMockCache();
            cacheStores.set(name, entry);
          }
          return entry.api;
        },
        async keys() {
          return Array.from(cacheStores.keys());
        },
        async delete(name: string) {
          return cacheStores.delete(name);
        },
        async match(req: string | Request) {
          for (const { api } of cacheStores.values()) {
            const r = await api.match(req);
            if (r) return r;
          }
          return undefined;
        },
      },
    },
  };
}

describe("service worker", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function loadSW(env: ReturnType<typeof makeMockSelf>) {
    // Inject mocks via globalThis before importing. `self` and `caches` already
    // exist on globalThis with stricter types, so cast through `unknown` for
    // the override; SHELL_VERSION and PRECACHE_LIST are esbuild build-time
    // defines (not declared on globalThis at all), so an extension intersection
    // is enough for them.
    type Defines = { SHELL_VERSION: string; PRECACHE_LIST: string[] };
    const g = globalThis as typeof globalThis & Defines;
    (g as unknown as { self: unknown }).self = env.self;
    (g as unknown as { caches: unknown }).caches = env.self.caches;
    g.SHELL_VERSION = "test-sha";
    g.PRECACHE_LIST = ["/", "/login"];
    return import("@/sw/sw");
  }

  it("registers install/activate/fetch listeners", async () => {
    const env = makeMockSelf();
    await loadSW(env);
    expect(env.listeners.has("install")).toBe(true);
    expect(env.listeners.has("activate")).toBe(true);
    expect(env.listeners.has("fetch")).toBe(true);
  });

  it("install populates the shell-v<sha> cache and skips waiting", async () => {
    const env = makeMockSelf();
    await loadSW(env);
    const installEvent = { waitUntil: vi.fn(async (p) => p) } as unknown as ExtendableEvent;
    await env.listeners.get("install")!(installEvent);
    // Drain the awaited promise.
    await installEvent.waitUntil((async () => {})());
    expect(env.cacheStores.has("shell-vtest-sha")).toBe(true);
    const cache = env.cacheStores.get("shell-vtest-sha")!;
    expect(cache.store.keys.has("/")).toBe(true);
    expect(cache.store.keys.has("/login")).toBe(true);
    expect(env.skipWaiting).toHaveBeenCalled();
  });

  it("activate deletes shell-v* caches that don't match the current version", async () => {
    const env = makeMockSelf();
    await loadSW(env);
    // Pre-populate two stale caches and the current one.
    await env.self.caches.open("shell-vold-sha-1");
    await env.self.caches.open("shell-vold-sha-2");
    await env.self.caches.open("shell-vtest-sha");
    await env.self.caches.open("runtime-static");
    const activateEvent = { waitUntil: vi.fn(async (p) => p) } as unknown as ExtendableEvent;
    await env.listeners.get("activate")!(activateEvent);
    await activateEvent.waitUntil((async () => {})());
    expect(env.cacheStores.has("shell-vold-sha-1")).toBe(false);
    expect(env.cacheStores.has("shell-vold-sha-2")).toBe(false);
    expect(env.cacheStores.has("shell-vtest-sha")).toBe(true);
    expect(env.cacheStores.has("runtime-static")).toBe(true); // not a shell-* cache; left alone
    expect(env.claim).toHaveBeenCalled();
  });
});
