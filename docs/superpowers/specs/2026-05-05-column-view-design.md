# Column View — Design Spec

**Date:** 2026-05-05
**Status:** Approved
**Summary:** Add a macOS Finder-style column view to the file browser as an opt-in toggle alongside the existing grid. Each ancestor directory becomes its own column; selecting a directory opens the next column, and selecting a file pins a detail strip below the columns. Tablet/desktop only (≥768 px). Closes the §10 spec gap that has been outstanding since the file-browsing MVP.

---

## 1. Goals & Non-Goals

**Goals:**
- Provide a dense hierarchical navigation surface that scales to deep folder trees without losing context.
- Toggleable from the existing browse toolbar; persists per-user via URL + `localStorage`.
- Reuse all existing browse machinery — `listWithCache`, the access resolver, hidden-entry filtering, sort, IDB seeding — without forking.
- Preserve every existing query-param contract (`?show=`, `?showAll=`).

**Non-Goals (v1):**
- Keyboard navigation (arrow keys, focus management). Mouse/touch only.
- Folder description rendering above columns (`index.md`, `readme.md`, etc.).
- Thumbnails inside column rows (icons only — keep the columns dense).
- Live hash-based refresh of columns mid-session (rely on Next.js navigation).
- Multi-select, drag-drop, context menus.

---

## 2. Architecture

Same Next.js route — `src/app/[provider]/[[...path]]/page.tsx` — with a new query-param branch.

```
URL                                          → renders
/nas?view=column                             → 1 column (root of nas)
/nas/foo?view=column                         → 2 columns (nas | foo)
/nas/foo/bar?view=column                     → 3 columns (nas | foo | bar)
/nas/foo/bar/baz.stl?view=column             → 3 columns + detail strip
/nas/foo/bar/baz.stl                         → existing detail page (no toggle visible)
/nas/foo/bar                                 → existing grid view (no view param = grid)
```

### `SearchParams` extension

The page's `SearchParams` type currently is `{ showAll?: string | string[] }`. Extend it to:

```ts
type SearchParams = { showAll?: string | string[]; view?: string | string[] };
```

Read defensively — `view` may arrive as `string[]` if duplicated:

```ts
const viewParam = Array.isArray(sp.view) ? sp.view[0] : sp.view;
const view = viewParam === 'column' ? 'column' : 'grid';
```

### RSC flow

1. Resolve `provider`, `segments`, target `entry` (existing logic).
2. If `view !== 'column'`: fall through to existing grid render. **Done.**
3. If `entry.type === 'file'`, the deepest column is `entry`'s parent directory; the file becomes the **selected leaf** (rendered in its parent's column with active highlighting; populates the detail strip).
4. If `entry.type === 'directory'`, the deepest column is `entry` itself; no detail strip.
5. Build the **ancestor chain** as a list of directory paths from the provider root down to the deepest column, inclusive.
6. `Promise.all` over the ancestor chain → for each, run the existing pipeline: `listWithCache` → access-resolver per-child filter → `isHiddenEntry` filter → `sortEntries`. Result: `Column[]` where each column has `{ path, entries, hash }`.
7. If the **deepest column** is denied by the resolver, behave like grid view (login redirect for anon, 404 for authed). Other intermediate-column denials should not occur because the resolver only short-circuits on dir reads — child filtering hides individual entries.
8. Pass `Column[]` and the optional selected-leaf entry to a new `<ColumnBrowser>` client component.

**Active-row mapping (URL → column highlight):** the active row in column at depth `N` (zero-indexed, root = 0) is the child whose name equals `segments[N]`. For the deepest column whose path itself ends at the URL leaf, no active row is shown. Worked examples:

| URL | segments | columns | active per column |
|---|---|---|---|
| `/nas?view=column` | `[]` | `[root]` | (none) |
| `/nas/foo?view=column` | `['foo']` | `[root, foo]` | col 0: `foo`; col 1: (none) |
| `/nas/foo/bar?view=column` | `['foo','bar']` | `[root, foo, foo/bar]` | col 0: `foo`; col 1: `bar`; col 2: (none) |
| `/nas/foo/bar.stl?view=column` | `['foo','bar.stl']` | `[root, foo]` | col 0: `foo`; col 1: `bar.stl` (file leaf, populates strip) |
| `/nas/baz.stl?view=column` | `['baz.stl']` | `[root]` | col 0: `baz.stl` (file leaf at root, populates strip) |

### Client component: `ColumnBrowser`

Mirrors `FolderBrowser` but renders multiple columns:

- Receives `columns: Column[]`, `selectedLeaf: Entry | null`, `providerSlug`, `parentPathOfLeaf` (when applicable), `thumbnailsEnabled`.
- Mounts: fire-and-forget IDB seed for *each* column via `setCachedDir` (parallel, unawaited).
- Renders a horizontally-scrollable strip with `scroll-snap-type: x proximity` so manual scrolling lands on column boundaries.
- After mount and after URL changes, `useEffect` scrolls the rightmost column into view with `behavior: 'instant'`.
- **Client-side category filter:** the same `visibleSet` produced by `FilterDropdown` (URL `?show=` + localStorage fallback) is applied per-column via the existing `applyGridFilter` (extracted from `FolderBrowser` into a small reusable helper, e.g., `src/lib/browse-filter.ts::filterEntriesByCategory(entries, sidecarSet, descriptionName, visibleSet)`). The RSC does **not** consult `?show=` — that contract continues to live client-side, matching the grid view.
- `?showAll=1` plumbing: applied identically to grid view — sidecar set comes from the deepest column's RSC computation. Intermediate columns do not surface description/sidecar UI; sidecars there are simply hidden.
- Includes `<ViewToggle current="column" />` next to the filter dropdown.

### Client component: `FolderBrowser` (existing) — gets `<ViewToggle current="grid" />` added next to its `FilterDropdown`.

### Client component: `ViewToggle` (new, shared)

Two-button segmented control: `Grid` / `Column`. Hidden via Tailwind `hidden md:inline-flex`. On click:

- Toggling **on** (grid → column): `router.push` with `mergeSearchParams(currentSearchParams, { view: 'column' })`; writes `localStorage['minifold:browse-view'] = 'column'`.
- Toggling **off** (column → grid): same with `view` removed via `stripViewParam`; writes `localStorage['minifold:browse-view'] = 'grid'`.
- Other query params (`show`, `showAll`) are preserved on toggle. Implemented via `URLSearchParams` over `useSearchParams()`.

### Helper module: `src/lib/browse-view.ts` (new)

```ts
export type BrowseView = 'grid' | 'column';
export const VIEW_STORAGE_KEY = 'minifold:browse-view';

// Returns a query-string suffix (no leading '?'). Empty string when no params remain.
// Keys with value `null` are removed; otherwise replaced/added.
export function mergeSearchParams(
  current: URLSearchParams,
  overrides: Record<string, string | null>
): string;

// Convenience: removes only `view`.
export function stripViewParam(current: URLSearchParams): string;

export function readPersistedView(): BrowseView | null;
export function writePersistedView(v: BrowseView): void;
```

Caller pattern for `router.push`:
```ts
const qs = mergeSearchParams(searchParams, { view: 'column' });
router.push(qs ? `${pathname}?${qs}` : pathname);
```

The localStorage key is independent of `minifold:browse-filter`. Two keys, two concerns; no folding.

### View resolution (server-side)

The SearchParams extension block above is the canonical implementation. When neither URL nor any other signal sets the view, default is `grid`. The localStorage value is **client-side only** — it does not influence the first paint. Users who toggled to column-view in a previous session see grid view on first navigation in a new tab and would re-toggle. (Acceptable: column view is an explicit, opt-in tool. Reading the cookie/header would require parsing on every RSC; not worth the complexity.)

---

## 3. URL & Navigation Semantics

| Action | URL change |
|---|---|
| Click directory in column N | `<Link>` to `/[provider]/[...dirPath]?view=column&...preserved` |
| Click file in deepest column | `<Link>` to `/[provider]/[...filePath]?view=column&...preserved` (renders columns + strip) |
| Click "Open" inside detail strip | `<Link>` to `/[provider]/[...filePath]` (no `?view=column` — exits to detail page) |
| Toggle Grid → Column | adds `?view=column` to current URL |
| Toggle Column → Grid | removes `?view=column` |
| Click row in non-deepest column | navigates as if it were the deepest, replacing all rightward columns |

The active row in column `N` is derived from the URL: it is the child whose name equals `segments[N]`. No client state — the URL is the source of truth.

---

## 4. UI Layout

### Column

- Fixed width: **240 px**.
- Vertical scroll within the column when its rows overflow.
- Header (compact, 32 px tall): the column's directory name (or provider name for the root column). Optional path tooltip on hover.
- Rows: full-width, 32 px tall.
  - Left: 16×16 file-type icon (folder, STL, 3MF, MD, PDF, IMAGE, FILE) — same icon set as `EntryCard`'s `Icon` component.
  - Middle: name (truncate with ellipsis).
  - Right (directories only): chevron `›`.
- Selected row: accent-color background + accent-color foreground.
- Hover: neutral-100 / neutral-900 background.

### Strip (column container)

- `display: flex; flex-direction: row; gap: 0; overflow-x: auto; scroll-snap-type: x proximity;`
- Each column has `scroll-snap-align: start;` and a 1 px right border (`border-r border-neutral-200 dark:border-neutral-800`).
- Container height: `h-[70dvh]` (dynamic viewport height — handles iOS Safari address-bar chrome correctly). One value, no media-query branching. Each column scrolls independently within this fixed height.

### Detail strip (file selected)

Pinned beneath the column strip when the URL targets a file:

- Height: 96 px.
- Background: `bg-white dark:bg-neutral-950`, top border.
- Content (left → right):
  - 48×48 file-type icon (no thumbnail in v1).
  - Name (line-clamp 1, larger font), and a small line below: `TYPE • SIZE • MODIFIED`.
  - Right-aligned `Open` button → navigates to file detail page (drops `?view=column`).
- No sidecar markdown body, no tags, no download. Those live on the detail page.

### View toggle

Two-button segmented control (`Grid` | `Column`), 28 px tall, accent-color for the active button. Placed in the same flex row as `FilterDropdown` (currently `flex justify-end` — change to `flex items-center justify-end gap-2`).

### Mobile (<768 px)

- The toggle is hidden via `hidden md:inline-flex`.
- A `?view=column` URL opened on <768 px must NOT show a horizontally-scrolling column UI (broken on small screens) and must NOT cause a layout-flash.

**Strategy: server renders both, CSS picks one, no JS redirect.**

The RSC always computes the column data when `?view=column` is set. The page emits two siblings:

1. `<ColumnBrowser>` wrapped in `hidden md:flex` — rendered into the DOM, only displayed at ≥768 px.
2. `<MobileColumnFallback>` wrapped in `md:hidden` — a small notice block: "Column view is desktop-only. **[Open in grid view]**" where the link is a plain `<Link>` with `?view=column` stripped (preserving other params).

This preserves the deep-link-share experience (no flash, no JS), works without JavaScript, and a mobile user gets a single explicit action to view the file. The cost — one wasted set of `listWithCache` calls when a mobile user opens a `?view=column` link — is negligible because (a) mobile users rarely open desktop-shared links, and (b) `listWithCache` is cheap after the first call.

The `localStorage` value is never *read* on mobile — it only kicks in on desktop where the toggle is reachable.

---

## 5. Reused Server-Side Pipeline

All listings reuse the same path the grid view already takes:

```
provider.list(path)            → via listWithCache
  ↓
access resolver per-child      → resolver.resolve(childPath, type)
  ↓
hidden-entry filter            → isHiddenEntry(name)
  ↓
sortEntries                    → folders first, alpha within
```

`computeDirHash` runs per column on the unfiltered listing (matching the grid behavior — hash describes the storage state, not the post-filter view). The hash is fed to `setCachedDir` for IDB seeding.

`upsertDirCache` (the SQLite write-only mirror) is **not** called from the page render path — it is called only via tRPC `browse.list`. The column view does not write to `dir_cache` because the page render uses `listWithCache` directly. This matches existing grid behavior.

---

## 6. Persistence

**View preference key:** `minifold:browse-view` (matches the existing `minifold:browse-filter` convention).

**Resolution order on toggle click:**
1. Update URL (`?view=column` added or removed) — authoritative.
2. Write `localStorage['minifold:browse-view']`.

**Resolution order on first render:**
1. URL `?view=column` → column view (server-side).
2. Otherwise → grid view (server-side; localStorage is not consulted on the server).

**Why no server-side read of localStorage / cookie:** the spec explicitly calls column view "not the default." Reading a cookie on every RSC and conditionally rendering columns inflates RSC complexity for a feature that's expected to be used by a minority of sessions. URL-only persistence is shareable and simple; localStorage just avoids the user toggling twice per tab.

---

## 7. Accessibility

- Column strip is a `<div role="group" aria-label="Folder columns">`. Each column is a `<nav aria-label="<dirname>">` containing a `<ul>` of `<li><a>` rows. Real anchors give keyboard tab navigation for free without WAI-ARIA tree complexity.
- The active row in each column gets `aria-current="true"`.
- Toggle is a real `<button>` pair; `aria-pressed="true"` on the active mode.
- Detail strip uses `aria-live="polite"` so screen readers announce when a file is selected.
- Mobile fallback notice uses `role="status"` (it's an informational message, not a critical alert).

---

## 8. Testing

Unit tests (Vitest):

- `columnAncestorChain(segments, leafType)` returns the correct list of directory paths for: file leaf, directory leaf, root, single-segment path.
- `mergeSearchParams({ view: 'column' }, existing)` preserves `show` and `showAll`, replaces `view`.
- `stripViewParam(url)` removes only the `view` key.
- `ColumnBrowser` renders one column per ancestor + selection highlights derived from URL.
- `ViewToggle` writes localStorage and updates URL on click.
- Mobile fallback: when `?view=column` is set in the RSC, the rendered HTML contains both `<ColumnBrowser>` (with `hidden md:flex` wrapper) and `<MobileColumnFallback>` (with `md:hidden` wrapper). Snapshot test verifies both are present and properly wrapped.

Integration tests:

- RSC: `/[provider]/[[...path]]` with `?view=column` returns markup with N columns matching the path depth.
- RSC: `?view=column` on a denied path → login redirect (anon) or 404 (authed). Same as grid.
- RSC: `?view=column` on a file URL → renders columns + detail strip with file metadata.

E2E (if Playwright present in repo): toggle round-trip, deep-link share, mobile fallback. Defer if not yet wired.

---

## 9. Out of Scope (deferred to follow-up phases)

- Keyboard arrow-key navigation between rows and columns.
- Live hash-revalidation of columns (would refresh stale columns on mid-session changes).
- Folder description above the deepest column.
- Thumbnails in column rows.
- Active column header showing breadcrumbs / path.
- Drag-and-drop, multi-select, right-click context menus.

---

## 10. Risks & Open Issues

- **Deep paths with many ancestors** (e.g., 10+ levels) trigger 10+ parallel `provider.list` calls. `listWithCache` mitigates after the first load, but the cold render is heavier than grid. Acceptable for v1; revisit with a depth cap if it becomes a problem.
- **`scroll-snap-type` on horizontal containers** has subtle quirks across browsers (Safari especially). Test on real iPad/desktop Safari before declaring done.
- **Access resolver concurrency:** the resolver is per-request and its internal `cache: Map<string, ParsedAccess | null>` is written-once-per-key. Concurrent `resolve()` calls on a cache miss may both call `readAccessFile` and both write the same value — benign (idempotent). No promise-deduping needed for v1; add an inline code comment in `ColumnBrowser`'s page integration explaining this is intentionally permitted.
- **First paint with `?view=column` from a fresh session** still defaults to grid — see §6 for why. If users complain, reconsider via cookie.
- **Back button after Open-in-detail:** clicking `Open` in the detail strip drops `?view=column` and lands on the grid-style detail page. Browser back button restores the column-view URL; Next.js handles this natively (history-stack-based). No special handling required.

---

## 11. Spec Cross-Reference

This spec elaborates on Minifold design spec §10 ("UI & Views" → "Column / Finder View") in `docs/superpowers/specs/2026-04-23-minifold-design.md`. No changes to the parent spec are required.
