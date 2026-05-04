# Column View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a macOS Finder-style column view to `/[provider]/[[...path]]`, opt-in via `?view=column`, tablet/desktop only, with a CSS-only mobile fallback.

**Architecture:** Same Next.js route, query-param branch. RSC fetches the ancestor chain in parallel and renders a new `<ColumnBrowser>` client component alongside a `<MobileColumnFallback>` for <md viewports. Reuses `listWithCache`, the access resolver, hidden-entry filtering, sort, and IDB seeding from the grid view. View toggle is a new shared `<ViewToggle>` placed next to the existing `<FilterDropdown>`.

**Tech Stack:** Next.js 16 (App Router, RSC), TypeScript, Tailwind v4, Vitest + React Testing Library + happy-dom, fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-05-05-column-view-design.md`

---

## File Structure

**New files:**
- `src/lib/browse-view.ts` — `BrowseView` type, `mergeSearchParams`, `stripViewParam`, `readPersistedView`, `writePersistedView`.
- `src/server/browse/ancestor-chain.ts` — pure helper computing the column list for an URL.
- `src/components/browse/ViewToggle.tsx` — Grid/Column segmented control.
- `src/components/browse/Column.tsx` — single-column UI (header + rows).
- `src/components/browse/ColumnDetailStrip.tsx` — pinned strip beneath columns when a file is selected.
- `src/components/browse/MobileColumnFallback.tsx` — small notice + link back to grid for <md.
- `src/components/browse/ColumnBrowser.tsx` — orchestrator client component (mirrors `FolderBrowser`).
- `tests/lib/browse-view.test.ts`
- `tests/server/browse/ancestor-chain.test.ts`
- `tests/components/browse/ViewToggle.test.tsx`
- `tests/components/browse/Column.test.tsx`
- `tests/components/browse/ColumnDetailStrip.test.tsx`
- `tests/components/browse/MobileColumnFallback.test.tsx`
- `tests/components/browse/ColumnBrowser.test.tsx`

**Modified files:**
- `src/lib/browse-filter.ts` — add exported `filterEntriesByCategory` helper.
- `src/components/browse/FolderBrowser.tsx` — use `filterEntriesByCategory`; render `<ViewToggle current="grid" />` next to filter dropdown.
- `src/app/[provider]/[[...path]]/page.tsx` — branch on `?view=column`, fetch ancestor chain, render `<ColumnBrowser>` + `<MobileColumnFallback>`.
- `tests/components/browse/FolderBrowser.test.tsx` — update to assert `ViewToggle` presence (mock `useRouter`/`usePathname`).
- `tests/lib/browse-filter.test.ts` — tests for new exported helper.

---

## Task 1: `browse-view.ts` helpers

**Files:**
- Create: `src/lib/browse-view.ts`
- Test: `tests/lib/browse-view.test.ts`

- [ ] **Step 1: Write failing tests**

Write `tests/lib/browse-view.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  VIEW_STORAGE_KEY,
  mergeSearchParams,
  stripViewParam,
  readPersistedView,
  writePersistedView,
} from "@/lib/browse-view";

beforeEach(() => {
  localStorage.clear();
});

describe("mergeSearchParams", () => {
  it("adds a new param when not present", () => {
    const sp = new URLSearchParams("show=3d");
    expect(mergeSearchParams(sp, { view: "column" })).toBe("show=3d&view=column");
  });

  it("replaces an existing param", () => {
    const sp = new URLSearchParams("view=grid&show=3d");
    expect(mergeSearchParams(sp, { view: "column" })).toBe("view=column&show=3d");
  });

  it("removes a param when value is null", () => {
    const sp = new URLSearchParams("view=column&show=3d");
    expect(mergeSearchParams(sp, { view: null })).toBe("show=3d");
  });

  it("returns empty string when all params removed", () => {
    const sp = new URLSearchParams("view=column");
    expect(mergeSearchParams(sp, { view: null })).toBe("");
  });

  it("does not mutate the input URLSearchParams", () => {
    const sp = new URLSearchParams("view=grid");
    mergeSearchParams(sp, { view: "column" });
    expect(sp.get("view")).toBe("grid");
  });
});

describe("stripViewParam", () => {
  it("removes only the view param", () => {
    const sp = new URLSearchParams("view=column&show=3d&showAll=1");
    expect(stripViewParam(sp)).toBe("show=3d&showAll=1");
  });

  it("returns empty when only view was present", () => {
    expect(stripViewParam(new URLSearchParams("view=column"))).toBe("");
  });

  it("returns empty for already-empty params", () => {
    expect(stripViewParam(new URLSearchParams())).toBe("");
  });
});

describe("readPersistedView / writePersistedView", () => {
  it("returns null when nothing stored", () => {
    expect(readPersistedView()).toBeNull();
  });

  it("round-trips 'grid'", () => {
    writePersistedView("grid");
    expect(readPersistedView()).toBe("grid");
  });

  it("round-trips 'column'", () => {
    writePersistedView("column");
    expect(readPersistedView()).toBe("column");
  });

  it("returns null for malformed JSON", () => {
    localStorage.setItem(VIEW_STORAGE_KEY, "not-json{{{");
    expect(readPersistedView()).toBeNull();
  });

  it("returns null for unknown view value", () => {
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ view: "kanban" }));
    expect(readPersistedView()).toBeNull();
  });

  it("uses key minifold:browse-view", () => {
    expect(VIEW_STORAGE_KEY).toBe("minifold:browse-view");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/lib/browse-view.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/browse-view.ts`:

```ts
export type BrowseView = "grid" | "column";

export const VIEW_STORAGE_KEY = "minifold:browse-view";

export function mergeSearchParams(
  current: URLSearchParams,
  overrides: Record<string, string | null>,
): string {
  const next = new URLSearchParams(current);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) next.delete(k);
    else next.set(k, v);
  }
  return next.toString();
}

export function stripViewParam(current: URLSearchParams): string {
  return mergeSearchParams(current, { view: null });
}

export function readPersistedView(): BrowseView | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(VIEW_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "view" in parsed &&
      ((parsed as { view: unknown }).view === "grid" ||
        (parsed as { view: unknown }).view === "column")
    ) {
      return (parsed as { view: BrowseView }).view;
    }
  } catch {
    // fallthrough
  }
  return null;
}

export function writePersistedView(v: BrowseView): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ view: v }));
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run tests/lib/browse-view.test.ts`
Expected: PASS — all 14 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/browse-view.ts tests/lib/browse-view.test.ts
git commit -m "feat(browse): browse-view helpers for column view toggle

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Extract `filterEntriesByCategory` from FolderBrowser

**Files:**
- Modify: `src/lib/browse-filter.ts`
- Modify: `src/components/browse/FolderBrowser.tsx`
- Modify: `tests/lib/browse-filter.test.ts`

- [ ] **Step 1: Write failing tests for the new helper**

In `tests/lib/browse-filter.test.ts`, **extend the existing top-of-file import block** (around lines 2–10) — add `filterEntriesByCategory` to the import list from `@/lib/browse-filter`, and add a new top-level import for `Entry`. The final imports section should look like:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  CATEGORIES,
  DEFAULT_VISIBLE,
  STORAGE_KEY,
  categoryOfKind,
  filterEntriesByCategory,
  parseShowParam,
  readPersistedVisible,
  writePersistedVisible,
} from "@/lib/browse-filter";
import type { FileKind } from "@/server/browse/file-kind";
import type { Entry } from "@/server/storage/types";
```

Then **append the new tests at the end of the file** (after the existing final `describe` block):

```ts
const f = (name: string): Entry => ({ name, type: "file", size: 0, modifiedAt: new Date(0) });
const d = (name: string): Entry => ({ name, type: "directory", size: 0, modifiedAt: new Date(0) });

describe("filterEntriesByCategory", () => {
  it("keeps directories regardless of visible categories", () => {
    const out = filterEntriesByCategory([d("sub"), f("misc.bin")], new Set([]));
    expect(out.map((e) => e.name)).toEqual(["sub"]);
  });

  it("filters files by category", () => {
    const out = filterEntriesByCategory(
      [f("a.stl"), f("readme.md"), f("photo.png"), f("misc.bin")],
      new Set(["3d", "image"]),
    );
    expect(out.map((e) => e.name).sort()).toEqual(["a.stl", "photo.png"].sort());
  });

  it("returns empty when no categories visible and no directories", () => {
    const out = filterEntriesByCategory([f("a.stl"), f("readme.md")], new Set([]));
    expect(out).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [f("a.stl"), f("readme.md")];
    filterEntriesByCategory(input, new Set([]));
    expect(input).toHaveLength(2);
  });

  it("preserves input order (does not re-sort)", () => {
    const input = [f("z.stl"), f("a.stl")];
    const out = filterEntriesByCategory(input, new Set(["3d"]));
    expect(out.map((e) => e.name)).toEqual(["z.stl", "a.stl"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/lib/browse-filter.test.ts`
Expected: FAIL — `filterEntriesByCategory` not exported.

- [ ] **Step 3: Add the helper to `src/lib/browse-filter.ts`**

In `src/lib/browse-filter.ts`:

(a) **Add two new imports at the top of the file**, alongside the existing `import type { FileKind } from "@/server/browse/file-kind"` line. The final top-of-file imports should be:

```ts
import type { FileKind } from "@/server/browse/file-kind";
import { fileKindOf } from "@/server/browse/file-kind";
import type { Entry } from "@/server/storage/types";
```

(`Category` and `categoryOfKind` are already in scope as they're defined in this file.)

(b) **Append the new function at the end of the file**:

```ts
export function filterEntriesByCategory(
  entries: readonly Entry[],
  visibleCategories: ReadonlySet<Category>,
): Entry[] {
  return entries.filter((e) => {
    if (e.type === "file") {
      const cat = categoryOfKind(fileKindOf(e.name));
      if (!visibleCategories.has(cat)) return false;
    }
    return true;
  });
}
```

- [ ] **Step 4: Refactor `FolderBrowser` to use the new helper (no behaviour change)**

In `src/components/browse/FolderBrowser.tsx`, change `applyGridFilter` to delegate the category-filter step to the new helper. Replace the existing `applyGridFilter` body with:

```ts
function applyGridFilter(
  entries: readonly Entry[],
  descriptionName: string | null,
  sidecarSet: ReadonlySet<string>,
  visibleCategories: ReadonlySet<Category>,
): Entry[] {
  const afterMeta = entries.filter((e) => {
    if (descriptionName && e.name === descriptionName) return false;
    if (sidecarSet.has(e.name)) return false;
    return true;
  });
  return sortEntries(filterEntriesByCategory(afterMeta, visibleCategories));
}
```

Update the import line to add `filterEntriesByCategory`:

```ts
import {
  type Category,
  DEFAULT_VISIBLE,
  categoryOfKind,
  filterEntriesByCategory,
  parseShowParam,
  readPersistedVisible,
  writePersistedVisible,
} from "@/lib/browse-filter";
```

The `categoryOfKind` import may now be unused — remove it if so (but check: it's still used in the closure if you didn't fully refactor). After this change the only direct uses of `categoryOfKind` inside `FolderBrowser.tsx` should be gone; remove from the import list to avoid lint errors.

- [ ] **Step 5: Run all browse tests**

Run: `pnpm vitest run tests/lib/browse-filter.test.ts tests/components/browse/FolderBrowser.test.tsx`
Expected: PASS — all existing tests still pass plus 5 new ones.

- [ ] **Step 6: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors. Fix any unused-import warnings introduced by the refactor.

- [ ] **Step 7: Commit**

```bash
git add src/lib/browse-filter.ts src/components/browse/FolderBrowser.tsx tests/lib/browse-filter.test.ts
git commit -m "refactor(browse): extract filterEntriesByCategory for reuse

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: `ancestor-chain.ts` server helper

**Files:**
- Create: `src/server/browse/ancestor-chain.ts`
- Test: `tests/server/browse/ancestor-chain.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/server/browse/ancestor-chain.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { columnAncestorChain } from "@/server/browse/ancestor-chain";

describe("columnAncestorChain", () => {
  it("returns one root column for empty segments", () => {
    expect(columnAncestorChain([], "directory")).toEqual([""]);
  });

  it("returns root + dir for single-segment directory leaf", () => {
    expect(columnAncestorChain(["foo"], "directory")).toEqual(["", "foo"]);
  });

  it("returns each ancestor for a deep directory leaf", () => {
    expect(columnAncestorChain(["foo", "bar", "baz"], "directory")).toEqual([
      "",
      "foo",
      "foo/bar",
      "foo/bar/baz",
    ]);
  });

  it("uses parent dir as deepest column for a file leaf", () => {
    expect(columnAncestorChain(["foo", "bar.stl"], "file")).toEqual(["", "foo"]);
  });

  it("returns only root column for a file at provider root", () => {
    expect(columnAncestorChain(["baz.stl"], "file")).toEqual([""]);
  });

  it("returns each ancestor up to the file's parent", () => {
    expect(columnAncestorChain(["a", "b", "c", "x.pdf"], "file")).toEqual([
      "",
      "a",
      "a/b",
      "a/b/c",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/server/browse/ancestor-chain.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/server/browse/ancestor-chain.ts`:

```ts
export type LeafKind = "file" | "directory";

/**
 * Returns the list of directory paths to render as columns in column view.
 * Each entry is a path relative to the provider root; "" is the provider root.
 *
 * Rules:
 *   - directory leaf: chain is [root, segments[0], segments[0..1], ..., full path]
 *   - file leaf: chain is the same as for the file's parent directory
 */
export function columnAncestorChain(
  segments: readonly string[],
  leafKind: LeafKind,
): string[] {
  const dirSegments = leafKind === "file" ? segments.slice(0, -1) : segments;
  const out: string[] = [""];
  let acc = "";
  for (const seg of dirSegments) {
    acc = acc === "" ? seg : `${acc}/${seg}`;
    out.push(acc);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run tests/server/browse/ancestor-chain.test.ts`
Expected: PASS — 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/server/browse/ancestor-chain.ts tests/server/browse/ancestor-chain.test.ts
git commit -m "feat(browse): columnAncestorChain helper for column view

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: `<ViewToggle>` component

**Files:**
- Create: `src/components/browse/ViewToggle.tsx`
- Test: `tests/components/browse/ViewToggle.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `tests/components/browse/ViewToggle.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ViewToggle } from "@/components/browse/ViewToggle";
import { VIEW_STORAGE_KEY } from "@/lib/browse-view";

const pushMock = vi.fn();
let searchParamsValue = new URLSearchParams();
let pathnameValue = "/nas/foo";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  useSearchParams: () => searchParamsValue,
  usePathname: () => pathnameValue,
}));

beforeEach(() => {
  pushMock.mockClear();
  searchParamsValue = new URLSearchParams();
  pathnameValue = "/nas/foo";
  localStorage.clear();
});

describe("ViewToggle", () => {
  it("renders both Grid and Column buttons", () => {
    render(<ViewToggle current="grid" />);
    expect(screen.getByRole("button", { name: /grid/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /column/i })).toBeInTheDocument();
  });

  it("marks the active button with aria-pressed", () => {
    render(<ViewToggle current="grid" />);
    expect(screen.getByRole("button", { name: /grid/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /column/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("on Grid → Column click, pushes URL with ?view=column and writes localStorage", async () => {
    const user = userEvent.setup();
    render(<ViewToggle current="grid" />);
    await user.click(screen.getByRole("button", { name: /column/i }));
    expect(pushMock).toHaveBeenCalledWith("/nas/foo?view=column");
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe(
      JSON.stringify({ view: "column" }),
    );
  });

  it("on Column → Grid click, pushes URL with ?view= removed and writes localStorage", async () => {
    const user = userEvent.setup();
    searchParamsValue = new URLSearchParams("view=column&show=3d");
    render(<ViewToggle current="column" />);
    await user.click(screen.getByRole("button", { name: /grid/i }));
    expect(pushMock).toHaveBeenCalledWith("/nas/foo?show=3d");
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe(
      JSON.stringify({ view: "grid" }),
    );
  });

  it("preserves other query params on toggle", async () => {
    const user = userEvent.setup();
    searchParamsValue = new URLSearchParams("show=3d&showAll=1");
    render(<ViewToggle current="grid" />);
    await user.click(screen.getByRole("button", { name: /column/i }));
    expect(pushMock).toHaveBeenCalledWith(
      "/nas/foo?show=3d&showAll=1&view=column",
    );
  });

  it("clicking the already-active button is a no-op", async () => {
    const user = userEvent.setup();
    render(<ViewToggle current="grid" />);
    await user.click(screen.getByRole("button", { name: /grid/i }));
    expect(pushMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBeNull();
  });

  it("does not render anything when forceMobileHidden is true on small viewports (CSS-only check)", () => {
    render(<ViewToggle current="grid" />);
    const wrapper = screen.getByRole("button", { name: /grid/i }).parentElement!;
    expect(wrapper.className).toContain("hidden");
    expect(wrapper.className).toContain("md:inline-flex");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/components/browse/ViewToggle.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `ViewToggle`**

Create `src/components/browse/ViewToggle.tsx`:

```tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type BrowseView,
  mergeSearchParams,
  writePersistedView,
} from "@/lib/browse-view";

type Props = {
  current: BrowseView;
};

export function ViewToggle({ current }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(next: BrowseView) {
    if (next === current) return;
    const qs = mergeSearchParams(searchParams, {
      view: next === "column" ? "column" : null,
    });
    router.push(qs ? `${pathname}?${qs}` : pathname);
    writePersistedView(next);
  }

  const baseBtn =
    "px-3 py-1 text-sm font-medium transition-colors first:rounded-l last:rounded-r border border-neutral-200 dark:border-neutral-800";
  const activeBtn = "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900";
  const inactiveBtn =
    "bg-white text-neutral-700 hover:bg-neutral-50 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900";

  return (
    <div className="hidden md:inline-flex" role="group" aria-label="View mode">
      <button
        type="button"
        aria-pressed={current === "grid"}
        onClick={() => go("grid")}
        className={`${baseBtn} ${current === "grid" ? activeBtn : inactiveBtn}`}
      >
        Grid
      </button>
      <button
        type="button"
        aria-pressed={current === "column"}
        onClick={() => go("column")}
        className={`${baseBtn} ${current === "column" ? activeBtn : inactiveBtn} -ml-px`}
      >
        Column
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run tests/components/browse/ViewToggle.test.tsx`
Expected: PASS — 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/ViewToggle.tsx tests/components/browse/ViewToggle.test.tsx
git commit -m "feat(browse): ViewToggle component (Grid/Column segmented control)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Wire `<ViewToggle>` into existing `<FolderBrowser>`

**Files:**
- Modify: `src/components/browse/FolderBrowser.tsx`
- Modify: `tests/components/browse/FolderBrowser.test.tsx`

- [ ] **Step 1: Update existing tests to mock useRouter and usePathname (no behaviour change yet)**

Edit `tests/components/browse/FolderBrowser.test.tsx`. Replace the existing `vi.mock("next/navigation", ...)` block with:

```ts
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/nas",
}));
```

Run: `pnpm vitest run tests/components/browse/FolderBrowser.test.tsx`
Expected: PASS — existing tests still pass with the broader mock.

- [ ] **Step 2: Add a failing test asserting `ViewToggle` is rendered**

Append to the `describe("FolderBrowser", () => { ... })` block:

```ts
it("renders the ViewToggle with current='grid'", () => {
  renderBrowser([file("a.stl")]);
  const grid = screen.getByRole("button", { name: /grid/i });
  expect(grid).toHaveAttribute("aria-pressed", "true");
  const column = screen.getByRole("button", { name: /column/i });
  expect(column).toHaveAttribute("aria-pressed", "false");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/components/browse/FolderBrowser.test.tsx -t ViewToggle`
Expected: FAIL — no Grid/Column buttons in FolderBrowser yet.

- [ ] **Step 4: Add `<ViewToggle current="grid" />` to FolderBrowser**

Edit `src/components/browse/FolderBrowser.tsx`. Update the import block:

```tsx
import { FolderGrid } from "./FolderGrid";
import { FilterDropdown } from "./FilterDropdown";
import { ViewToggle } from "./ViewToggle";
```

Then change the toolbar row from:

```tsx
<div className="flex justify-end">
  <FilterDropdown visible={visibleSet} onChange={handleFilterChange} />
</div>
```

to:

```tsx
<div className="flex items-center justify-end gap-2">
  <ViewToggle current="grid" />
  <FilterDropdown visible={visibleSet} onChange={handleFilterChange} />
</div>
```

- [ ] **Step 5: Run all FolderBrowser tests**

Run: `pnpm vitest run tests/components/browse/FolderBrowser.test.tsx`
Expected: PASS — all existing tests + the new one.

- [ ] **Step 6: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/browse/FolderBrowser.tsx tests/components/browse/FolderBrowser.test.tsx
git commit -m "feat(browse): render ViewToggle in FolderBrowser toolbar

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: `<Column>` component

**Files:**
- Create: `src/components/browse/Column.tsx`
- Test: `tests/components/browse/Column.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `tests/components/browse/Column.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Entry } from "@/server/storage/types";
import { Column } from "@/components/browse/Column";

const f = (name: string): Entry => ({
  name,
  type: "file",
  size: 0,
  modifiedAt: new Date(0),
});
const d = (name: string): Entry => ({
  name,
  type: "directory",
  size: 0,
  modifiedAt: new Date(0),
});

describe("Column", () => {
  it("renders the column header with the directory name", () => {
    render(
      <Column
        providerSlug="nas"
        path="foo/bar"
        headerLabel="bar"
        entries={[]}
        activeName={null}
        searchSuffix=""
      />,
    );
    expect(screen.getByText("bar")).toBeInTheDocument();
  });

  it("uses provider name as header label for the root column", () => {
    render(
      <Column
        providerSlug="nas"
        path=""
        headerLabel="NAS"
        entries={[]}
        activeName={null}
        searchSuffix=""
      />,
    );
    expect(screen.getByText("NAS")).toBeInTheDocument();
  });

  it("renders one row per entry as anchor links", () => {
    render(
      <Column
        providerSlug="nas"
        path=""
        headerLabel="NAS"
        entries={[d("foo"), f("a.stl")]}
        activeName={null}
        searchSuffix=""
      />,
    );
    expect(
      screen.getByRole("link", { name: /foo/ }).getAttribute("href"),
    ).toBe("/nas/foo?view=column");
    expect(
      screen.getByRole("link", { name: /a\.stl/ }).getAttribute("href"),
    ).toBe("/nas/a.stl?view=column");
  });

  it("appends searchSuffix (other params) to each link", () => {
    render(
      <Column
        providerSlug="nas"
        path=""
        headerLabel="NAS"
        entries={[d("foo")]}
        activeName={null}
        searchSuffix="show=3d"
      />,
    );
    expect(
      screen.getByRole("link", { name: /foo/ }).getAttribute("href"),
    ).toBe("/nas/foo?show=3d&view=column");
  });

  it("marks the active row with aria-current='true'", () => {
    render(
      <Column
        providerSlug="nas"
        path=""
        headerLabel="NAS"
        entries={[d("foo"), d("bar")]}
        activeName="foo"
        searchSuffix=""
      />,
    );
    expect(screen.getByRole("link", { name: /foo/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("link", { name: /bar/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("renders 'Empty folder' when entries is empty", () => {
    render(
      <Column
        providerSlug="nas"
        path="foo"
        headerLabel="foo"
        entries={[]}
        activeName={null}
        searchSuffix=""
      />,
    );
    expect(screen.getByText(/empty folder/i)).toBeInTheDocument();
  });

  it("renders directories with a chevron", () => {
    render(
      <Column
        providerSlug="nas"
        path=""
        headerLabel="NAS"
        entries={[d("foo")]}
        activeName={null}
        searchSuffix=""
      />,
    );
    expect(screen.getByText("›")).toBeInTheDocument();
  });

  it("does not render a chevron for files", () => {
    render(
      <Column
        providerSlug="nas"
        path=""
        headerLabel="NAS"
        entries={[f("a.stl")]}
        activeName={null}
        searchSuffix=""
      />,
    );
    expect(screen.queryByText("›")).not.toBeInTheDocument();
  });

  it("URL-encodes path segments containing reserved characters", () => {
    render(
      <Column
        providerSlug="nas"
        path="prints"
        headerLabel="prints"
        entries={[f("draft #2.md")]}
        activeName={null}
        searchSuffix=""
      />,
    );
    const link = screen.getByRole("link", { name: /draft #2\.md/ });
    expect(link.getAttribute("href")).toBe(
      "/nas/prints/draft%20%232.md?view=column",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/components/browse/Column.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `Column`**

Create `src/components/browse/Column.tsx`:

```tsx
import Link from "next/link";
import type { Entry } from "@/server/storage/types";
import { fileKindOf } from "@/server/browse/file-kind";
import { encodePathSegments } from "@/server/browse/encode-path";

type Props = {
  providerSlug: string;
  path: string;
  headerLabel: string;
  entries: readonly Entry[];
  activeName: string | null;
  /** Other query params (no leading '?', no view key) — appended to each link's URL. */
  searchSuffix: string;
};

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function buildHref(
  providerSlug: string,
  path: string,
  name: string,
  searchSuffix: string,
): string {
  const target = joinPath(path, name);
  const encoded = encodePathSegments(target);
  const qs = searchSuffix ? `${searchSuffix}&view=column` : "view=column";
  return `/${providerSlug}/${encoded}?${qs}`;
}

function FileTypeIcon({ entry }: { entry: Entry }) {
  if (entry.type === "directory") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 shrink-0 fill-neutral-400 dark:fill-neutral-600"
        aria-hidden="true"
      >
        <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />
      </svg>
    );
  }
  const kind = fileKindOf(entry.name);
  const label = kind === "other" ? "FILE" : kind.toUpperCase();
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-neutral-300 bg-neutral-100 text-[8px] font-medium uppercase text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
      {label.slice(0, 3)}
    </span>
  );
}

export function Column({
  providerSlug,
  path,
  headerLabel,
  entries,
  activeName,
  searchSuffix,
}: Props) {
  return (
    <nav
      aria-label={headerLabel}
      className="flex h-full w-60 shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800"
      style={{ scrollSnapAlign: "start" }}
    >
      <div className="h-8 truncate border-b border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-medium uppercase tracking-wide text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
        {headerLabel}
      </div>
      {entries.length === 0 ? (
        <div className="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400">
          Empty folder
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {entries.map((e) => {
            const isActive = e.name === activeName;
            return (
              <li key={e.name}>
                <Link
                  href={buildHref(providerSlug, path, e.name, searchSuffix)}
                  aria-current={isActive ? "true" : undefined}
                  className={`flex h-8 items-center gap-2 px-3 text-sm ${
                    isActive
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
                  }`}
                >
                  <FileTypeIcon entry={e} />
                  <span className="flex-1 truncate">{e.name}</span>
                  {e.type === "directory" && (
                    <span aria-hidden="true" className="text-neutral-400">
                      ›
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run tests/components/browse/Column.test.tsx`
Expected: PASS — 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/Column.tsx tests/components/browse/Column.test.tsx
git commit -m "feat(browse): Column component for column view

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: `<ColumnDetailStrip>` component

**Files:**
- Create: `src/components/browse/ColumnDetailStrip.tsx`
- Test: `tests/components/browse/ColumnDetailStrip.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `tests/components/browse/ColumnDetailStrip.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Entry } from "@/server/storage/types";
import { ColumnDetailStrip } from "@/components/browse/ColumnDetailStrip";

const sampleFile: Entry = {
  name: "anchor.stl",
  type: "file",
  size: 1234567,
  modifiedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("ColumnDetailStrip", () => {
  it("renders file name, type, size, and modified date", () => {
    render(
      <ColumnDetailStrip
        providerSlug="nas"
        parentPath="prints"
        entry={sampleFile}
        searchSuffix=""
      />,
    );
    expect(screen.getByText("anchor.stl")).toBeInTheDocument();
    expect(screen.getByText(/STL/)).toBeInTheDocument();
    expect(screen.getByText(/1\.2 MB/)).toBeInTheDocument();
    expect(screen.getByText(/2026-01-01/)).toBeInTheDocument();
  });

  it("renders an Open link to the file detail page WITHOUT view=column", () => {
    render(
      <ColumnDetailStrip
        providerSlug="nas"
        parentPath="prints"
        entry={sampleFile}
        searchSuffix=""
      />,
    );
    const link = screen.getByRole("link", { name: /open/i });
    expect(link.getAttribute("href")).toBe("/nas/prints/anchor.stl");
  });

  it("preserves other query params on the Open link (no view)", () => {
    render(
      <ColumnDetailStrip
        providerSlug="nas"
        parentPath="prints"
        entry={sampleFile}
        searchSuffix="show=3d"
      />,
    );
    const link = screen.getByRole("link", { name: /open/i });
    expect(link.getAttribute("href")).toBe("/nas/prints/anchor.stl?show=3d");
  });

  it("URL-encodes filenames", () => {
    const exotic: Entry = { ...sampleFile, name: "draft #2.stl" };
    render(
      <ColumnDetailStrip
        providerSlug="nas"
        parentPath="prints"
        entry={exotic}
        searchSuffix=""
      />,
    );
    const link = screen.getByRole("link", { name: /open/i });
    expect(link.getAttribute("href")).toBe(
      "/nas/prints/draft%20%232.stl",
    );
  });

  it("works for files at provider root (no parentPath)", () => {
    render(
      <ColumnDetailStrip
        providerSlug="nas"
        parentPath=""
        entry={sampleFile}
        searchSuffix=""
      />,
    );
    const link = screen.getByRole("link", { name: /open/i });
    expect(link.getAttribute("href")).toBe("/nas/anchor.stl");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/components/browse/ColumnDetailStrip.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `ColumnDetailStrip`**

Create `src/components/browse/ColumnDetailStrip.tsx`:

```tsx
import Link from "next/link";
import type { Entry } from "@/server/storage/types";
import { fileKindOf } from "@/server/browse/file-kind";
import { encodePathSegments } from "@/server/browse/encode-path";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

type Props = {
  providerSlug: string;
  parentPath: string;
  entry: Entry;
  /** Other query params (no leading '?', no view key) — appended to the Open link. */
  searchSuffix: string;
};

export function ColumnDetailStrip({
  providerSlug,
  parentPath,
  entry,
  searchSuffix,
}: Props) {
  const fullPath = joinPath(parentPath, entry.name);
  const encoded = encodePathSegments(fullPath);
  const href = searchSuffix
    ? `/${providerSlug}/${encoded}?${searchSuffix}`
    : `/${providerSlug}/${encoded}`;

  const kind = fileKindOf(entry.name);
  const kindLabel = kind === "other" ? "FILE" : kind.toUpperCase();
  const modified = entry.modifiedAt.toISOString().slice(0, 10);

  return (
    <aside
      aria-live="polite"
      className="flex h-24 items-center gap-4 border-t border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-950"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-neutral-300 bg-neutral-100 text-xs font-semibold uppercase text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
        {kindLabel.slice(0, 3)}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {entry.name}
        </h2>
        <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
          <span className="font-mono uppercase">{kindLabel}</span>
          <span> · </span>
          <span>{formatBytes(entry.size)}</span>
          <span> · </span>
          <span>{modified}</span>
        </p>
      </div>
      <Link
        href={href}
        className="shrink-0 rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        Open
      </Link>
    </aside>
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run tests/components/browse/ColumnDetailStrip.test.tsx`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/ColumnDetailStrip.tsx tests/components/browse/ColumnDetailStrip.test.tsx
git commit -m "feat(browse): ColumnDetailStrip for selected file in column view

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: `<MobileColumnFallback>` component

**Files:**
- Create: `src/components/browse/MobileColumnFallback.tsx`
- Test: `tests/components/browse/MobileColumnFallback.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `tests/components/browse/MobileColumnFallback.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MobileColumnFallback } from "@/components/browse/MobileColumnFallback";

describe("MobileColumnFallback", () => {
  it("renders an explanatory notice", () => {
    render(<MobileColumnFallback gridHref="/nas/foo" />);
    expect(
      screen.getByText(/column view is desktop-only/i),
    ).toBeInTheDocument();
  });

  it("uses role='status' for the notice", () => {
    render(<MobileColumnFallback gridHref="/nas/foo" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders a link to the grid href", () => {
    render(<MobileColumnFallback gridHref="/nas/foo?show=3d" />);
    const link = screen.getByRole("link", { name: /open in grid view/i });
    expect(link.getAttribute("href")).toBe("/nas/foo?show=3d");
  });

  it("uses md:hidden class so it only appears on small viewports", () => {
    const { container } = render(
      <MobileColumnFallback gridHref="/nas/foo" />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("md:hidden");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/components/browse/MobileColumnFallback.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `MobileColumnFallback`**

Create `src/components/browse/MobileColumnFallback.tsx`:

```tsx
import Link from "next/link";

type Props = {
  /** URL to the grid view (current path with ?view=column stripped). */
  gridHref: string;
};

export function MobileColumnFallback({ gridHref }: Props) {
  return (
    <div
      role="status"
      className="md:hidden flex flex-col items-start gap-2 rounded border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
    >
      <p>Column view is desktop-only. It needs more screen width to be useful.</p>
      <Link
        href={gridHref}
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        Open in grid view
      </Link>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run tests/components/browse/MobileColumnFallback.test.tsx`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/MobileColumnFallback.tsx tests/components/browse/MobileColumnFallback.test.tsx
git commit -m "feat(browse): MobileColumnFallback notice for <md viewports

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: `<ColumnBrowser>` orchestrator

**Files:**
- Create: `src/components/browse/ColumnBrowser.tsx`
- Test: `tests/components/browse/ColumnBrowser.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `tests/components/browse/ColumnBrowser.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import type { Entry } from "@/server/storage/types";
import { getCachedDir, IDB_DB_NAME } from "@/lib/dir-cache-idb";
import { ColumnBrowser } from "@/components/browse/ColumnBrowser";

const f = (name: string): Entry => ({
  name,
  type: "file",
  size: 0,
  modifiedAt: new Date(0),
});
const d = (name: string): Entry => ({
  name,
  type: "directory",
  size: 0,
  modifiedAt: new Date(0),
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/nas",
}));

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(IDB_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  await deleteDb();
  localStorage.clear();
});

describe("ColumnBrowser", () => {
  it("renders one Column per ancestor", () => {
    render(
      <ColumnBrowser
        providerSlug="nas"
        providerName="NAS"
        columns={[
          { path: "", entries: [d("foo")], hash: "h0" },
          { path: "foo", entries: [d("bar")], hash: "h1" },
          { path: "foo/bar", entries: [f("a.stl")], hash: "h2" },
        ]}
        activeNames={["foo", "bar", null]}
        selectedLeaf={null}
        leafParentPath={null}
        thumbnailsEnabled={false}
      />,
    );
    expect(screen.getByText("NAS")).toBeInTheDocument();
    expect(screen.getByText(/^foo$/)).toBeInTheDocument();
    expect(screen.getByText(/^bar$/)).toBeInTheDocument();
    expect(screen.getByText("a.stl")).toBeInTheDocument();
  });

  it("highlights active rows via aria-current", () => {
    render(
      <ColumnBrowser
        providerSlug="nas"
        providerName="NAS"
        columns={[
          { path: "", entries: [d("foo"), d("baz")], hash: "h0" },
          { path: "foo", entries: [d("bar")], hash: "h1" },
        ]}
        activeNames={["foo", null]}
        selectedLeaf={null}
        leafParentPath={null}
        thumbnailsEnabled={false}
      />,
    );
    expect(screen.getByRole("link", { name: /^foo$/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("link", { name: /^baz$/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("renders the detail strip when selectedLeaf is provided", () => {
    render(
      <ColumnBrowser
        providerSlug="nas"
        providerName="NAS"
        columns={[
          { path: "", entries: [f("a.stl")], hash: "h0" },
        ]}
        activeNames={["a.stl"]}
        selectedLeaf={f("a.stl")}
        leafParentPath=""
        thumbnailsEnabled={false}
      />,
    );
    expect(screen.getByRole("link", { name: /open/i })).toBeInTheDocument();
  });

  it("does NOT render the detail strip when selectedLeaf is null", () => {
    render(
      <ColumnBrowser
        providerSlug="nas"
        providerName="NAS"
        columns={[{ path: "", entries: [d("foo")], hash: "h0" }]}
        activeNames={[null]}
        selectedLeaf={null}
        leafParentPath={null}
        thumbnailsEnabled={false}
      />,
    );
    expect(screen.queryByRole("link", { name: /open/i })).not.toBeInTheDocument();
  });

  it("renders the ViewToggle with current='column'", () => {
    render(
      <ColumnBrowser
        providerSlug="nas"
        providerName="NAS"
        columns={[{ path: "", entries: [], hash: "h0" }]}
        activeNames={[null]}
        selectedLeaf={null}
        leafParentPath={null}
        thumbnailsEnabled={false}
      />,
    );
    const column = screen.getByRole("button", { name: /column/i });
    expect(column).toHaveAttribute("aria-pressed", "true");
  });

  it("seeds IDB with each column's listing on mount", async () => {
    render(
      <ColumnBrowser
        providerSlug="nas"
        providerName="NAS"
        columns={[
          { path: "", entries: [d("foo")], hash: "h0" },
          { path: "foo", entries: [f("a.stl")], hash: "h1" },
        ]}
        activeNames={["foo", null]}
        selectedLeaf={null}
        leafParentPath={null}
        thumbnailsEnabled={false}
      />,
    );
    await waitFor(async () => {
      const root = await getCachedDir("nas/");
      expect(root?.hash).toBe("h0");
      expect(root?.entries.map((e) => e.name)).toEqual(["foo"]);
      const sub = await getCachedDir("nas/foo");
      expect(sub?.hash).toBe("h1");
      expect(sub?.entries.map((e) => e.name)).toEqual(["a.stl"]);
    });
  });

  it("applies the category filter per column", async () => {
    render(
      <ColumnBrowser
        providerSlug="nas"
        providerName="NAS"
        columns={[
          {
            path: "",
            entries: [f("part.step"), f("misc.bin"), d("subfolder")],
            hash: "h0",
          },
        ]}
        activeNames={[null]}
        selectedLeaf={null}
        leafParentPath={null}
        thumbnailsEnabled={false}
      />,
    );
    // Default filter shows 3d/doc/image and hides 'other'; directories always visible.
    expect(screen.getByText("part.step")).toBeInTheDocument();
    expect(screen.getByText("subfolder")).toBeInTheDocument();
    expect(screen.queryByText("misc.bin")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/components/browse/ColumnBrowser.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `ColumnBrowser`**

Create `src/components/browse/ColumnBrowser.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Entry } from "@/server/storage/types";
import { setCachedDir } from "@/lib/dir-cache-idb";
import {
  type Category,
  DEFAULT_VISIBLE,
  filterEntriesByCategory,
  parseShowParam,
  readPersistedVisible,
  writePersistedVisible,
} from "@/lib/browse-filter";
import { mergeSearchParams } from "@/lib/browse-view";
import { Column } from "./Column";
import { ColumnDetailStrip } from "./ColumnDetailStrip";
import { FilterDropdown } from "./FilterDropdown";
import { ViewToggle } from "./ViewToggle";

export type ColumnData = {
  path: string;
  entries: readonly Entry[];
  hash: string;
};

type Props = {
  providerSlug: string;
  providerName: string;
  columns: readonly ColumnData[];
  /** Per-column active-row name; null when no row is active in that column. Length matches columns. */
  activeNames: readonly (string | null)[];
  selectedLeaf: Entry | null;
  /** Parent dir of selectedLeaf (i.e. the deepest column's path). null when no leaf. */
  leafParentPath: string | null;
  thumbnailsEnabled: boolean;
};

function resolveInitialVisible(showParam: string | null): Set<Category> {
  const fromUrl = parseShowParam(showParam);
  if (fromUrl) return new Set(fromUrl);
  const fromStorage = readPersistedVisible();
  if (fromStorage) return new Set(fromStorage);
  return new Set(DEFAULT_VISIBLE);
}

export function ColumnBrowser({
  providerSlug,
  providerName,
  columns,
  activeNames,
  selectedLeaf,
  leafParentPath,
  thumbnailsEnabled,
}: Props) {
  void thumbnailsEnabled; // reserved for future thumbnail rows

  const searchParams = useSearchParams();
  const showParam = searchParams.get("show");
  const [visibleSet, setVisibleSet] = useState<Set<Category>>(
    () => resolveInitialVisible(showParam),
  );
  const stripRef = useRef<HTMLDivElement>(null);

  const handleFilterChange = (next: Set<Category>) => {
    setVisibleSet(next);
    writePersistedVisible(Array.from(next));
  };

  // Compute the suffix for child links: preserve other params, drop `view`.
  const linkSuffix = useMemo(
    () => mergeSearchParams(searchParams, { view: null }),
    [searchParams],
  );

  // Seed IDB for each column. Fire-and-forget; per-request resolver cache races
  // are benign (idempotent writes) — see column-view design spec §10.
  useEffect(() => {
    for (const col of columns) {
      const key = `${providerSlug}/${col.path}`;
      void setCachedDir(key, {
        hash: col.hash,
        entries: [...col.entries],
        cachedAt: Date.now(),
      });
    }
  }, [providerSlug, columns]);

  // Scroll the rightmost column into view on mount and when columns change.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollWidth, behavior: "instant" as ScrollBehavior });
  }, [columns.length]);

  return (
    <div className="hidden md:flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        <ViewToggle current="column" />
        <FilterDropdown visible={visibleSet} onChange={handleFilterChange} />
      </div>
      <div
        ref={stripRef}
        className="flex h-[70dvh] overflow-x-auto"
        style={{ scrollSnapType: "x proximity" }}
      >
        {columns.map((col, i) => {
          const filtered = filterEntriesByCategory(col.entries, visibleSet);
          const headerLabel =
            col.path === "" ? providerName : col.path.split("/").pop()!;
          return (
            <Column
              key={col.path || "__root__"}
              providerSlug={providerSlug}
              path={col.path}
              headerLabel={headerLabel}
              entries={filtered}
              activeName={activeNames[i] ?? null}
              searchSuffix={linkSuffix}
            />
          );
        })}
      </div>
      {selectedLeaf && leafParentPath !== null && (
        <ColumnDetailStrip
          providerSlug={providerSlug}
          parentPath={leafParentPath}
          entry={selectedLeaf}
          searchSuffix={linkSuffix}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run tests/components/browse/ColumnBrowser.test.tsx`
Expected: PASS — 7 tests green.

- [ ] **Step 5: Run all browse tests as a regression check**

Run: `pnpm vitest run tests/components/browse tests/lib/browse-filter.test.ts tests/lib/browse-view.test.ts`
Expected: PASS — all green.

- [ ] **Step 6: Commit**

```bash
git add src/components/browse/ColumnBrowser.tsx tests/components/browse/ColumnBrowser.test.tsx
git commit -m "feat(browse): ColumnBrowser orchestrator (columns + filter + IDB seed)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: Wire column view into the page route

**Files:**
- Modify: `src/app/[provider]/[[...path]]/page.tsx`

- [ ] **Step 1: Add column-view branch to `page.tsx`**

This task has no new test file — RSC integration is covered indirectly by the component tests above and by manual verification in Task 11. Update `src/app/[provider]/[[...path]]/page.tsx` end-to-end.

Replace the entire file contents with:

```tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDatabase } from "@/server/db";
import { findProviderBySlug } from "@/server/db/providers";
import { providerFromRow } from "@/server/storage/factory";
import {
  NotFoundError,
  PathTraversalError,
  type Entry,
} from "@/server/storage/types";
import { isHiddenEntry } from "@/server/browse/hidden";
import { sortEntries } from "@/server/browse/sort";
import { computeDirHash } from "@/server/browse/dir-hash";
import { findFolderDescription } from "@/server/browse/description-file";
import { findSidecarMarkdowns } from "@/server/browse/find-sidecars";
import { decodePathSegments, encodePathSegments } from "@/server/browse/encode-path";
import { listWithCache } from "@/server/browse/list-cache";
import { columnAncestorChain } from "@/server/browse/ancestor-chain";
import { isThumbnailServiceEnabled } from "@/server/thumb/config";
import { Breadcrumbs } from "@/components/browse/Breadcrumbs";
import { FolderBrowser } from "@/components/browse/FolderBrowser";
import { FolderDescription } from "@/components/browse/FolderDescription";
import { FileDetail } from "@/components/browse/FileDetail";
import {
  ColumnBrowser,
  type ColumnData,
} from "@/components/browse/ColumnBrowser";
import { MobileColumnFallback } from "@/components/browse/MobileColumnFallback";
import { getCurrentUser } from "@/server/auth/current-user";
import { createAccessResolver, type Resolver } from "@/server/access/resolver";
import { getGlobalDefaultAccess } from "@/server/access/global-default";

type Params = { provider: string; path?: string[] };
type SearchParams = {
  showAll?: string | string[];
  view?: string | string[];
};

function readViewParam(sp: SearchParams): "grid" | "column" {
  const v = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  return v === "column" ? "column" : "grid";
}

async function loadAllowedListing(
  provider: ReturnType<typeof providerFromRow>,
  resolver: Resolver,
  path: string,
): Promise<{ entries: Entry[]; hash: string }> {
  const raw = await listWithCache(provider, path);
  const hash = computeDirHash(raw);
  const visibleAfterHidden = raw.filter((e) => !isHiddenEntry(e.name));
  const allowed: Entry[] = [];
  for (const child of visibleAfterHidden) {
    const childPath = path === "" ? child.name : `${path}/${child.name}`;
    const decision = await resolver.resolve(childPath, child.type);
    if (decision === "allow") allowed.push(child);
  }
  return { entries: sortEntries(allowed), hash };
}

export default async function BrowsePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { provider: slug, path: rawSegments = [] } = await params;
  const segments = decodePathSegments(rawSegments);
  if (!segments) notFound();
  const row = findProviderBySlug(getDatabase(), slug);
  if (!row) notFound();
  const provider = providerFromRow(row);
  const path = segments.join("/");
  const sp = await searchParams;
  const showAll = sp.showAll === "1";
  const view = readViewParam(sp);

  const user = await getCurrentUser();
  const config = row.config as { defaultAccess?: "public" | "signed-in" };
  const resolver = createAccessResolver({
    user,
    storage: provider,
    providerDefault: config.defaultAccess,
    globalDefault: getGlobalDefaultAccess(getDatabase()),
  });

  let entry: Entry;
  try {
    entry = await provider.stat(path);
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof PathTraversalError) {
      notFound();
    }
    throw err;
  }

  const decision = await resolver.resolve(path, entry.type);
  if (decision === "deny-anonymous") {
    const callbackUrl = encodeURIComponent(
      `/${slug}${path ? `/${path}` : ""}`,
    );
    redirect(`/login?callbackUrl=${callbackUrl}`);
  }
  if (decision === "deny-authed") {
    notFound();
  }

  // Column view branch
  if (view === "column") {
    const chain = columnAncestorChain(segments, entry.type);

    // The resolver's per-request cache is intentionally shared across these
    // parallel calls; concurrent cache-miss writes are idempotent.
    const columns: ColumnData[] = await Promise.all(
      chain.map(async (colPath) => {
        const { entries, hash } = await loadAllowedListing(
          provider,
          resolver,
          colPath,
        );
        return { path: colPath, entries, hash };
      }),
    );

    // Per-column active row mapping: column at depth N highlights segments[N].
    const activeNames: (string | null)[] = chain.map((_, i) => segments[i] ?? null);

    let selectedLeaf: Entry | null = null;
    let leafParentPath: string | null = null;
    if (entry.type === "file") {
      selectedLeaf = entry;
      leafParentPath = segments.slice(0, -1).join("/");
    }

    const encodedPath = path ? `/${encodePathSegments(path)}` : "";
    const gridHref = `/${slug}${encodedPath}${
      sp.showAll === "1" ? "?showAll=1" : ""
    }`;

    return (
      <div className="flex flex-col gap-4">
        <Breadcrumbs
          providerSlug={slug}
          providerName={row.name}
          pathSegments={segments}
        />
        <ColumnBrowser
          providerSlug={slug}
          providerName={row.name}
          columns={columns}
          activeNames={activeNames}
          selectedLeaf={selectedLeaf}
          leafParentPath={leafParentPath}
          thumbnailsEnabled={isThumbnailServiceEnabled()}
        />
        <MobileColumnFallback gridHref={gridHref} />
      </div>
    );
  }

  // Grid / detail (existing behaviour)
  if (entry.type === "directory") {
    const { entries: visible, hash } = await loadAllowedListing(
      provider,
      resolver,
      path,
    );
    const description = findFolderDescription(visible);
    const sidecars = findSidecarMarkdowns(visible);
    return (
      <div className="flex flex-col gap-4">
        <Breadcrumbs
          providerSlug={slug}
          providerName={row.name}
          pathSegments={segments}
        />
        {description && (
          <FolderDescription
            provider={provider}
            parentPath={path}
            descriptionEntry={description}
          />
        )}
        {sidecars.size > 0 && (
          <div className="flex justify-end">
            <Link
              href={showAll ? "?" : "?showAll=1"}
              className="text-xs text-neutral-500 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              {showAll
                ? `Hide description files (${sidecars.size})`
                : `Show description files (${sidecars.size})`}
            </Link>
          </div>
        )}
        <FolderBrowser
          providerSlug={slug}
          path={path}
          parentPath={path}
          initialEntries={visible}
          initialHash={hash}
          descriptionName={description?.name ?? null}
          sidecarNames={showAll ? [] : Array.from(sidecars)}
          thumbnailsEnabled={isThumbnailServiceEnabled()}
        />
      </div>
    );
  }

  // File detail page — load siblings for sidecar lookup.
  const parentSegments = segments.slice(0, -1);
  const parentPath = parentSegments.join("/");
  const rawSiblings = (await listWithCache(provider, parentPath)).filter(
    (e) => !isHiddenEntry(e.name),
  );
  const siblings: Entry[] = [];
  for (const sib of rawSiblings) {
    const sibPath = parentPath === "" ? sib.name : `${parentPath}/${sib.name}`;
    const sibDecision = await resolver.resolve(sibPath, sib.type);
    if (sibDecision === "allow") siblings.push(sib);
  }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs
        providerSlug={slug}
        providerName={row.name}
        pathSegments={segments}
      />
      <FileDetail
        provider={provider}
        parentPath={parentPath}
        fileEntry={entry}
        siblings={siblings}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify the existing grid path is unchanged in behaviour**

Run: `pnpm vitest run tests/components/browse/FolderBrowser.test.tsx`
Expected: PASS — no regressions.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: PASS — all tests green, including new column-view tests.

- [ ] **Step 4: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 5: Run a build to confirm Next.js compilation**

Run: `pnpm build`
Expected: build succeeds, no warnings about new files. (`prebuild` will regenerate default icons; that's expected.)

- [ ] **Step 6: Commit**

```bash
git add src/app/'[provider]'/'[[...path]]'/page.tsx
git commit -m "feat(browse): wire column view into [provider]/[[...path]] page

When ?view=column is set, RSC builds the ancestor chain, fetches
all listings in parallel, and renders ColumnBrowser + a CSS-hidden
MobileColumnFallback for <md viewports.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: Manual smoke verification on Coolify

**Files:**
- None (verification only).

**WHO RUNS THIS:** The executor (subagent-driven-development) should **SKIP this task**. It runs after the work has landed on `main` and a new GHCR image is published — typically by the human user when they review the merged changes.

The instructions below are for that post-merge verification step.

- [ ] **Step 1: Check current commit is the latest with column-view changes**

Run: `git log --oneline -8`
Expected: most recent commit is the page-wiring one from Task 10.

- [ ] **Step 2: Push to remote**

Run: `git push`
Expected: GitHub Actions starts a build.

- [ ] **Step 3: Wait for the GHCR image to publish**

Run: `gh run list --limit 1` and check status.
Expected: most-recent run is `completed: success`. If still in progress, wait then re-check.

- [ ] **Step 4: Trigger the Coolify redeploy**

Run: `coolify deploy uuid eoqo9ctdghx2bb5bi6zukkvd`

- [ ] **Step 5: Poll for healthy status**

Run: `coolify list` (or whatever command shows app status) and look for `running:healthy` on the test instance.

- [ ] **Step 6: Manually exercise on the live URL**

Test in a browser:
1. Open the site, go to a directory with subdirectories.
2. Click the **Column** toggle in the toolbar — URL gains `?view=column`.
3. Click a directory in column 0 — column 1 appears with that directory's contents.
4. Click another directory in column 1 — column 2 appears, column 1 retains highlight.
5. Click a file in the rightmost column — column structure stays, detail strip appears at bottom.
6. Click **Open** in detail strip — navigates to file detail page (no `?view=column`). Browser back returns to column view.
7. Click the **Grid** toggle — URL drops `?view=column`, grid view restored.
8. Resize the browser narrow (<768 px) — column view disappears, mobile fallback notice appears with link.
9. Click the mobile fallback link — switches to grid view.
10. Open a `?view=column` URL on a phone (or narrow desktop window) — verify the fallback notice appears immediately, no horizontally-scrolling broken UI.

- [ ] **Step 7: Document any surprises**

If anything doesn't behave like the spec describes, file a follow-up. Otherwise, the phase is complete.

---

## Self-Review Checklist (run before handing off to executor)

- [x] Each spec section has a covering task: §2 architecture (Tasks 3, 9, 10), §3 URL semantics (Tasks 4, 6, 9, 10), §4 UI layout (Tasks 6, 7, 8, 9), §5 server pipeline reused (Task 10 via `loadAllowedListing`), §6 persistence (Tasks 1, 4), §7 accessibility (Tasks 4, 6, 7, 8), §8 testing covered.
- [x] No "TBD", no "implement later", no "similar to Task N".
- [x] Type names consistent: `ColumnData`, `BrowseView`, `LeafKind`, `Resolver`.
- [x] Method signatures match between definition and usage: `mergeSearchParams(URLSearchParams, Record<string, string|null>) → string`, `columnAncestorChain(segments, leafKind) → string[]`, `loadAllowedListing(provider, resolver, path) → {entries, hash}`.
- [x] All test files use the existing `tests/<mirror>` convention.
- [x] All commits follow the existing project convention (`feat(scope): …` / `refactor(scope): …`) with `Co-Authored-By` trailer.
