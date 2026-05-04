/// <reference lib="webworker" />
import { getCacheStrategy } from "./strategy";

// Injected by esbuild at build time (scripts/build-sw.ts):
declare const SHELL_VERSION: string;
declare const PRECACHE_LIST: ReadonlyArray<string>;

const swSelf = self as unknown as ServiceWorkerGlobalScope;
const SHELL_CACHE = `shell-v${SHELL_VERSION}`;
const RUNTIME_CACHE = "runtime-static";

swSelf.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(PRECACHE_LIST as string[]);
      await swSelf.skipWaiting();
    })(),
  );
});

swSelf.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("shell-v") && n !== SHELL_CACHE)
          .map((n) => caches.delete(n)),
      );
      await swSelf.clients.claim();
    })(),
  );
});

swSelf.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only same-origin GETs go through the SW caching paths.
  const url = new URL(req.url);
  if (url.origin !== swSelf.location.origin) return;
  const strategy = getCacheStrategy(url, req.method);
  if (strategy === "never") return; // fall through to network

  if (strategy === "shell") {
    // shell = static chunks (content-hashed, user-agnostic). Cache-first.
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        try {
          return await fetch(req);
        } catch {
          return new Response("Offline", { status: 503 });
        }
      })(),
    );
    return;
  }

  // strategy === "runtime": stale-while-revalidate
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      const networkPromise = fetch(req)
        .then((res) => {
          // Only cache successful, basic-typed responses (avoid opaque/cors issues).
          if (res.ok && res.type === "basic") {
            cache.put(req, res.clone()).catch(() => undefined);
          }
          return res;
        })
        .catch(() => cached); // fall back to cached on network error
      return cached ?? (await networkPromise) ?? new Response("Offline", { status: 503 });
    })(),
  );
});
