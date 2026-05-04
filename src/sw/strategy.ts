export type CacheStrategy = "shell" | "runtime" | "never";

export function getCacheStrategy(url: URL, method: string): CacheStrategy {
  if (method !== "GET") return "never";
  // Auth-gated endpoints: never cache (per-user ACL would leak across tabs).
  if (url.pathname.startsWith("/api/file")) return "never";
  if (url.pathname.startsWith("/api/thumb")) return "never";
  if (url.pathname.startsWith("/api/trpc")) return "never";
  // State-bearing pages.
  if (url.pathname.startsWith("/setup")) return "never";
  if (url.pathname.startsWith("/admin")) return "never";
  // App shell — STATIC assets only. HTML pages (/, /login, /[provider]/...) are
  // never cached because RootLayout reads getCurrentUser() and embeds the user's
  // name + provider list in the response. Caching those would leak User A's
  // shell HTML to User B on the same browser. Offline coverage for previously-
  // visited directories is provided by the IndexedDB cache from Phase 6, not
  // the SW. The /_next/static/ chunks are content-hashed and user-agnostic.
  if (url.pathname.startsWith("/_next/static")) return "shell";
  // Public, versioned static.
  if (url.pathname.startsWith("/_next/image")) return "runtime";
  if (url.pathname.startsWith("/api/icon")) return "runtime";
  if (url.pathname === "/api/logo") return "runtime";
  // Default deny — including HTML pages, all unknown routes, and credentialled
  // RSC navigations.
  return "never";
}
