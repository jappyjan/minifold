// Hides files Minifold uses for its own bookkeeping (thumbs, access rules, …).
// Anything starting with ".minifold_" is for our internal use; everything else
// — including .gitkeep, .env, etc — is the user's business and stays visible.
export function isHiddenEntry(name: string): boolean {
  return name.startsWith(".minifold_");
}
