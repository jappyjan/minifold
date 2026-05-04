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
  // App shell.
  if (url.pathname.startsWith("/_next/static")) return "shell";
  if (url.pathname === "/" || url.pathname === "/login") return "shell";
  // Public, versioned static.
  if (url.pathname.startsWith("/_next/image")) return "runtime";
  if (url.pathname.startsWith("/api/icon")) return "runtime";
  if (url.pathname === "/api/logo") return "runtime";
  // Default deny.
  return "never";
}
