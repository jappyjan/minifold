// Top-level route segments shipped by the app. Provider slugs may not collide
// with these, otherwise Next.js's static routes would shadow the provider URL.
// Keep this list in lock-step with new top-level folders under src/app/.
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "favicon.ico",
  "login",
  "logout",
  "setup",
  "_next",
]);

export function isReservedSlug(s: string): boolean {
  return RESERVED_SLUGS.has(s.trim().toLowerCase());
}
