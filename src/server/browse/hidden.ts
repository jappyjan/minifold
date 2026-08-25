// Two tiers of filtering for browse listings:
//
// 1. Internal — Minifold's own bookkeeping files (`.minifold_*`: access rules,
//    thumbnail sidecars, …). These are never shown, regardless of the
//    "Show hidden files" toggle.
// 2. Hidden — the user's dotfiles and OS droppings. Hidden by default, but
//    revealable in the UI via `?showHidden=1`.
export function isInternalEntry(name: string): boolean {
  return name.startsWith(".minifold_");
}

// Non-dotfile OS droppings. Case-insensitive (Windows/macOS match loosely).
const OS_JUNK = new Set(["thumbs.db", "desktop.ini", "__macosx"]);

// "Hidden by default": Unix-style dotfiles (which also cover .git, .svn,
// .hg, .idea, .vscode, .env, .DS_Store, ._* AppleDouble) plus OS junk.
export function isHiddenEntry(name: string): boolean {
  if (name.startsWith(".")) return true;
  return OS_JUNK.has(name.toLowerCase());
}

// Final visibility decision for a listing row.
export function isListableEntry(name: string, showHidden: boolean): boolean {
  if (isInternalEntry(name)) return false;
  return showHidden || !isHiddenEntry(name);
}
