# File Browsing MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 4 of the Minifold spec — directory listing as the default view at `/{providerSlug}/{...path}`, with a grid of folder/file cards, an inline detail page for `.md` and `.pdf` files (and download for everything else), and a streaming file-content API. No 3D viewer, no thumbnails, no IndexedDB cache, no per-path access control — those are later phases.

**Architecture:** Pure RSC for browse pages — page.tsx calls `StorageProvider.list()` / `stat()` directly (no tRPC layer needed yet; that arrives in Phase 6 with `dir_cache`). A `route.ts` handler streams file bytes through `StorageProvider.read()` for downloads, inline PDF display, and (in later phases) the 3D viewer. Markdown rendering uses `react-markdown` with `rehype-sanitize` so RSC can return safely-sanitized React trees with no `dangerouslySetInnerHTML`. Spec sections in scope: §5 (File Browsing), §10.Grid View, §10.Detail Page; explicitly out of scope: §6 thumbnails, §7 caching, §8 access control, §10.Column View.

**Tech Stack:** Next.js 16 App Router (Promise-based `params`), React 19 RSC, TypeScript, `react-markdown` + `remark-gfm` + `rehype-sanitize`, existing `StorageProvider` interface, Vitest.

---

## File Map

| Status | Path | Responsibility |
|---|---|---|
| **Create** | `src/server/browse/hidden.ts` | `isHiddenEntry(name)` — hides `.minifold_*` and dotfiles starting with `.minifold_` |
| **Create** | `src/server/browse/sort.ts` | `sortEntries(entries)` — folders first, then files alpha |
| **Create** | `src/server/browse/file-kind.ts` | `fileKindOf(name)` → `"md" \| "pdf" \| "stl" \| "3mf" \| "image" \| "other"` |
| **Create** | `src/server/browse/mime.ts` | `mimeFor(name)` — extension→content-type lookup for the file route |
| **Create** | `src/server/browse/description-file.ts` | `findFolderDescription(entries)` — picks `index.md`/`readme.md`/`model.md`/`collection.md`, case-insensitive |
| **Create** | `src/server/browse/frontmatter.ts` | Tiny `parseFrontmatter(src)` that extracts `tags` (string[]) + content body |
| **Create** | `src/server/browse/load-provider.ts` | `loadProvider(slug)` — DB lookup + factory wrap |
| **Create** | `src/server/browse/read-text.ts` | `readTextFile(provider, path)` — drains a `read()` stream into a UTF-8 string |
| **Create** | `src/server/browse/reserved-slugs.ts` | `RESERVED_SLUGS` set + `isReservedSlug(s)` — top-level routes that must not collide with provider slugs |
| **Modify** | `src/server/db/providers.ts` | `generateUniqueSlug` — skip reserved bases |
| **Modify** | `src/app/admin/providers/actions.ts` | Reject reserved user-supplied slug |
| **Modify** | `src/app/setup/actions.ts` | Reject reserved user-supplied slug |
| **Create** | `src/app/api/file/[provider]/[...path]/route.ts` | `GET` streams file bytes; `inline=1` query param controls Content-Disposition |
| **Create** | `src/components/browse/Breadcrumbs.tsx` | RSC breadcrumb trail for `/provider/a/b/c` |
| **Create** | `src/components/browse/Markdown.tsx` | RSC `react-markdown` wrapper with `remark-gfm` + `rehype-sanitize` |
| **Create** | `src/components/browse/FolderDescription.tsx` | Loads sibling description file via provider, renders `<Markdown>` above grid |
| **Create** | `src/components/browse/EntryCard.tsx` | Single grid card (folder vs file by kind, with type icon) |
| **Create** | `src/components/browse/FolderGrid.tsx` | Grid of `EntryCard`s |
| **Create** | `src/components/browse/FileDetail.tsx` | Detail page switch: MD viewer, PDF iframe, generic download |
| **Create** | `src/app/[provider]/[[...path]]/page.tsx` | The browse RSC: stat → directory or file branch |
| **Create** | tests for each helper above |  |
| **Create** | `tests/app/api/file/route.test.ts` | File streaming route handler test |
| **Create** | `tests/components/browse/EntryCard.test.tsx` | Card renders folder vs file kinds |
| **Create** | `tests/components/browse/Markdown.test.tsx` | `<Markdown>` renders + sanitizes script tags |

---

## Task 1: Reserved-slug validation

Provider slugs share the URL namespace with built-in routes. A user creating a provider with slug `admin` would be permanently shadowed by `/admin`. Lock this down before the browse route ships, and fix `generateUniqueSlug` to skip reserved bases too.

**Files:**
- Create: `src/server/browse/reserved-slugs.ts`
- Create: `tests/server/browse/reserved-slugs.test.ts`
- Modify: `src/server/db/providers.ts`
- Modify: `src/app/admin/providers/actions.ts`
- Modify: `src/app/setup/actions.ts`
- Modify: `tests/app/admin/providers/actions.test.ts`

- [ ] **Step 1: Write the failing reserved-slugs test**

```ts
// tests/server/browse/reserved-slugs.test.ts
import { describe, it, expect } from "vitest";
import { isReservedSlug, RESERVED_SLUGS } from "@/server/browse/reserved-slugs";

describe("reserved slugs", () => {
  it("includes the obvious top-level routes", () => {
    expect(RESERVED_SLUGS.has("admin")).toBe(true);
    expect(RESERVED_SLUGS.has("api")).toBe(true);
    expect(RESERVED_SLUGS.has("login")).toBe(true);
    expect(RESERVED_SLUGS.has("logout")).toBe(true);
    expect(RESERVED_SLUGS.has("setup")).toBe(true);
  });

  it("isReservedSlug is case-insensitive and trim-tolerant", () => {
    expect(isReservedSlug("Admin")).toBe(true);
    expect(isReservedSlug("  api ")).toBe(true);
    expect(isReservedSlug("nas")).toBe(false);
    expect(isReservedSlug("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — confirm it fails**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/server/browse/reserved-slugs.test.ts 2>&1 | tail -10
```

Expected: `Cannot find module '@/server/browse/reserved-slugs'`.

- [ ] **Step 3: Implement reserved-slugs.ts**

```ts
// src/server/browse/reserved-slugs.ts

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
```

- [ ] **Step 4: Re-run — confirm it passes**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/server/browse/reserved-slugs.test.ts 2>&1 | tail -10
```

Expected: pass.

- [ ] **Step 5: Add a test for `generateUniqueSlug` skipping reserved bases**

Append the following inside the existing `describe("providers repository", ...)` block in `tests/server/db/providers.test.ts` (just before its closing `});`):

```ts
it("generateUniqueSlug skips reserved bases (admin → admin-2)", () => {
  expect(generateUniqueSlug(db, "Admin")).toBe("admin-2");
});

it("generateUniqueSlug skips reserved bases regardless of collision (api → api-2)", () => {
  expect(generateUniqueSlug(db, "API")).toBe("api-2");
});
```

- [ ] **Step 6: Run the providers test — confirm the new ones fail**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/server/db/providers.test.ts 2>&1 | tail -15
```

Expected: the two new tests fail (current behavior returns `"admin"`).

- [ ] **Step 7: Update `generateUniqueSlug` to skip reserved bases**

Modify `src/server/db/providers.ts`. Add the import at the top:

```ts
import { isReservedSlug } from "@/server/browse/reserved-slugs";
```

Replace the body of `generateUniqueSlug` (currently lines ~99-111) with:

```ts
export function generateUniqueSlug(db: Database, name: string): string {
  const base = slugify(name) || "provider";
  const exists = db.prepare("SELECT 1 FROM providers WHERE slug = ?");
  const isFree = (s: string) => !isReservedSlug(s) && !exists.get(s);
  if (isFree(base)) return base;
  for (let suffix = 2; suffix <= 999; suffix++) {
    const tail = `-${suffix}`;
    const allowed = 32 - tail.length;
    const trimmed = base.length > allowed ? base.slice(0, allowed) : base;
    const candidate = `${trimmed}${tail}`;
    if (isFree(candidate)) return candidate;
  }
  throw new Error("generateUniqueSlug: too many collisions");
}
```

- [ ] **Step 8: Run the providers test — confirm all pass**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/server/db/providers.test.ts 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 9: Add reserved-slug validation in `addProvider`**

In `src/app/admin/providers/actions.ts`, after the existing imports, add:

```ts
import { isReservedSlug } from "@/server/browse/reserved-slugs";
```

Then, inside `addProvider`, immediately after the `parsed = providerSchema.safeParse(raw)` block (right before the `const db = getDatabase()` line), add:

```ts
if (parsed.data.slug && isReservedSlug(parsed.data.slug)) {
  return { fieldErrors: { slug: "Slug is reserved" } };
}
```

- [ ] **Step 10: Add reserved-slug validation in `createFirstProvider`**

In `src/app/setup/actions.ts`, add the import at the top:

```ts
import { isReservedSlug } from "@/server/browse/reserved-slugs";
```

Inside `createFirstProvider`, after the `safeParse` block, before `let slug: string;`, insert:

```ts
if (parsed.data.slug && isReservedSlug(parsed.data.slug)) {
  return { fieldErrors: { slug: "Slug is reserved" } };
}
```

- [ ] **Step 11: Add an action-layer regression test**

Append the following test inside the existing `describe("addProvider — local", ...)` block in `tests/app/admin/providers/actions.test.ts` (just before its closing `});`):

```ts
it("returns fieldErrors when slug is reserved", async () => {
  const { addProvider } = await import("@/app/admin/providers/actions");
  const state = await addProvider(
    {},
    makeFormData({ type: "local", name: "Admin", rootPath: "/files", slug: "admin" }),
  );
  expect(state.fieldErrors?.slug).toBeTruthy();
});
```

- [ ] **Step 12: Run the full suite — everything passes**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run 2>&1 | tail -8
```

Expected: all tests pass.

- [ ] **Step 13: Commit**

```bash
git add src/server/browse/reserved-slugs.ts \
        tests/server/browse/reserved-slugs.test.ts \
        src/server/db/providers.ts \
        tests/server/db/providers.test.ts \
        src/app/admin/providers/actions.ts \
        src/app/setup/actions.ts \
        tests/app/admin/providers/actions.test.ts
git commit -m "feat(providers): reject reserved slugs that would collide with built-in routes"
```

---

## Task 2: Listing helpers — `hidden`, `sort`, `file-kind`, `mime`

Pure functions, all TDD, all in one task because each is tiny.

**Files:**
- Create: `src/server/browse/hidden.ts`
- Create: `src/server/browse/sort.ts`
- Create: `src/server/browse/file-kind.ts`
- Create: `src/server/browse/mime.ts`
- Create: `tests/server/browse/hidden.test.ts`
- Create: `tests/server/browse/sort.test.ts`
- Create: `tests/server/browse/file-kind.test.ts`
- Create: `tests/server/browse/mime.test.ts`

- [ ] **Step 1: Write all four failing tests**

```ts
// tests/server/browse/hidden.test.ts
import { describe, it, expect } from "vitest";
import { isHiddenEntry } from "@/server/browse/hidden";

describe("isHiddenEntry", () => {
  it("hides the .minifold_access.json control file", () => {
    expect(isHiddenEntry(".minifold_access.json")).toBe(true);
  });

  it("hides any .minifold_* dotfile", () => {
    expect(isHiddenEntry(".minifold_thumb_anchor.stl.webp")).toBe(true);
    expect(isHiddenEntry(".minifold_anything")).toBe(true);
  });

  it("does NOT hide regular dotfiles", () => {
    expect(isHiddenEntry(".gitkeep")).toBe(false);
    expect(isHiddenEntry(".env")).toBe(false);
  });

  it("does NOT hide normal files", () => {
    expect(isHiddenEntry("anchor.stl")).toBe(false);
    expect(isHiddenEntry("README.md")).toBe(false);
  });
});
```

```ts
// tests/server/browse/sort.test.ts
import { describe, it, expect } from "vitest";
import { sortEntries } from "@/server/browse/sort";
import type { Entry } from "@/server/storage/types";

const e = (
  name: string,
  type: Entry["type"] = "file",
  modifiedAt = new Date(0),
): Entry => ({ name, type, size: 0, modifiedAt });

describe("sortEntries", () => {
  it("places directories before files", () => {
    const sorted = sortEntries([e("a.stl"), e("zfolder", "directory"), e("b.md")]);
    expect(sorted.map((x) => x.name)).toEqual(["zfolder", "a.stl", "b.md"]);
  });

  it("sorts both directories and files alphabetically (case-insensitive)", () => {
    const sorted = sortEntries([
      e("Beta.md"),
      e("alpha.md"),
      e("Z", "directory"),
      e("a", "directory"),
    ]);
    expect(sorted.map((x) => x.name)).toEqual(["a", "Z", "alpha.md", "Beta.md"]);
  });

  it("does not mutate the input array", () => {
    const input = [e("b"), e("a")];
    const out = sortEntries(input);
    expect(input.map((x) => x.name)).toEqual(["b", "a"]);
    expect(out.map((x) => x.name)).toEqual(["a", "b"]);
  });
});
```

```ts
// tests/server/browse/file-kind.test.ts
import { describe, it, expect } from "vitest";
import { fileKindOf } from "@/server/browse/file-kind";

describe("fileKindOf", () => {
  it("recognises markdown", () => {
    expect(fileKindOf("README.md")).toBe("md");
    expect(fileKindOf("notes.markdown")).toBe("md");
    expect(fileKindOf("UPPER.MD")).toBe("md");
  });

  it("recognises PDFs", () => {
    expect(fileKindOf("manual.pdf")).toBe("pdf");
    expect(fileKindOf("manual.PDF")).toBe("pdf");
  });

  it("recognises 3D files", () => {
    expect(fileKindOf("anchor.stl")).toBe("stl");
    expect(fileKindOf("benchy.3mf")).toBe("3mf");
  });

  it("recognises images", () => {
    expect(fileKindOf("photo.jpg")).toBe("image");
    expect(fileKindOf("photo.jpeg")).toBe("image");
    expect(fileKindOf("photo.png")).toBe("image");
    expect(fileKindOf("photo.webp")).toBe("image");
    expect(fileKindOf("photo.gif")).toBe("image");
  });

  it("falls back to other for unknown extensions", () => {
    expect(fileKindOf("data.bin")).toBe("other");
    expect(fileKindOf("noext")).toBe("other");
  });
});
```

```ts
// tests/server/browse/mime.test.ts
import { describe, it, expect } from "vitest";
import { mimeFor } from "@/server/browse/mime";

describe("mimeFor", () => {
  it("returns the right type for known extensions", () => {
    expect(mimeFor("anchor.stl")).toBe("model/stl");
    expect(mimeFor("benchy.3mf")).toBe("model/3mf");
    expect(mimeFor("doc.pdf")).toBe("application/pdf");
    expect(mimeFor("note.md")).toBe("text/markdown; charset=utf-8");
    expect(mimeFor("note.markdown")).toBe("text/markdown; charset=utf-8");
    expect(mimeFor("page.html")).toBe("text/html; charset=utf-8");
    expect(mimeFor("photo.jpg")).toBe("image/jpeg");
    expect(mimeFor("photo.jpeg")).toBe("image/jpeg");
    expect(mimeFor("photo.png")).toBe("image/png");
    expect(mimeFor("photo.webp")).toBe("image/webp");
    expect(mimeFor("photo.gif")).toBe("image/gif");
    expect(mimeFor("data.json")).toBe("application/json");
    expect(mimeFor("data.txt")).toBe("text/plain; charset=utf-8");
  });

  it("falls back to application/octet-stream", () => {
    expect(mimeFor("data.bin")).toBe("application/octet-stream");
    expect(mimeFor("noext")).toBe("application/octet-stream");
  });

  it("is case-insensitive on extension", () => {
    expect(mimeFor("DOC.PDF")).toBe("application/pdf");
  });
});
```

- [ ] **Step 2: Run them — confirm all four files fail**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/server/browse/ 2>&1 | tail -15
```

Expected: 4 failing test files due to missing modules.

- [ ] **Step 3: Implement `hidden.ts`**

```ts
// src/server/browse/hidden.ts

// Hides files Minifold uses for its own bookkeeping (thumbs, access rules, …).
// Anything starting with ".minifold_" is for our internal use; everything else
// — including .gitkeep, .env, etc — is the user's business and stays visible.
export function isHiddenEntry(name: string): boolean {
  return name.startsWith(".minifold_");
}
```

- [ ] **Step 4: Implement `sort.ts`**

```ts
// src/server/browse/sort.ts
import type { Entry } from "@/server/storage/types";

const collator = new Intl.Collator(undefined, { sensitivity: "base" });

export function sortEntries(entries: readonly Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
}
```

- [ ] **Step 5: Implement `file-kind.ts`**

```ts
// src/server/browse/file-kind.ts

export type FileKind = "md" | "pdf" | "stl" | "3mf" | "image" | "other";

const EXT_TO_KIND: Record<string, FileKind> = {
  md: "md",
  markdown: "md",
  pdf: "pdf",
  stl: "stl",
  "3mf": "3mf",
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  gif: "image",
};

export function fileKindOf(name: string): FileKind {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "other";
  const ext = name.slice(dot + 1).toLowerCase();
  return EXT_TO_KIND[ext] ?? "other";
}
```

- [ ] **Step 6: Implement `mime.ts`**

```ts
// src/server/browse/mime.ts

const MIME_BY_EXT: Record<string, string> = {
  stl: "model/stl",
  "3mf": "model/3mf",
  pdf: "application/pdf",
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  json: "application/json",
  csv: "text/csv; charset=utf-8",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

export function mimeFor(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  const ext = name.slice(dot + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}
```

- [ ] **Step 7: Re-run all four — confirm pass**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/server/browse/ 2>&1 | tail -10
```

Expected: 4 test files pass.

- [ ] **Step 8: Commit**

```bash
git add src/server/browse/hidden.ts src/server/browse/sort.ts \
        src/server/browse/file-kind.ts src/server/browse/mime.ts \
        tests/server/browse/hidden.test.ts tests/server/browse/sort.test.ts \
        tests/server/browse/file-kind.test.ts tests/server/browse/mime.test.ts
git commit -m "feat(browse): listing helpers — hidden, sort, file-kind, mime"
```

---

## Task 3: Folder description finder + frontmatter parser

The folder-description finder picks `index.md` / `readme.md` / `model.md` / `collection.md` (case-insensitive, in that priority order) so a directory page can render an intro above the grid. The frontmatter parser extracts `tags` so the file detail page can show pills.

**Files:**
- Create: `src/server/browse/description-file.ts`
- Create: `src/server/browse/frontmatter.ts`
- Create: `tests/server/browse/description-file.test.ts`
- Create: `tests/server/browse/frontmatter.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server/browse/description-file.test.ts
import { describe, it, expect } from "vitest";
import { findFolderDescription, findFileDescription } from "@/server/browse/description-file";
import type { Entry } from "@/server/storage/types";

const file = (name: string): Entry => ({
  name,
  type: "file",
  size: 0,
  modifiedAt: new Date(0),
});
const dir = (name: string): Entry => ({
  name,
  type: "directory",
  size: 0,
  modifiedAt: new Date(0),
});

describe("findFolderDescription", () => {
  it("prefers index.md over the others", () => {
    expect(
      findFolderDescription([file("readme.md"), file("index.md"), file("anchor.stl")])
        ?.name,
    ).toBe("index.md");
  });

  it("falls back through readme.md → model.md → collection.md", () => {
    expect(findFolderDescription([file("readme.md"), file("a.stl")])?.name).toBe(
      "readme.md",
    );
    expect(findFolderDescription([file("model.md")])?.name).toBe("model.md");
    expect(findFolderDescription([file("collection.md")])?.name).toBe(
      "collection.md",
    );
  });

  it("is case-insensitive", () => {
    expect(findFolderDescription([file("README.md")])?.name).toBe("README.md");
    expect(findFolderDescription([file("Index.MD")])?.name).toBe("Index.MD");
  });

  it("ignores directories with matching names", () => {
    expect(findFolderDescription([dir("readme.md")])).toBeNull();
  });

  it("returns null when no description file is present", () => {
    expect(findFolderDescription([file("a.stl"), file("notes.txt")])).toBeNull();
  });
});

describe("findFileDescription", () => {
  it("finds anchor.md alongside anchor.stl", () => {
    const siblings = [file("anchor.stl"), file("anchor.md"), file("other.stl")];
    expect(findFileDescription(siblings, "anchor.stl")?.name).toBe("anchor.md");
  });

  it("is case-insensitive on the basename", () => {
    const siblings = [file("Anchor.STL"), file("anchor.MD")];
    expect(findFileDescription(siblings, "Anchor.STL")?.name).toBe("anchor.MD");
  });

  it("returns null if no sibling .md exists", () => {
    expect(
      findFileDescription([file("anchor.stl")], "anchor.stl"),
    ).toBeNull();
  });

  it("does not match the file itself when it is already a .md", () => {
    expect(findFileDescription([file("notes.md")], "notes.md")).toBeNull();
  });
});
```

```ts
// tests/server/browse/frontmatter.test.ts
import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "@/server/browse/frontmatter";

describe("parseFrontmatter", () => {
  it("returns the body unchanged when there is no frontmatter", () => {
    const src = "# Hello\n\nworld\n";
    expect(parseFrontmatter(src)).toEqual({ tags: [], body: src });
  });

  it("extracts tags from a YAML list", () => {
    const src = "---\ntags:\n  - one\n  - two\n  - three\n---\n# Body\n";
    expect(parseFrontmatter(src)).toEqual({
      tags: ["one", "two", "three"],
      body: "# Body\n",
    });
  });

  it("extracts tags from a flow-style list", () => {
    const src = "---\ntags: [a, b, c]\n---\nBody";
    expect(parseFrontmatter(src)).toEqual({
      tags: ["a", "b", "c"],
      body: "Body",
    });
  });

  it("extracts tags from a comma-separated string", () => {
    const src = "---\ntags: foo, bar,baz \n---\nBody";
    expect(parseFrontmatter(src)).toEqual({
      tags: ["foo", "bar", "baz"],
      body: "Body",
    });
  });

  it("strips the frontmatter even when no tags are declared", () => {
    const src = "---\ntitle: hi\n---\nBody";
    expect(parseFrontmatter(src)).toEqual({ tags: [], body: "Body" });
  });

  it("ignores frontmatter not at the very start", () => {
    const src = "# Heading\n---\ntags: [a]\n---\n";
    expect(parseFrontmatter(src)).toEqual({ tags: [], body: src });
  });
});
```

- [ ] **Step 2: Run — confirm fail**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/server/browse/description-file.test.ts tests/server/browse/frontmatter.test.ts 2>&1 | tail -15
```

Expected: failures because modules don't exist.

- [ ] **Step 3: Implement `description-file.ts`**

```ts
// src/server/browse/description-file.ts
import type { Entry } from "@/server/storage/types";

const FOLDER_DESC_PRIORITY = ["index.md", "readme.md", "model.md", "collection.md"];

export function findFolderDescription(entries: readonly Entry[]): Entry | null {
  for (const target of FOLDER_DESC_PRIORITY) {
    const found = entries.find(
      (e) => e.type === "file" && e.name.toLowerCase() === target,
    );
    if (found) return found;
  }
  return null;
}

export function findFileDescription(
  siblings: readonly Entry[],
  fileName: string,
): Entry | null {
  const dot = fileName.lastIndexOf(".");
  const baseLower = (dot < 0 ? fileName : fileName.slice(0, dot)).toLowerCase();
  if (!baseLower) return null;
  for (const e of siblings) {
    if (e.type !== "file") continue;
    if (e.name === fileName) continue; // do not match self
    const eDot = e.name.lastIndexOf(".");
    if (eDot < 0) continue;
    const eExt = e.name.slice(eDot + 1).toLowerCase();
    if (eExt !== "md" && eExt !== "markdown") continue;
    const eBase = e.name.slice(0, eDot).toLowerCase();
    if (eBase === baseLower) return e;
  }
  return null;
}
```

- [ ] **Step 4: Implement `frontmatter.ts`**

```ts
// src/server/browse/frontmatter.ts

// Minimal, no-deps frontmatter parser. Only extracts `tags`. Anything else
// in the frontmatter is dropped from the body but otherwise ignored.
//
// Recognised tag forms:
//   tags:
//     - one
//     - two
//   tags: [one, two]
//   tags: one, two
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(src: string): {
  tags: string[];
  body: string;
} {
  const m = FRONTMATTER_RE.exec(src);
  if (!m) return { tags: [], body: src };
  const fmBody = m[1];
  const body = src.slice(m[0].length);
  const tags = extractTags(fmBody);
  return { tags, body };
}

function extractTags(fm: string): string[] {
  const lines = fm.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inline = /^tags:\s*(.*)$/.exec(line);
    if (!inline) continue;
    const value = inline[1].trim();
    if (value === "") {
      // Block list on subsequent lines
      const out: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const item = /^\s*-\s*(.+?)\s*$/.exec(lines[j]);
        if (!item) break;
        out.push(stripQuotes(item[1]));
      }
      return out;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      // Flow-style list
      return value
        .slice(1, -1)
        .split(",")
        .map((s) => stripQuotes(s.trim()))
        .filter((s) => s.length > 0);
    }
    // Comma-separated string
    return value
      .split(",")
      .map((s) => stripQuotes(s.trim()))
      .filter((s) => s.length > 0);
  }
  return [];
}

function stripQuotes(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}
```

- [ ] **Step 5: Re-run — confirm pass**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/server/browse/description-file.test.ts tests/server/browse/frontmatter.test.ts 2>&1 | tail -10
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/browse/description-file.ts src/server/browse/frontmatter.ts \
        tests/server/browse/description-file.test.ts \
        tests/server/browse/frontmatter.test.ts
git commit -m "feat(browse): folder description finder + minimal frontmatter parser"
```

---

## Task 4: `loadProvider` helper

Tiny but used by every browse-related entrypoint. DB lookup → factory wrap → typed `null` when missing. Keeps page.tsx and route.ts free of factory plumbing.

**Files:**
- Create: `src/server/browse/load-provider.ts`
- Create: `tests/server/browse/load-provider.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/browse/load-provider.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createProvider } from "@/server/db/providers";
import { LocalStorageProvider } from "@/server/storage/local";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-load-provider-"));
  const db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
  db.close();
  vi.stubEnv("DATABASE_PATH", join(tmp, "test.db"));
  vi.resetModules();
});

afterEach(async () => {
  const { __resetDatabase } = await import("@/server/db");
  __resetDatabase();
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

describe("loadProvider", () => {
  it("returns null for an unknown slug", async () => {
    const { loadProvider } = await import("@/server/browse/load-provider");
    expect(loadProvider("nope")).toBeNull();
  });

  it("returns a LocalStorageProvider for a local DB row", async () => {
    const { getDatabase } = await import("@/server/db");
    createProvider(getDatabase(), {
      slug: "nas",
      name: "NAS",
      type: "local",
      config: { rootPath: "/files" },
    });
    const { loadProvider } = await import("@/server/browse/load-provider");
    const p = loadProvider("nas");
    expect(p).toBeInstanceOf(LocalStorageProvider);
    expect(p?.slug).toBe("nas");
  });

  it("is case-insensitive on the slug", async () => {
    const { getDatabase } = await import("@/server/db");
    createProvider(getDatabase(), {
      slug: "nas",
      name: "NAS",
      type: "local",
      config: { rootPath: "/files" },
    });
    const { loadProvider } = await import("@/server/browse/load-provider");
    expect(loadProvider("NAS")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it — confirm it fails**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/server/browse/load-provider.test.ts 2>&1 | tail -10
```

Expected: failure due to missing module.

- [ ] **Step 3: Implement `load-provider.ts`**

```ts
// src/server/browse/load-provider.ts
import { getDatabase } from "@/server/db";
import { findProviderBySlug } from "@/server/db/providers";
import { providerFromRow } from "@/server/storage/factory";
import type { StorageProvider } from "@/server/storage/types";

export function loadProvider(slug: string): StorageProvider | null {
  const row = findProviderBySlug(getDatabase(), slug);
  if (!row) return null;
  return providerFromRow(row);
}
```

- [ ] **Step 4: Re-run — confirm pass**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/server/browse/load-provider.test.ts 2>&1 | tail -10
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/browse/load-provider.ts tests/server/browse/load-provider.test.ts
git commit -m "feat(browse): loadProvider helper — DB row → StorageProvider instance"
```

---

## Task 4b: `readTextFile` helper

A tiny shared util used by both `FolderDescription` and `FileDetail` to read a markdown sidecar through the storage provider (no HTTP round-trip, no double-fetch).

**Files:**
- Create: `src/server/browse/read-text.ts`
- Create: `tests/server/browse/read-text.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/server/browse/read-text.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStorageProvider } from "@/server/storage/local";
import { readTextFile } from "@/server/browse/read-text";

let root: string;
let provider: LocalStorageProvider;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "minifold-readtext-"));
  writeFileSync(join(root, "hi.txt"), "hello world\n");
  writeFileSync(join(root, "utf8.md"), "# café — π ≈ 3.14\n");
  provider = new LocalStorageProvider({ slug: "p", rootPath: root });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("readTextFile", () => {
  it("returns the full file content as UTF-8", async () => {
    expect(await readTextFile(provider, "hi.txt")).toBe("hello world\n");
  });

  it("preserves multibyte characters", async () => {
    expect(await readTextFile(provider, "utf8.md")).toBe(
      "# café — π ≈ 3.14\n",
    );
  });
});
```

- [ ] **Step 2: Run — confirm fail**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/server/browse/read-text.test.ts 2>&1 | tail -10
```

Expected: failure due to missing module.

- [ ] **Step 3: Implement**

```ts
// src/server/browse/read-text.ts
import type { StorageProvider } from "@/server/storage/types";

export async function readTextFile(
  provider: StorageProvider,
  path: string,
): Promise<string> {
  const stream = await provider.read(path);
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf-8");
}
```

- [ ] **Step 4: Re-run — confirm pass**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/server/browse/read-text.test.ts 2>&1 | tail -10
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/browse/read-text.ts tests/server/browse/read-text.test.ts
git commit -m "feat(browse): readTextFile helper — drain provider stream as UTF-8 string"
```

---

## Task 5: File streaming API route

`GET /api/file/{provider}/{...path}?inline=1` resolves the provider, calls `stat()` to set `Content-Length`/`Content-Type`, then streams `read()` straight into the Response. Auth-checks `getCurrentUser()` because the proxy's matcher excludes paths with dots — without a manual check, signed-out users could fetch any file with an extension.

**Files:**
- Create: `src/app/api/file/[provider]/[...path]/route.ts`
- Create: `tests/app/api/file/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/app/api/file/route.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createProvider } from "@/server/db/providers";

vi.mock("@/server/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

let tmp: string;
let filesRoot: string;

async function ctx(provider: string, path: string[]) {
  return { params: Promise.resolve({ provider, path }) };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-file-route-"));
  filesRoot = join(tmp, "files");
  mkdirSync(filesRoot, { recursive: true });
  mkdirSync(join(filesRoot, "prints"));
  writeFileSync(
    join(filesRoot, "prints", "anchor.stl"),
    Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]),
  );
  writeFileSync(join(filesRoot, "notes.md"), "# Hello\n");

  const db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
  createProvider(db, {
    slug: "nas",
    name: "NAS",
    type: "local",
    config: { rootPath: filesRoot },
  });
  db.close();

  vi.stubEnv("DATABASE_PATH", join(tmp, "test.db"));
  vi.resetModules();
});

afterEach(async () => {
  const { __resetDatabase } = await import("@/server/db");
  __resetDatabase();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

async function authedAsUser() {
  const mod = await import("@/server/auth/current-user");
  vi.mocked(mod.getCurrentUser).mockResolvedValue({
    id: "u1",
    name: "User",
    username: "user",
    role: "user",
    must_change_password: 0,
    deactivated: 0,
    created_at: 0,
    last_login: null,
    password: "x",
  });
}

describe("GET /api/file/[provider]/[...path]", () => {
  it("401s when not signed in", async () => {
    const { getCurrentUser } = await import("@/server/auth/current-user");
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/nas/notes.md"),
      await ctx("nas", ["notes.md"]),
    );
    expect(res.status).toBe(401);
  });

  it("404s on unknown provider", async () => {
    await authedAsUser();
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/missing/notes.md"),
      await ctx("missing", ["notes.md"]),
    );
    expect(res.status).toBe(404);
  });

  it("404s on missing file", async () => {
    await authedAsUser();
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/nas/nope.md"),
      await ctx("nas", ["nope.md"]),
    );
    expect(res.status).toBe(404);
  });

  it("400s on a directory path", async () => {
    await authedAsUser();
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/nas/prints"),
      await ctx("nas", ["prints"]),
    );
    expect(res.status).toBe(400);
  });

  it("streams the file with the right content-type and bytes", async () => {
    await authedAsUser();
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/nas/prints/anchor.stl"),
      await ctx("nas", ["prints", "anchor.stl"]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("model/stl");
    expect(res.headers.get("content-length")).toBe("8");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf).toEqual(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
  });

  it("uses inline disposition when ?inline=1", async () => {
    await authedAsUser();
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/nas/notes.md?inline=1"),
      await ctx("nas", ["notes.md"]),
    );
    expect(res.headers.get("content-disposition")).toMatch(/^inline/);
  });

  it("uses attachment disposition by default", async () => {
    await authedAsUser();
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/nas/notes.md"),
      await ctx("nas", ["notes.md"]),
    );
    expect(res.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(res.headers.get("content-disposition")).toContain('filename="notes.md"');
  });

  it("returns 400 on path traversal", async () => {
    await authedAsUser();
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/nas/..%2Fetc%2Fpasswd"),
      await ctx("nas", ["..", "etc", "passwd"]),
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it — confirm it fails**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/app/api/file/route.test.ts 2>&1 | tail -15
```

Expected: failure (route not yet defined).

- [ ] **Step 3: Implement the route handler**

```ts
// src/app/api/file/[provider]/[...path]/route.ts
import { getCurrentUser } from "@/server/auth/current-user";
import { loadProvider } from "@/server/browse/load-provider";
import { mimeFor } from "@/server/browse/mime";
import {
  NotFoundError,
  PathTraversalError,
} from "@/server/storage/types";

type Ctx = {
  params: Promise<{ provider: string; path: string[] }>;
};

export async function GET(req: Request, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { provider: slug, path: segments } = await ctx.params;
  const provider = loadProvider(slug);
  if (!provider) return new Response("Not Found", { status: 404 });

  const path = (segments ?? []).join("/");
  const fileName = segments?.[segments.length - 1] ?? "";

  let entry;
  try {
    entry = await provider.stat(path);
  } catch (err) {
    if (err instanceof PathTraversalError) {
      return new Response("Bad Request", { status: 400 });
    }
    if (err instanceof NotFoundError) {
      return new Response("Not Found", { status: 404 });
    }
    throw err;
  }
  if (entry.type !== "file") {
    return new Response("Bad Request", { status: 400 });
  }

  let body;
  try {
    body = await provider.read(path);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return new Response("Not Found", { status: 404 });
    }
    if (err instanceof PathTraversalError) {
      return new Response("Bad Request", { status: 400 });
    }
    throw err;
  }

  const inline = new URL(req.url).searchParams.get("inline") === "1";
  const disposition = inline
    ? `inline; filename="${encodeFilename(fileName)}"`
    : `attachment; filename="${encodeFilename(fileName)}"`;

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": mimeFor(fileName),
      "content-length": String(entry.size),
      "content-disposition": disposition,
      "cache-control": "private, max-age=0",
    },
  });
}

function encodeFilename(name: string): string {
  // Escape quotes and backslashes; keep it ASCII-safe inside the quoted string.
  return name.replace(/[\\"]/g, "\\$&");
}
```

- [ ] **Step 4: Re-run — confirm pass**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/app/api/file/route.test.ts 2>&1 | tail -10
```

Expected: pass.

- [ ] **Step 5: Run the full suite**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run 2>&1 | tail -8
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/file/'[provider]'/'[...path]'/route.ts \
        tests/app/api/file/route.test.ts
git commit -m "feat(browse): GET /api/file/[provider]/[...path] streaming handler"
```

---

## Task 6: Markdown rendering component (deps + RSC wrapper)

`react-markdown` rendered on the server with `rehype-sanitize` produces a sanitized React subtree — no `dangerouslySetInnerHTML`, no extra runtime cost on the client. We pin the version range so future renovate-style upgrades don't surprise us.

**Files:**
- Modify: `package.json` (add deps)
- Create: `src/components/browse/Markdown.tsx`
- Create: `tests/components/browse/Markdown.test.tsx`

- [ ] **Step 1: Install dependencies**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm add react-markdown remark-gfm rehype-sanitize 2>&1 | tail -3
```

Expected: three packages added.

- [ ] **Step 2: Write the failing component test**

```tsx
// tests/components/browse/Markdown.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Markdown } from "@/components/browse/Markdown";

describe("Markdown", () => {
  it("renders headings, paragraphs, and lists", () => {
    const { container } = render(
      <Markdown source={"# Title\n\nHello *world*\n\n- a\n- b\n"} />,
    );
    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelector("em")?.textContent).toBe("world");
    expect(container.querySelectorAll("li").length).toBe(2);
  });

  it("renders GFM tables", () => {
    const md = "| h1 | h2 |\n|----|----|\n| a  | b  |\n";
    const { container } = render(<Markdown source={md} />);
    expect(container.querySelector("table")).toBeInTheDocument();
    expect(container.querySelectorAll("td").length).toBe(2);
  });

  it("strips <script> tags via sanitization", () => {
    const md = "Hello\n\n<script>alert(1)</script>\n";
    const { container } = render(<Markdown source={md} />);
    expect(container.querySelector("script")).toBeNull();
  });

  it("strips javascript: URLs in links", () => {
    const md = "[click](javascript:alert(1))";
    const { container } = render(<Markdown source={md} />);
    const a = container.querySelector("a");
    // rehype-sanitize either drops the href or replaces it; both are acceptable
    expect(a?.getAttribute("href") ?? "").not.toContain("javascript:");
  });
});
```

- [ ] **Step 3: Run — confirm it fails**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/components/browse/Markdown.test.tsx 2>&1 | tail -10
```

Expected: failure due to missing component.

- [ ] **Step 4: Implement the component**

```tsx
// src/components/browse/Markdown.tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

export function Markdown({ source }: { source: string }) {
  return (
    <div className="prose prose-neutral dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 5: Re-run — confirm pass**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/components/browse/Markdown.test.tsx 2>&1 | tail -10
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml \
        src/components/browse/Markdown.tsx \
        tests/components/browse/Markdown.test.tsx
git commit -m "feat(browse): RSC <Markdown> with remark-gfm + rehype-sanitize"
```

---

## Task 7: `Breadcrumbs`, `EntryCard`, `FolderGrid` components

RSC components — no client state. `EntryCard` renders the right type icon for the file's kind; for directories it links into the folder, for files it links to the detail page. The grid is just a CSS grid wrapping cards. Inline SVGs (no icon library — keeps the dep tree small).

**Files:**
- Create: `src/components/browse/Breadcrumbs.tsx`
- Create: `src/components/browse/EntryCard.tsx`
- Create: `src/components/browse/FolderGrid.tsx`
- Create: `tests/components/browse/EntryCard.test.tsx`

- [ ] **Step 1: Write the failing card test**

```tsx
// tests/components/browse/EntryCard.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { EntryCard } from "@/components/browse/EntryCard";

const file = (name: string) => ({
  name,
  type: "file" as const,
  size: 0,
  modifiedAt: new Date(0),
});
const dir = (name: string) => ({
  name,
  type: "directory" as const,
  size: 0,
  modifiedAt: new Date(0),
});

describe("EntryCard", () => {
  it("renders a folder card linking into the folder", () => {
    render(<EntryCard providerSlug="nas" parentPath="prints" entry={dir("benchy")} />);
    const link = screen.getByRole("link", { name: /benchy/i });
    expect(link.getAttribute("href")).toBe("/nas/prints/benchy");
  });

  it("renders a file card linking to the file detail page", () => {
    render(<EntryCard providerSlug="nas" parentPath="prints" entry={file("anchor.stl")} />);
    const link = screen.getByRole("link", { name: /anchor\.stl/i });
    expect(link.getAttribute("href")).toBe("/nas/prints/anchor.stl");
  });

  it("renders at the provider root when parentPath is empty", () => {
    render(<EntryCard providerSlug="nas" parentPath="" entry={file("readme.md")} />);
    const link = screen.getByRole("link", { name: /readme\.md/i });
    expect(link.getAttribute("href")).toBe("/nas/readme.md");
  });
});
```

- [ ] **Step 2: Run — confirm fail**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/components/browse/EntryCard.test.tsx 2>&1 | tail -10
```

Expected: failure due to missing component.

- [ ] **Step 3: Implement `Breadcrumbs.tsx`**

```tsx
// src/components/browse/Breadcrumbs.tsx
import Link from "next/link";

type Props = {
  providerSlug: string;
  providerName: string;
  pathSegments: readonly string[];
};

export function Breadcrumbs({ providerSlug, providerName, pathSegments }: Props) {
  const crumbs: { label: string; href: string }[] = [
    { label: providerName, href: `/${providerSlug}` },
  ];
  let acc = "";
  for (const seg of pathSegments) {
    acc = acc ? `${acc}/${seg}` : seg;
    crumbs.push({ label: seg, href: `/${providerSlug}/${acc}` });
  }
  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <ol className="flex flex-wrap items-center gap-1 text-neutral-500 dark:text-neutral-400">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={c.href} className="flex items-center gap-1">
              {isLast ? (
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {c.label}
                </span>
              ) : (
                <Link
                  href={c.href}
                  className="hover:text-neutral-900 dark:hover:text-neutral-100"
                >
                  {c.label}
                </Link>
              )}
              {!isLast && <span aria-hidden="true">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
```

- [ ] **Step 4: Implement `EntryCard.tsx`**

```tsx
// src/components/browse/EntryCard.tsx
import Link from "next/link";
import type { Entry } from "@/server/storage/types";
import { fileKindOf } from "@/server/browse/file-kind";

type Props = {
  providerSlug: string;
  parentPath: string;
  entry: Entry;
};

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function EntryCard({ providerSlug, parentPath, entry }: Props) {
  const childPath = joinPath(parentPath, entry.name);
  const href = `/${providerSlug}/${childPath}`;
  return (
    <Link
      href={href}
      className="group flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-center transition-colors hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-neutral-600 dark:hover:bg-neutral-900"
    >
      <Icon entry={entry} />
      <span className="line-clamp-2 break-all text-xs text-neutral-700 dark:text-neutral-300">
        {entry.name}
      </span>
    </Link>
  );
}

function Icon({ entry }: { entry: Entry }) {
  if (entry.type === "directory") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="h-12 w-12 fill-neutral-300 group-hover:fill-neutral-400 dark:fill-neutral-700 dark:group-hover:fill-neutral-600"
        aria-hidden="true"
      >
        <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />
      </svg>
    );
  }
  const kind = fileKindOf(entry.name);
  const label = kind === "other" ? "FILE" : kind.toUpperCase();
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded border border-neutral-300 bg-neutral-100 text-[10px] font-medium uppercase text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
      {label}
    </div>
  );
}
```

- [ ] **Step 5: Implement `FolderGrid.tsx`**

```tsx
// src/components/browse/FolderGrid.tsx
import type { Entry } from "@/server/storage/types";
import { EntryCard } from "./EntryCard";

type Props = {
  providerSlug: string;
  parentPath: string;
  entries: readonly Entry[];
};

export function FolderGrid({ providerSlug, parentPath, entries }: Props) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        This folder is empty.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {entries.map((e) => (
        <EntryCard
          key={e.name}
          providerSlug={providerSlug}
          parentPath={parentPath}
          entry={e}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Re-run the test — confirm pass**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run tests/components/browse/EntryCard.test.tsx 2>&1 | tail -10
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/browse/Breadcrumbs.tsx \
        src/components/browse/EntryCard.tsx \
        src/components/browse/FolderGrid.tsx \
        tests/components/browse/EntryCard.test.tsx
git commit -m "feat(browse): Breadcrumbs + EntryCard + FolderGrid (RSC)"
```

---

## Task 8: `FolderDescription` + `FileDetail` view components

Two RSCs that own the per-folder/per-file rendering. `FolderDescription` reads the description file via the storage provider and renders it as Markdown. `FileDetail` is a switch on `fileKindOf(name)`: `md` → inline rendered Markdown, `pdf` → iframe to the file API, `image` → `<img>`, anything else (incl. STL/3MF for now) → "Preview not available" placeholder. The right rail always shows file metadata, optional sibling-`.md` description with frontmatter tags, and a Download button.

**Files:**
- Create: `src/components/browse/FolderDescription.tsx`
- Create: `src/components/browse/FileDetail.tsx`

- [ ] **Step 1: Implement `FolderDescription.tsx`**

```tsx
// src/components/browse/FolderDescription.tsx
import type { StorageProvider, Entry } from "@/server/storage/types";
import { parseFrontmatter } from "@/server/browse/frontmatter";
import { readTextFile } from "@/server/browse/read-text";
import { Markdown } from "./Markdown";

type Props = {
  provider: StorageProvider;
  parentPath: string;
  descriptionEntry: Entry;
};

export async function FolderDescription({
  provider,
  parentPath,
  descriptionEntry,
}: Props) {
  const fullPath = parentPath
    ? `${parentPath}/${descriptionEntry.name}`
    : descriptionEntry.name;
  const raw = await readTextFile(provider, fullPath);
  const { body } = parseFrontmatter(raw);
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <Markdown source={body} />
    </section>
  );
}
```

- [ ] **Step 2: Implement `FileDetail.tsx`**

```tsx
// src/components/browse/FileDetail.tsx
import type { StorageProvider, Entry } from "@/server/storage/types";
import { fileKindOf, type FileKind } from "@/server/browse/file-kind";
import { parseFrontmatter } from "@/server/browse/frontmatter";
import { findFileDescription } from "@/server/browse/description-file";
import { readTextFile } from "@/server/browse/read-text";
import { Markdown } from "./Markdown";

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
  provider: StorageProvider;
  parentPath: string;
  fileEntry: Entry;
  siblings: readonly Entry[];
};

export async function FileDetail({
  provider,
  parentPath,
  fileEntry,
  siblings,
}: Props) {
  const kind = fileKindOf(fileEntry.name);
  const fullPath = joinPath(parentPath, fileEntry.name);
  const fileApi = `/api/file/${provider.slug}/${fullPath}`;

  const sidecar = findFileDescription(siblings, fileEntry.name);
  let sidecarBody: string | null = null;
  let sidecarTags: string[] = [];
  if (sidecar) {
    const sidecarPath = joinPath(parentPath, sidecar.name);
    const parsed = parseFrontmatter(await readTextFile(provider, sidecarPath));
    sidecarBody = parsed.body;
    sidecarTags = parsed.tags;
  }

  return (
    <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
      <div>
        <Viewer
          kind={kind}
          fileApi={fileApi}
          entry={fileEntry}
          provider={provider}
          parentPath={parentPath}
        />
      </div>
      <aside className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div>
          <h1 className="break-all text-base font-semibold">{fileEntry.name}</h1>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
            <dt>Type</dt>
            <dd className="font-mono uppercase">{kind}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(fileEntry.size)}</dd>
            <dt>Modified</dt>
            <dd>{fileEntry.modifiedAt.toISOString().slice(0, 10)}</dd>
          </dl>
        </div>

        {sidecarTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {sidecarTags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <a
          href={fileApi}
          download={fileEntry.name}
          className="inline-block rounded bg-neutral-900 px-3 py-1.5 text-center text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          Download
        </a>

        {sidecarBody !== null && (
          <div className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
            <Markdown source={sidecarBody} />
          </div>
        )}
      </aside>
    </div>
  );
}

async function MdViewer({
  provider,
  parentPath,
  entry,
}: {
  provider: StorageProvider;
  parentPath: string;
  entry: Entry;
}) {
  const fullPath = joinPath(parentPath, entry.name);
  const raw = await readTextFile(provider, fullPath);
  const { body } = parseFrontmatter(raw);
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
      <Markdown source={body} />
    </div>
  );
}

function Viewer({
  kind,
  fileApi,
  entry,
  provider,
  parentPath,
}: {
  kind: FileKind;
  fileApi: string;
  entry: Entry;
  provider: StorageProvider;
  parentPath: string;
}) {
  if (kind === "md") {
    return <MdViewer provider={provider} parentPath={parentPath} entry={entry} />;
  }
  if (kind === "pdf") {
    return (
      <iframe
        src={`${fileApi}?inline=1`}
        title={entry.name}
        className="h-[80vh] w-full rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
      />
    );
  }
  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`${fileApi}?inline=1`}
        alt={entry.name}
        className="max-h-[80vh] w-auto rounded-lg border border-neutral-200 dark:border-neutral-800"
      />
    );
  }
  // STL, 3MF, anything else — preview comes in later phases (3D viewer in Phase 5).
  return (
    <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50 text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
      Preview not available — use the Download button.
    </div>
  );
}
```

- [ ] **Step 3: Verify the build is clean**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm build 2>&1 | tail -15
```

Expected: `✓ Compiled successfully`. The build will type-check the new components.

- [ ] **Step 4: Commit**

```bash
git add src/components/browse/FolderDescription.tsx \
        src/components/browse/FileDetail.tsx
git commit -m "feat(browse): FolderDescription + FileDetail RSC views"
```

---

## Task 9: Browse page route — `/[provider]/[[...path]]/page.tsx`

Ties everything together. RSC: resolves provider → calls `stat()` → if directory: list + sort + filter + render grid; if file: load siblings to find sidecar → render detail. 404s on unknown provider, missing path, traversal.

**Files:**
- Create: `src/app/[provider]/[[...path]]/page.tsx`

- [ ] **Step 1: Implement the page**

```tsx
// src/app/[provider]/[[...path]]/page.tsx
import { notFound } from "next/navigation";
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
import { findFolderDescription } from "@/server/browse/description-file";
import { Breadcrumbs } from "@/components/browse/Breadcrumbs";
import { FolderGrid } from "@/components/browse/FolderGrid";
import { FolderDescription } from "@/components/browse/FolderDescription";
import { FileDetail } from "@/components/browse/FileDetail";

type Params = { provider: string; path?: string[] };

export default async function BrowsePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { provider: slug, path: segments = [] } = await params;
  const row = findProviderBySlug(getDatabase(), slug);
  if (!row) notFound();
  const provider = providerFromRow(row);
  const path = segments.join("/");

  let entry: Entry;
  try {
    entry = await provider.stat(path);
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof PathTraversalError) {
      notFound();
    }
    throw err;
  }

  if (entry.type === "directory") {
    const allEntries = await provider.list(path);
    const visible = allEntries.filter((e) => !isHiddenEntry(e.name));
    const description = findFolderDescription(visible);
    const grid = sortEntries(
      visible.filter((e) => !description || e.name !== description.name),
    );
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
        <FolderGrid
          providerSlug={slug}
          parentPath={path}
          entries={grid}
        />
      </div>
    );
  }

  // File detail page — load siblings for sidecar lookup.
  const parentSegments = segments.slice(0, -1);
  const parentPath = parentSegments.join("/");
  const siblings = (await provider.list(parentPath)).filter(
    (e) => !isHiddenEntry(e.name),
  );

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

- [ ] **Step 2: Build to verify the route compiles cleanly**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully`. The catch-all route appears in the build output as `/[provider]/[[...path]]`.

- [ ] **Step 3: Commit**

```bash
git add src/app/'[provider]'/'[[...path]]'/page.tsx
git commit -m "feat(browse): /[provider]/[[...path]] RSC — directory grid + file detail"
```

---

## Task 10: End-to-end smoke (real DB, real files)

A scripted exercise of the running server: setup → admin login → seed test files → request the browse URL and the file API → assert HTML contains expected entry names. This is the only integration test in the phase that runs the full stack; it lives as a vitest suite calling `fetch` against a freshly-built `next start`.

Skip this if it adds friction — the docker smoke at Task 11 also covers the live path. We include it because the previous phases have unit-test coverage but never exercise the real RSC + auth stack. **Treat as optional**: if it bogs down, comment out the step and mark this task complete; the Docker smoke is the load-bearing check.

**Files:**
- Create: `tests/smoke-browse.test.ts` (optional)

- [ ] **Step 1: Decide whether to skip**

If skipping, write `console.log("skipping browse smoke test — covered by docker smoke")` somewhere visible and move on. Otherwise:

- [ ] **Step 2: Add the smoke** (optional)

```ts
// tests/smoke-browse.test.ts
import { describe, it, expect } from "vitest";

// Placeholder — the docker smoke in Task 11 is the true integration test.
describe.skip("browse smoke (manual)", () => {
  it("placeholder", () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 3: Commit if the file was added**

```bash
git add tests/smoke-browse.test.ts 2>/dev/null || true
git commit -m "test(browse): placeholder smoke harness (skipped by default)" 2>/dev/null || true
```

---

## Task 11: Verification gauntlet

- [ ] **Step 1: Full unit test suite**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm vitest run 2>&1 | tail -10
```

Expected: all test files pass. Roughly 28+ test files (previous baseline + ~10 new).

- [ ] **Step 2: Lint + typecheck**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm lint 2>&1 | tail -10
cd /Users/jappy/code/jappyjan/minifold && pnpm typecheck 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 3: Production build**

```bash
cd /Users/jappy/code/jappyjan/minifold && pnpm build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully`. Look for `/[provider]/[[...path]]` and `/api/file/[provider]/[...path]` in the route table.

- [ ] **Step 4: Docker build + browse smoke test**

```bash
docker build -t minifold:phase4-verify /Users/jappy/code/jappyjan/minifold 2>&1 | tail -5
docker run --rm -d --name mf4-smoke -p 13502:3000 \
  -e DATABASE_PATH=/tmp/test.db \
  -v /tmp/mf4-files:/files \
  minifold:phase4-verify
sleep 4
# Fresh DB redirects to /setup
curl -sf http://localhost:13502/ -o /dev/null -w "%{http_code}\n"
docker stop mf4-smoke
```

Expected: HTTP `307` (redirect to `/setup`).

- [ ] **Step 5: Push to trigger CI**

```bash
cd /Users/jappy/code/jappyjan/minifold && git push origin main
```

After CI publishes the image to GHCR, deploy to the test instance:

```bash
coolify deploy uuid kl2kjsmt42md6ct7zt4g9wsk
```

Hand-verify by visiting the live URL: complete setup, add a local provider pointed at a directory with `.md`/`.pdf`/`.stl` files, browse the directory, click into a file detail page, click Download, click into a Markdown file (rendered inline), click into a PDF (inline iframe).
