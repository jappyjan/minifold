# Hidden & System Files — Design Spec

**Date:** 2026-08-18
**Status:** Approved
**Summary:** Filter hidden files (Unix dotfiles), system junk, and VCS/editor directories out of the browse UI by default, with a per-folder "Show hidden files" toggle that reveals them. Minifold's own internal `.minifold_*` bookkeeping files remain hidden unconditionally.

---

## 1. Goals & Non-Goals

**Goals:**
- Hide dotfiles (`.*`), non-dotfile OS droppings (`Thumbs.db`, `desktop.ini`, `__MACOSX`), and VCS/editor directories (`.git`, `.svn`, `.hg`, `.idea`, `.vscode`) from listings by default.
- Provide a per-folder toggle (URL param) to reveal them, mirroring the existing "Show description files" (`?showAll=1`) pattern.
- Keep Minifold's internal `.minifold_*` files (access rules, thumbnail sidecars) hidden no matter what.
- Preserve the directory-hash and access-control invariants unchanged.

**Non-Goals (v1):**
- A persisted global "always show hidden" user preference. The toggle is per-folder, matching `?showAll=`.
- Hiding `node_modules` or other package-manager directories. They are neither dotfiles nor OS junk; if desired this becomes a follow-up.
- Blocking direct access to hidden files by URL or the `/api/file/*` download route. This change only affects *listings*.

---

## 2. Architecture

Two-tier classification replaces the single `isHiddenEntry` check that today only matches `.minifold_*`:

```
internal  (isInternalEntry)  → .minifold_*            never listed
hidden    (isHiddenEntry)    → dotfiles + OS junk     hidden unless showHidden
listable  (isListableEntry)  → !internal && (showHidden || !hidden)
```

Filtering happens server-side, before access-control resolution, in the two places that already call `isHiddenEntry`:

1. `src/app/[provider]/[[...path]]/page.tsx` — `loadAllowedListing` (grid, column, and file-detail sibling lookup).
2. `src/server/trpc/routers/browse.ts` — `browse.list` query.

The toggle is a server-rendered `<Link>` (same pattern as the existing "Show description files" link), so toggling triggers a normal Next.js navigation and re-render. This preserves the SSR-as-source-of-truth model: hidden filenames are never sent to the browser unless explicitly requested.

### Classification — `src/server/browse/hidden.ts`

```ts
// Minifold's own bookkeeping files — never listed.
export function isInternalEntry(name: string): boolean {
  return name.startsWith(".minifold_");
}

// Non-dotfile OS droppings. Case-insensitive.
const OS_JUNK = new Set(["thumbs.db", "desktop.ini", "__macosx"]);

// "Hidden by default": Unix-style dotfiles (which also cover .git, .svn, .hg,
// .idea, .vscode, .env, .DS_Store, ._* AppleDouble) plus OS junk.
export function isHiddenEntry(name: string): boolean {
  if (name.startsWith(".")) return true;
  return OS_JUNK.has(name.toLowerCase());
}

// Final visibility decision for a listing row.
export function isListableEntry(name: string, showHidden: boolean): boolean {
  if (isInternalEntry(name)) return false;
  return showHidden || !isHiddenEntry(name);
}
```

### `page.tsx` wiring

- `loadAllowedListing(provider, resolver, path, showHidden)` filters `raw` with `isListableEntry(e.name, showHidden)` in place of `isHiddenEntry(e.name)`.
- The page reads `const showHidden = sp.showHidden === "1";`.
- Grid directory branch, column branch (each ancestor column), and file-detail sibling lookup all pass `showHidden` through.
- `SearchParams` type gains `showHidden?: string | string[]`.

### `browse.list` tRPC wiring

- Input gains `showHidden: z.boolean().optional()`.
- Filter uses `isListableEntry(e.name, input.showHidden ?? false)`.

### Toggle UI

Server-rendered in the directory branches (grid and column), next to the existing sidecar toggle:

```
Show hidden files (N)   ⇄   Hide hidden files (N)
```

- `N = raw.filter(e => !isInternalEntry(e.name) && isHiddenEntry(e.name)).length`, computed server-side.
- Rendered only when `N > 0`.
- The href preserves existing query params (`show`, `view`, `showAll`) and flips `showHidden` between `1` and absent. Unlike the existing naive `href="?showAll=1"` sidecar link, this one builds the query string with `mergeSearchParams` so no params are dropped.

---

## 3. Invariants

- **Hash stability:** `computeDirHash(raw)` continues to run on the *full* raw list before any filtering. Hidden files still affect the hash, so toggling `showHidden` never invalidates the cache and existing "hidden entries affect the hash" semantics hold.
- **Access control:** every revealed entry (including dotfiles) still passes through `createAccessResolver` before being returned. Internal `.minifold_*` files are filtered before resolution and are never resolved or returned.
- **Privacy by default:** hidden filenames are only transmitted when the user toggles them on.

---

## 4. Testing

- `tests/server/browse/hidden.test.ts`:
  - `isInternalEntry(".minifold_access.json")` → true; `isInternalEntry(".env")` → false.
  - `isHiddenEntry(".gitkeep")`, `.env`, `.git`, `.idea` → true (previously false).
  - `isHiddenEntry("Thumbs.db")`, `"desktop.ini"`, `"__MACOSX"` (any case) → true.
  - `isHiddenEntry("anchor.stl")`, `"README.md"` → false.
  - `isListableEntry`: internal always false; dotfile false when `showHidden=false`, true when `showHidden=true`; normal file always true.
- `tests/server/trpc/browse.test.ts`:
  - New: a `.env` sibling is hidden by default and returned with `showHidden:true`.
  - New: `.minifold_*` remains absent even with `showHidden:true`.
  - Existing tests remain green (their fixtures only use `.minifold_*` dotfiles, which stay filtered).
