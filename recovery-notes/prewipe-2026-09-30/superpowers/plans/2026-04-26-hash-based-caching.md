# Phase 6: Hash-Based Directory Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute a stable directory hash server-side and persist directory listings in IndexedDB on the client, so directory grids render instantly from cache and revalidate via a tiny tRPC round-trip when the hash matches.

**Architecture:**
- **Server:** new `dir_cache` SQLite table; pure `computeDirHash(entries)` over all raw children (sorted by name); auth-gated tRPC `browse.list({slug,path,knownHash?})` returning `{changed:false,hash}` or `{changed:true,hash,entries}`. Auth context derived from the existing `minifold_session` cookie.
- **Client:** typed IndexedDB wrapper keyed by `${slug}/${path}`; new `<FolderBrowser>` client component that renders the grid optimistically from IndexedDB → falls back to server-passed `initialEntries` → revalidates via tRPC with `knownHash` and updates the grid + IDB on `changed:true`.
- **Page:** the directory branch of `/[provider]/[[...path]]/page.tsx` keeps SSR for breadcrumbs + folder description, but delegates the grid to `<FolderBrowser>` (passing the initial visible entries and the server-computed hash).

**Tech Stack:** better-sqlite3, tRPC v11, @tanstack/react-query, native IndexedDB (happy-dom in tests), SHA-256 via `node:crypto`.

**Spec reference:** `docs/superpowers/specs/2026-04-23-minifold-design.md` §7 (Hash-Based Directory Caching) and §15 (`dir_cache` schema).

---

## File Structure

**Create:**
- `src/server/db/migrations/004_dir_cache.sql` — table definition.
- `src/server/db/dir-cache.ts` — `getDirCache`, `upsertDirCache` repository functions.
- `src/server/browse/dir-hash.ts` — pure `computeDirHash(entries)` function.
- `src/server/trpc/routers/browse.ts` — `list` query.
- `src/lib/dir-cache-idb.ts` — typed IndexedDB wrapper (`getCachedDir`, `setCachedDir`, `clearCachedDir`, `IDB_DB_NAME`, `IDB_STORE`).
- `src/components/browse/FolderBrowser.tsx` — client component that wires IDB + tRPC + FolderGrid.
- `tests/server/db/dir-cache.test.ts`
- `tests/server/browse/dir-hash.test.ts`
- `tests/server/trpc/browse.test.ts`
- `tests/server/trpc/context.test.ts`
- `tests/lib/dir-cache-idb.test.ts`
- `tests/components/browse/FolderBrowser.test.tsx`

**Modify:**
- `src/server/trpc/trpc.ts` — extend `TRPCContext` with `currentUser`; add `protectedProcedure`.
- `src/app/api/trpc/[trpc]/route.ts` — pass `req` to `createTRPCContext` (so it can read cookies).
- `src/server/trpc/router.ts` — register `browse` router.
- `src/app/[provider]/[[...path]]/page.tsx` — directory branch: replace inline `<FolderGrid>` with `<FolderBrowser>`, compute and pass the hash.
- `tests/server/db/migrations.test.ts` — assert `004_dir_cache` columns.
- `tests/server/trpc/health.test.ts` — update if `createCaller({})` shape changes (it accepts the new context).

---

## Task 1: `dir_cache` migration

**Files:**
- Create: `src/server/db/migrations/004_dir_cache.sql`
- Modify: `tests/server/db/migrations.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/server/db/migrations.test.ts`:

```typescript
  it("applies 004_dir_cache and creates dir_cache table", () => {
    const tmp = mkdtempSync(join(tmpdir(), "minifold-init-"));
    const db = createDatabase(join(tmp, "test.db"));
    cleanup = () => {
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    };

    const dir = resolve(process.cwd(), "src/server/db/migrations");
    runMigrations(db, dir);

    const cols = db.prepare("PRAGMA table_info(dir_cache)").all() as Array<{
      name: string;
    }>;
    expect(cols.map((c) => c.name).sort()).toEqual(
      ["computed_at", "hash", "path"].sort(),
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/server/db/migrations.test.ts`
Expected: FAIL — `dir_cache` has no columns (table missing).

- [ ] **Step 3: Implement the migration**

Create `src/server/db/migrations/004_dir_cache.sql`:

```sql
CREATE TABLE dir_cache (
  path        TEXT PRIMARY KEY,
  hash        TEXT NOT NULL,
  computed_at INTEGER NOT NULL
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/server/db/migrations.test.ts`
Expected: PASS for the new test (and all existing migration tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/db/migrations/004_dir_cache.sql tests/server/db/migrations.test.ts
git commit -m "feat(db): add dir_cache table for hash-based directory caching"
```

---

## Task 2: `dir-cache` repository

**Files:**
- Create: `src/server/db/dir-cache.ts`
- Test: `tests/server/db/dir-cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/db/dir-cache.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { getDirCache, upsertDirCache } from "@/server/db/dir-cache";

let tmp: string;
let db: Database;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-dir-cache-"));
  db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("dir-cache repository", () => {
  it("getDirCache returns null when no row exists", () => {
    expect(getDirCache(db, "nas/prints")).toBeNull();
  });

  it("upsertDirCache inserts a new row and getDirCache returns it", () => {
    upsertDirCache(db, "nas/prints", "abc123", 1700000000000);
    expect(getDirCache(db, "nas/prints")).toEqual({
      path: "nas/prints",
      hash: "abc123",
      computed_at: 1700000000000,
    });
  });

  it("upsertDirCache replaces existing rows for the same path", () => {
    upsertDirCache(db, "nas/prints", "old", 1);
    upsertDirCache(db, "nas/prints", "new", 2);
    expect(getDirCache(db, "nas/prints")).toEqual({
      path: "nas/prints",
      hash: "new",
      computed_at: 2,
    });
  });

  it("paths are independent rows", () => {
    upsertDirCache(db, "nas/a", "h1", 1);
    upsertDirCache(db, "nas/b", "h2", 2);
    expect(getDirCache(db, "nas/a")?.hash).toBe("h1");
    expect(getDirCache(db, "nas/b")?.hash).toBe("h2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/server/db/dir-cache.test.ts`
Expected: FAIL — `dir-cache` module not found.

- [ ] **Step 3: Implement the repository**

Create `src/server/db/dir-cache.ts`:

```typescript
import type { Database } from "better-sqlite3";

export type DirCacheRow = {
  path: string;
  hash: string;
  computed_at: number;
};

export function getDirCache(db: Database, path: string): DirCacheRow | null {
  return (
    (db
      .prepare("SELECT * FROM dir_cache WHERE path = ?")
      .get(path) as DirCacheRow | undefined) ?? null
  );
}

export function upsertDirCache(
  db: Database,
  path: string,
  hash: string,
  computedAt: number,
): void {
  db.prepare(
    `INSERT INTO dir_cache (path, hash, computed_at)
     VALUES (?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, computed_at = excluded.computed_at`,
  ).run(path, hash, computedAt);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/server/db/dir-cache.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/db/dir-cache.ts tests/server/db/dir-cache.test.ts
git commit -m "feat(db): add dir-cache repository (get/upsert)"
```

---

## Task 3: `computeDirHash` pure function

The hash is computed over **all** raw children (including hidden `.minifold_*` files) so any filesystem change invalidates the cache — including changes to access-control sidecars in Phase 7.

**Local FS:** sig = `mtime.getTime()`. **S3:** sig = `etag` if present, else `mtime.getTime()` (matches §7 of the spec).

**Files:**
- Create: `src/server/browse/dir-hash.ts`
- Test: `tests/server/browse/dir-hash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/browse/dir-hash.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { Entry } from "@/server/storage/types";
import { computeDirHash } from "@/server/browse/dir-hash";

const fileEntry = (name: string, size: number, mtimeMs: number, etag?: string): Entry => ({
  name,
  type: "file",
  size,
  modifiedAt: new Date(mtimeMs),
  ...(etag !== undefined ? { etag } : {}),
});

const dirEntry = (name: string): Entry => ({
  name,
  type: "directory",
  size: 0,
  modifiedAt: new Date(0),
});

describe("computeDirHash", () => {
  it("returns a 64-char lowercase hex SHA-256 string", () => {
    const hash = computeDirHash([fileEntry("a.stl", 100, 1)]);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same hash regardless of input order", () => {
    const a = fileEntry("a.stl", 100, 1);
    const b = fileEntry("b.stl", 200, 2);
    expect(computeDirHash([a, b])).toBe(computeDirHash([b, a]));
  });

  it("hashes change when a file's size changes", () => {
    const before = computeDirHash([fileEntry("a.stl", 100, 1)]);
    const after = computeDirHash([fileEntry("a.stl", 101, 1)]);
    expect(before).not.toBe(after);
  });

  it("hashes change when a file's mtime changes (no etag)", () => {
    const before = computeDirHash([fileEntry("a.stl", 100, 1)]);
    const after = computeDirHash([fileEntry("a.stl", 100, 2)]);
    expect(before).not.toBe(after);
  });

  it("uses etag as the signature when present (mtime is ignored)", () => {
    const a = fileEntry("a.stl", 100, 1, "etag-1");
    const b = fileEntry("a.stl", 100, 999, "etag-1");
    expect(computeDirHash([a])).toBe(computeDirHash([b]));
  });

  it("hashes differ when etag changes", () => {
    const a = fileEntry("a.stl", 100, 1, "etag-1");
    const b = fileEntry("a.stl", 100, 1, "etag-2");
    expect(computeDirHash([a])).not.toBe(computeDirHash([b]));
  });

  it("hashes differ when a child is added", () => {
    const before = computeDirHash([fileEntry("a.stl", 100, 1)]);
    const after = computeDirHash([
      fileEntry("a.stl", 100, 1),
      fileEntry("b.stl", 100, 1),
    ]);
    expect(before).not.toBe(after);
  });

  it("includes directories in the hash (type matters)", () => {
    const asFile = computeDirHash([fileEntry("sub", 0, 0)]);
    const asDir = computeDirHash([dirEntry("sub")]);
    expect(asFile).not.toBe(asDir);
  });

  it("returns a stable hash for an empty directory", () => {
    expect(computeDirHash([])).toBe(computeDirHash([]));
    expect(computeDirHash([])).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/server/browse/dir-hash.test.ts`
Expected: FAIL — `dir-hash` module not found.

- [ ] **Step 3: Implement the hash function**

Create `src/server/browse/dir-hash.ts`:

```typescript
import { createHash } from "node:crypto";
import type { Entry } from "@/server/storage/types";

// Stable SHA-256 over directory contents. Each child contributes
// `name|type|size|sig\n` where sig is etag if present, else
// modifiedAt.getTime(). Children are sorted by name first so input order
// never affects the hash. The trailing newline separator prevents
// boundary ambiguity (e.g. ["ab","c"] vs ["a","bc"]).
export function computeDirHash(entries: readonly Entry[]): string {
  const sorted = [...entries].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const hash = createHash("sha256");
  for (const e of sorted) {
    const sig = e.etag ?? String(e.modifiedAt.getTime());
    hash.update(`${e.name}|${e.type}|${e.size}|${sig}\n`);
  }
  return hash.digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/server/browse/dir-hash.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/browse/dir-hash.ts tests/server/browse/dir-hash.test.ts
git commit -m "feat(browse): add stable computeDirHash over Entry[]"
```

---

## Task 4: tRPC context with `currentUser` + `protectedProcedure`

We need authenticated tRPC procedures. The simplest path: extend `TRPCContext` to include a resolved `currentUser` (or `null`), populated by reading the session cookie inside `createTRPCContext(req)`. Add a `protectedProcedure` that throws `UNAUTHORIZED` when `currentUser` is null.

**Files:**
- Modify: `src/server/trpc/trpc.ts`
- Modify: `src/app/api/trpc/[trpc]/route.ts`
- Test: `tests/server/trpc/context.test.ts` (new)
- Modify (smoke only): `tests/server/trpc/health.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/trpc/context.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTRPCContext,
  protectedProcedure,
  router,
} from "@/server/trpc/trpc";
import { __resetDatabase, getDatabase } from "@/server/db";
import { createUser } from "@/server/db/users";
import { createSession } from "@/server/auth/session";
import { SESSION_COOKIE } from "@/server/auth/cookies";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-trpc-ctx-"));
  process.env.DATABASE_PATH = join(tmp, "test.db");
  __resetDatabase();
});

afterEach(() => {
  __resetDatabase();
  delete process.env.DATABASE_PATH;
  rmSync(tmp, { recursive: true, force: true });
});

function makeRequest(cookieHeader?: string): Request {
  const headers = new Headers();
  if (cookieHeader) headers.set("cookie", cookieHeader);
  return new Request("http://localhost/api/trpc/health.check", { headers });
}

describe("createTRPCContext", () => {
  it("returns currentUser=null when no cookie is present", async () => {
    const ctx = await createTRPCContext({ req: makeRequest() });
    expect(ctx.currentUser).toBeNull();
  });

  it("returns currentUser when a valid session cookie is present", async () => {
    const db = getDatabase();
    const user = createUser(db, {
      name: "Alice",
      username: "alice",
      passwordHash: "x",
      role: "user",
      mustChangePassword: false,
    });
    const { token } = createSession(db, user.id);
    const ctx = await createTRPCContext({
      req: makeRequest(`${SESSION_COOKIE}=${token}`),
    });
    expect(ctx.currentUser?.id).toBe(user.id);
  });

  it("returns currentUser=null for an unknown token", async () => {
    const ctx = await createTRPCContext({
      req: makeRequest(`${SESSION_COOKIE}=not-a-real-token`),
    });
    expect(ctx.currentUser).toBeNull();
  });
});

describe("protectedProcedure", () => {
  it("throws UNAUTHORIZED when currentUser is null", async () => {
    const r = router({
      whoami: protectedProcedure.query(({ ctx }) => ctx.currentUser.id),
    });
    const caller = r.createCaller({ currentUser: null });
    await expect(caller.whoami()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("passes through when currentUser is set", async () => {
    const r = router({
      whoami: protectedProcedure.query(({ ctx }) => ctx.currentUser.id),
    });
    const fakeUser = {
      id: "user-1",
      name: "A",
      username: "a",
      password: "x",
      role: "user" as const,
      must_change_password: 0,
      deactivated: 0,
      created_at: 0,
      last_login: null,
    };
    const caller = r.createCaller({ currentUser: fakeUser });
    expect(await caller.whoami()).toBe("user-1");
  });
});
```

Verify the helper `createUser` actually exists with this signature; if it differs, adapt. Check `src/server/db/users.ts` before running.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/server/trpc/context.test.ts`
Expected: FAIL — `createTRPCContext` doesn't accept `{req}`, `protectedProcedure` not exported, ctx has no `currentUser`.

- [ ] **Step 3: Update `trpc.ts`**

Replace the contents of `src/server/trpc/trpc.ts`:

```typescript
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { UserRow } from "@/server/db/users";
import { getDatabase } from "@/server/db";
import { validateSession } from "@/server/auth/session";
import { SESSION_COOKIE } from "@/server/auth/cookies";

export type TRPCContext = {
  currentUser: UserRow | null;
};

export async function createTRPCContext(opts?: {
  req?: Request;
}): Promise<TRPCContext> {
  const cookieHeader = opts?.req?.headers.get("cookie") ?? "";
  const token = parseCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return { currentUser: null };
  const result = validateSession(getDatabase(), token);
  return { currentUser: result?.user ?? null };
}

function parseCookie(header: string, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.currentUser) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, currentUser: ctx.currentUser } });
});
```

- [ ] **Step 4: Update the route handler to forward `req`**

Replace `src/app/api/trpc/[trpc]/route.ts`:

```typescript
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ req }),
  });

export { handler as GET, handler as POST };
```

- [ ] **Step 5: Update the existing `health.test.ts` caller to use the new ctx**

Replace `tests/server/trpc/health.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { appRouter } from "@/server/trpc/router";

describe("health router", () => {
  it("returns status: ok", async () => {
    const caller = appRouter.createCaller({ currentUser: null });
    const result = await caller.health.check();
    expect(result).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- tests/server/trpc`
Expected: PASS for both `context.test.ts` (5 tests) and `health.test.ts` (1 test).

Run: `pnpm typecheck`
Expected: clean — no TS errors anywhere from the ctx shape change.

- [ ] **Step 7: Commit**

```bash
git add src/server/trpc/trpc.ts src/app/api/trpc/[trpc]/route.ts tests/server/trpc/context.test.ts tests/server/trpc/health.test.ts
git commit -m "feat(trpc): add currentUser context + protectedProcedure"
```

---

## Task 5: `browse.list` tRPC procedure

**Contract:**
- Input: `{ providerSlug: string; path: string; knownHash?: string }`
- Output (changed):  `{ changed: true;  hash: string; entries: Entry[] }` — entries are non-hidden, sorted via `sortEntries`.
- Output (unchanged): `{ changed: false; hash: string }`
- Auth: `protectedProcedure`. If provider not found → `NOT_FOUND`.
- Side effect: upsert `dir_cache` (path keyed as `${providerSlug}/${path}`).

**Files:**
- Create: `src/server/trpc/routers/browse.ts`
- Modify: `src/server/trpc/router.ts`
- Test: `tests/server/trpc/browse.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/trpc/browse.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appRouter } from "@/server/trpc/router";
import { __resetDatabase, getDatabase } from "@/server/db";
import { createProvider } from "@/server/db/providers";
import { createUser, type UserRow } from "@/server/db/users";
import { getDirCache } from "@/server/db/dir-cache";

let tmp: string;
let storageRoot: string;
let user: UserRow;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-browse-trpc-"));
  storageRoot = join(tmp, "files");
  mkdirSync(storageRoot, { recursive: true });
  writeFileSync(join(storageRoot, "a.stl"), Buffer.from([0]));
  writeFileSync(join(storageRoot, "b.stl"), Buffer.from([0, 0]));

  process.env.DATABASE_PATH = join(tmp, "test.db");
  __resetDatabase();
  const db = getDatabase();
  user = createUser(db, {
    name: "Alice",
    username: "alice",
    passwordHash: "x",
    role: "user",
    mustChangePassword: false,
  });
  createProvider(db, {
    slug: "nas",
    name: "NAS",
    type: "local",
    config: { rootPath: storageRoot },
  });
});

afterEach(() => {
  __resetDatabase();
  delete process.env.DATABASE_PATH;
  rmSync(tmp, { recursive: true, force: true });
});

describe("browse.list", () => {
  it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller({ currentUser: null });
    await expect(
      caller.browse.list({ providerSlug: "nas", path: "" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns entries + hash on first call (no knownHash)", async () => {
    const caller = appRouter.createCaller({ currentUser: user });
    const result = await caller.browse.list({ providerSlug: "nas", path: "" });
    expect(result.changed).toBe(true);
    if (!result.changed) throw new Error("type narrowing");
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.entries.map((e) => e.name)).toEqual(["a.stl", "b.stl"]);
  });

  it("returns changed:false when knownHash matches", async () => {
    const caller = appRouter.createCaller({ currentUser: user });
    const first = await caller.browse.list({ providerSlug: "nas", path: "" });
    if (!first.changed) throw new Error("expected changed:true");
    const second = await caller.browse.list({
      providerSlug: "nas",
      path: "",
      knownHash: first.hash,
    });
    expect(second).toEqual({ changed: false, hash: first.hash });
  });

  it("returns changed:true when knownHash is stale", async () => {
    const caller = appRouter.createCaller({ currentUser: user });
    const first = await caller.browse.list({ providerSlug: "nas", path: "" });
    if (!first.changed) throw new Error("expected changed:true");
    const result = await caller.browse.list({
      providerSlug: "nas",
      path: "",
      knownHash: "deadbeef".repeat(8),
    });
    expect(result.changed).toBe(true);
    if (!result.changed) throw new Error("type narrowing");
    expect(result.hash).toBe(first.hash);
    expect(result.entries.map((e) => e.name)).toEqual(["a.stl", "b.stl"]);
  });

  it("filters out hidden .minifold_* entries from returned list (but they affect the hash)", async () => {
    writeFileSync(join(storageRoot, ".minifold_access.json"), "{}");
    const caller = appRouter.createCaller({ currentUser: user });
    const result = await caller.browse.list({ providerSlug: "nas", path: "" });
    if (!result.changed) throw new Error("expected changed:true");
    expect(result.entries.map((e) => e.name)).toEqual(["a.stl", "b.stl"]);
  });

  it("returns NOT_FOUND for an unknown provider slug", async () => {
    const caller = appRouter.createCaller({ currentUser: user });
    await expect(
      caller.browse.list({ providerSlug: "missing", path: "" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("upserts dir_cache row for the listed path", async () => {
    const caller = appRouter.createCaller({ currentUser: user });
    const result = await caller.browse.list({ providerSlug: "nas", path: "" });
    if (!result.changed) throw new Error("expected changed:true");
    const row = getDirCache(getDatabase(), "nas/");
    expect(row?.hash).toBe(result.hash);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/server/trpc/browse.test.ts`
Expected: FAIL — `browse` router not registered on `appRouter`.

- [ ] **Step 3: Implement the router**

Create `src/server/trpc/routers/browse.ts`:

```typescript
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import { loadProvider } from "@/server/browse/load-provider";
import { computeDirHash } from "@/server/browse/dir-hash";
import { isHiddenEntry } from "@/server/browse/hidden";
import { sortEntries } from "@/server/browse/sort";
import { upsertDirCache } from "@/server/db/dir-cache";
import { getDatabase } from "@/server/db";
import { NotFoundError, PathTraversalError, type Entry } from "@/server/storage/types";

export const browseRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        providerSlug: z.string().min(1),
        path: z.string(),
        knownHash: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const provider = loadProvider(input.providerSlug);
      if (!provider) throw new TRPCError({ code: "NOT_FOUND" });

      let raw: Entry[];
      try {
        raw = await provider.list(input.path);
      } catch (err) {
        if (err instanceof NotFoundError || err instanceof PathTraversalError) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        throw err;
      }

      const hash = computeDirHash(raw);
      const cacheKey = `${input.providerSlug}/${input.path}`;
      upsertDirCache(getDatabase(), cacheKey, hash, Date.now());

      if (input.knownHash === hash) {
        return { changed: false as const, hash };
      }

      const visible = sortEntries(raw.filter((e) => !isHiddenEntry(e.name)));
      return { changed: true as const, hash, entries: visible };
    }),
});
```

- [ ] **Step 4: Register the router**

Edit `src/server/trpc/router.ts`:

```typescript
import { router } from "./trpc";
import { healthRouter } from "./routers/health";
import { browseRouter } from "./routers/browse";

export const appRouter = router({
  health: healthRouter,
  browse: browseRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- tests/server/trpc/browse.test.ts`
Expected: PASS (7 tests).

Then run full suite to catch regressions:

Run: `pnpm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/server/trpc/routers/browse.ts src/server/trpc/router.ts tests/server/trpc/browse.test.ts
git commit -m "feat(trpc): add browse.list query with knownHash short-circuit"
```

---

## Task 6: IndexedDB client wrapper

A small typed helper. We use the native IDB API (no library), wrapped in promises. Tests run under `happy-dom` which ships an IndexedDB implementation.

**Schema:**
- DB name: `minifold`
- Store: `dir-cache`
- Key: `${slug}/${path}` (string)
- Value: `{ hash: string; entries: Entry[]; cachedAt: number }`

**Files:**
- Create: `src/lib/dir-cache-idb.ts`
- Test: `tests/lib/dir-cache-idb.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/dir-cache-idb.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import {
  clearCachedDir,
  getCachedDir,
  IDB_DB_NAME,
  setCachedDir,
} from "@/lib/dir-cache-idb";
import type { Entry } from "@/server/storage/types";

const fileEntry = (name: string): Entry => ({
  name,
  type: "file",
  size: 1,
  modifiedAt: new Date(0),
});

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
});

describe("dir-cache-idb", () => {
  it("getCachedDir returns null when nothing is stored", async () => {
    expect(await getCachedDir("nas/foo")).toBeNull();
  });

  it("setCachedDir then getCachedDir round-trips the value", async () => {
    const entries = [fileEntry("a.stl")];
    await setCachedDir("nas/foo", { hash: "h1", entries, cachedAt: 42 });
    const got = await getCachedDir("nas/foo");
    expect(got).toEqual({ hash: "h1", entries, cachedAt: 42 });
  });

  it("setCachedDir overwrites the previous value at the same key", async () => {
    await setCachedDir("nas/foo", { hash: "h1", entries: [], cachedAt: 1 });
    await setCachedDir("nas/foo", { hash: "h2", entries: [], cachedAt: 2 });
    expect(await getCachedDir("nas/foo")).toEqual({
      hash: "h2",
      entries: [],
      cachedAt: 2,
    });
  });

  it("clearCachedDir removes a key", async () => {
    await setCachedDir("nas/foo", { hash: "h1", entries: [], cachedAt: 1 });
    await clearCachedDir("nas/foo");
    expect(await getCachedDir("nas/foo")).toBeNull();
  });

  it("keys are independent", async () => {
    await setCachedDir("nas/a", { hash: "h1", entries: [], cachedAt: 1 });
    await setCachedDir("nas/b", { hash: "h2", entries: [], cachedAt: 2 });
    expect((await getCachedDir("nas/a"))?.hash).toBe("h1");
    expect((await getCachedDir("nas/b"))?.hash).toBe("h2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/lib/dir-cache-idb.test.ts`
Expected: FAIL — `@/lib/dir-cache-idb` not found.

If `indexedDB` is undefined under happy-dom, install `fake-indexeddb`:

```bash
pnpm add -D fake-indexeddb
```

…then add to the top of the test file:

```typescript
import "fake-indexeddb/auto";
```

Re-run; if the import is no longer needed, leave it out. (Verify by deleting the import and re-running.)

- [ ] **Step 3: Implement the helper**

Create `src/lib/dir-cache-idb.ts`:

```typescript
import type { Entry } from "@/server/storage/types";

export const IDB_DB_NAME = "minifold";
export const IDB_STORE = "dir-cache";
const IDB_VERSION = 1;

export type CachedDir = {
  hash: string;
  entries: Entry[];
  cachedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, mode);
        const store = tx.objectStore(IDB_STORE);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

export async function getCachedDir(key: string): Promise<CachedDir | null> {
  const value = await withStore("readonly", (s) => s.get(key) as IDBRequest<CachedDir | undefined>);
  return value ? rehydrate(value) : null;
}

export async function setCachedDir(key: string, value: CachedDir): Promise<void> {
  await withStore("readwrite", (s) => s.put(value, key));
}

export async function clearCachedDir(key: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(key));
}

// IndexedDB serializes Date objects to strings on some platforms — coerce
// modifiedAt back to Date to keep the Entry shape contract.
function rehydrate(v: CachedDir): CachedDir {
  return {
    hash: v.hash,
    cachedAt: v.cachedAt,
    entries: v.entries.map((e) => ({
      ...e,
      modifiedAt: e.modifiedAt instanceof Date ? e.modifiedAt : new Date(e.modifiedAt),
    })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/lib/dir-cache-idb.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dir-cache-idb.ts tests/lib/dir-cache-idb.test.ts
git commit -m "feat(client): IndexedDB wrapper for directory listings"
```

If you added `fake-indexeddb`, include `package.json` and the lockfile in the same commit.

---

## Task 7: `<FolderBrowser>` client component

This component owns the directory grid display. It does not render the description (still SSR'd by the page).

**Behaviour on mount:**
1. Read IDB at `${slug}/${path}` → if a value exists, immediately swap displayed entries to the cached list (overrides `initialEntries` for instant paint on revisit).
2. Fire `trpc.browse.list.useQuery({ providerSlug, path, knownHash })` where `knownHash = cachedHash ?? initialHash`.
3. On `changed: true` → set displayed entries to the response, write `{hash, entries, cachedAt: Date.now()}` to IDB.
4. On `changed: false` → if we displayed `initialEntries` (no cache), still write `{initialHash, initialEntries, cachedAt: Date.now()}` to IDB so the next navigation hits the cache.

**Rendering:** the component renders `<FolderGrid providerSlug parentPath entries />`.

**Scope note:** the component receives the **visible** (non-hidden, sorted) entries — NOT pre-filtered for description/sidecar — together with `descriptionName` and `sidecarNames` props. Final grid filter is derived via `useMemo` so a `showAll` toggle (which only changes `sidecarNames` on the page) re-filters the existing rawEntries without an IDB round-trip or refetch. The IDB cache stores the same shape: visible (non-hidden, sorted) entries, no description/sidecar filtering applied.

**Files:**
- Create: `src/components/browse/FolderBrowser.tsx`
- Test: `tests/components/browse/FolderBrowser.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/browse/FolderBrowser.test.tsx`. The test stubs `@/trpc/client` so we don't need to spin up a real tRPC client/link — we drive the data directly via a mutable `mockQueryState`.

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  getCachedDir,
  IDB_DB_NAME,
  setCachedDir,
} from "@/lib/dir-cache-idb";
import type { Entry } from "@/server/storage/types";

type QueryState = {
  data: unknown | undefined;
  error: Error | null;
};

const mockQueryState: QueryState = { data: undefined, error: null };
const lastInputRef: { input: unknown } = { input: undefined };

vi.mock("@/trpc/client", () => ({
  trpc: {
    browse: {
      list: {
        useQuery: (input: unknown) => {
          lastInputRef.input = input;
          return mockQueryState;
        },
      },
    },
  },
}));

// Vitest hoists vi.mock() calls above the imports, so this picks up the stub.
import { FolderBrowser } from "@/components/browse/FolderBrowser";

function file(name: string): Entry {
  return { name, type: "file", size: 1, modifiedAt: new Date(0) };
}

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
  mockQueryState.data = undefined;
  mockQueryState.error = null;
  lastInputRef.input = undefined;
});

describe("FolderBrowser", () => {
  it("renders initialEntries immediately when no cache exists and no data yet", () => {
    render(
      <FolderBrowser
        providerSlug="nas"
        path=""
        parentPath=""
        initialHash="h1"
        initialEntries={[file("a.stl")]}
        descriptionName={null}
        sidecarNames={[]}
      />,
    );
    expect(screen.getByText("a.stl")).toBeInTheDocument();
  });

  it("renders cached entries from IDB when present (overrides initialEntries)", async () => {
    await setCachedDir("nas/", {
      hash: "cached",
      entries: [file("from-cache.stl")],
      cachedAt: 1,
    });
    render(
      <FolderBrowser
        providerSlug="nas"
        path=""
        parentPath=""
        initialHash="initial"
        initialEntries={[file("from-initial.stl")]}
        descriptionName={null}
        sidecarNames={[]}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("from-cache.stl")).toBeInTheDocument(),
    );
  });

  it("updates entries and writes IDB when tRPC returns changed:true", async () => {
    mockQueryState.data = {
      changed: true,
      hash: "h2",
      entries: [file("fresh.stl")],
    };
    render(
      <FolderBrowser
        providerSlug="nas"
        path=""
        parentPath=""
        initialHash="h1"
        initialEntries={[file("stale.stl")]}
        descriptionName={null}
        sidecarNames={[]}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("fresh.stl")).toBeInTheDocument(),
    );
    expect(screen.queryByText("stale.stl")).not.toBeInTheDocument();
    await waitFor(async () => {
      const cached = await getCachedDir("nas/");
      expect(cached?.hash).toBe("h2");
      expect(cached?.entries.map((e) => e.name)).toEqual(["fresh.stl"]);
    });
  });

  it("seeds IDB from initialEntries when tRPC returns changed:false and there was no cache", async () => {
    mockQueryState.data = { changed: false, hash: "h-init" };
    render(
      <FolderBrowser
        providerSlug="nas"
        path=""
        parentPath=""
        initialHash="h-init"
        initialEntries={[file("a.stl"), file("b.stl")]}
        descriptionName={null}
        sidecarNames={[]}
      />,
    );
    await waitFor(async () => {
      const cached = await getCachedDir("nas/");
      expect(cached?.hash).toBe("h-init");
      expect(cached?.entries.map((e) => e.name)).toEqual(["a.stl", "b.stl"]);
    });
  });

  it("filters out description and sidecar entries from the grid", async () => {
    mockQueryState.data = {
      changed: true,
      hash: "h2",
      entries: [
        file("readme.md"), // description
        file("anchor.stl"),
        file("anchor.md"), // sidecar
      ],
    };
    render(
      <FolderBrowser
        providerSlug="nas"
        path=""
        parentPath=""
        initialHash="h1"
        initialEntries={[file("anchor.stl")]}
        descriptionName="readme.md"
        sidecarNames={["anchor.md"]}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("anchor.stl")).toBeInTheDocument(),
    );
    expect(screen.queryByText("readme.md")).not.toBeInTheDocument();
    expect(screen.queryByText("anchor.md")).not.toBeInTheDocument();
  });

  it("passes knownHash to the tRPC query (initialHash on first render)", () => {
    render(
      <FolderBrowser
        providerSlug="nas"
        path="prints"
        parentPath="prints"
        initialHash="known-hash"
        initialEntries={[]}
        descriptionName={null}
        sidecarNames={[]}
      />,
    );
    expect(lastInputRef.input).toMatchObject({
      providerSlug: "nas",
      path: "prints",
      knownHash: "known-hash",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/components/browse/FolderBrowser.test.tsx`
Expected: FAIL — `FolderBrowser` not found.

- [ ] **Step 3: Implement the component**

Create `src/components/browse/FolderBrowser.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/trpc/client";
import { sortEntries } from "@/server/browse/sort";
import { clearCachedDir, getCachedDir, setCachedDir } from "@/lib/dir-cache-idb";
import type { Entry } from "@/server/storage/types";
import { FolderGrid } from "./FolderGrid";

type Props = {
  providerSlug: string;
  path: string;
  parentPath: string;
  initialEntries: readonly Entry[]; // visible (non-hidden), sorted; NOT yet filtered for description/sidecar
  initialHash: string;
  descriptionName: string | null;
  sidecarNames: readonly string[]; // already showAll-resolved by the page
};

function cacheKey(slug: string, path: string): string {
  return `${slug}/${path}`;
}

function applyGridFilter(
  entries: readonly Entry[],
  descriptionName: string | null,
  sidecarSet: ReadonlySet<string>,
): Entry[] {
  return sortEntries(
    entries.filter((e) => {
      if (descriptionName && e.name === descriptionName) return false;
      if (sidecarSet.has(e.name)) return false;
      return true;
    }),
  );
}

export function FolderBrowser({
  providerSlug,
  path,
  parentPath,
  initialEntries,
  initialHash,
  descriptionName,
  sidecarNames,
}: Props) {
  const [rawEntries, setRawEntries] = useState<readonly Entry[]>(initialEntries);
  const [knownHash, setKnownHash] = useState<string>(initialHash);
  const seededFromCache = useRef(false);

  // Hydrate from IndexedDB on mount (and whenever the URL changes).
  useEffect(() => {
    let cancelled = false;
    seededFromCache.current = false;
    getCachedDir(cacheKey(providerSlug, path))
      .then((cached) => {
        if (cancelled || !cached) return;
        seededFromCache.current = true;
        setKnownHash(cached.hash);
        setRawEntries(cached.entries);
      })
      .catch(() => {
        // Best-effort: a broken IDB just means we keep showing initialEntries.
      });
    return () => {
      cancelled = true;
    };
  }, [providerSlug, path]);

  const query = trpc.browse.list.useQuery({
    providerSlug,
    path,
    knownHash,
  });

  // Apply the tRPC response.
  useEffect(() => {
    const data = query.data;
    if (!data) return;
    if (data.changed) {
      setKnownHash(data.hash);
      setRawEntries(data.entries);
      void setCachedDir(cacheKey(providerSlug, path), {
        hash: data.hash,
        entries: [...data.entries],
        cachedAt: Date.now(),
      });
    } else if (!seededFromCache.current) {
      // Server confirmed our initial render is fresh — seed IDB so the
      // next navigation hits the cache.
      void setCachedDir(cacheKey(providerSlug, path), {
        hash: data.hash,
        entries: [...initialEntries],
        cachedAt: Date.now(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  // If the tRPC query throws, drop a stale cache so we don't keep showing
  // a phantom listing for a deleted/forbidden directory.
  useEffect(() => {
    if (query.error) {
      void clearCachedDir(cacheKey(providerSlug, path));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.error]);

  const sidecarKey = sidecarNames.join("|");
  const displayed = useMemo(
    () => applyGridFilter(rawEntries, descriptionName, new Set(sidecarNames)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawEntries, descriptionName, sidecarKey],
  );

  return (
    <FolderGrid
      providerSlug={providerSlug}
      parentPath={parentPath}
      entries={displayed}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/components/browse/FolderBrowser.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/FolderBrowser.tsx tests/components/browse/FolderBrowser.test.tsx
git commit -m "feat(browse): FolderBrowser client component with IDB cache + revalidation"
```

---

## Task 8: Wire `FolderBrowser` into the directory page

Replace the inline `<FolderGrid>` in the directory branch with `<FolderBrowser>`. Compute the hash from the **raw** (unfiltered) entries the page already lists.

**Files:**
- Modify: `src/app/[provider]/[[...path]]/page.tsx`

- [ ] **Step 1: Read the current page**

Read `src/app/[provider]/[[...path]]/page.tsx` and locate the directory branch (the block that begins `if (entry.type === "directory")`).

- [ ] **Step 2: Apply the change**

Replace the directory branch (lines that build `allEntries`, `visible`, `description`, `sidecars`, `grid`, and render `<FolderGrid>`):

```tsx
  if (entry.type === "directory") {
    const allEntries = await provider.list(path);
    const hash = computeDirHash(allEntries);
    const visible = sortEntries(allEntries.filter((e) => !isHiddenEntry(e.name)));
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
        />
      </div>
    );
  }
```

Add the imports at the top of the file:

```typescript
import { computeDirHash } from "@/server/browse/dir-hash";
import { FolderBrowser } from "@/components/browse/FolderBrowser";
```

Remove the now-unused `FolderGrid` import.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Run all tests**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/app/[provider]/[[...path]]/page.tsx
git commit -m "feat(browse): use FolderBrowser for directory grid (IDB + tRPC revalidation)"
```

---

## Task 9: Smoke verification

- [ ] **Step 1: Build**

Run: `pnpm build`
Expected: clean build, no errors.

- [ ] **Step 2: Manual smoke (optional, requires a configured provider in `data/minifold.db`)**

Run: `pnpm dev`

In the browser:
1. Navigate to a known provider directory (e.g. `/nas/prints`). Confirm the grid renders.
2. Open DevTools → Application → IndexedDB → `minifold` → `dir-cache`. Confirm a row is present for `nas/prints` with a hash and entries.
3. Navigate away and back. Confirm the grid still renders (no flash of empty state).
4. Open DevTools → Network and watch the `browse.list` call: when nothing on disk has changed, the response body should be `{changed:false, hash:...}` (small payload).
5. Add a file on disk and reload — within one tRPC round-trip the new file should appear.

- [ ] **Step 3: Final commit**

If anything was tweaked during smoke, commit it. Otherwise the previous commit closes the phase.

---

## Out of scope (intentionally deferred)

- **Service worker / PWA offline reads** — Phase 9. Task 6's IDB store is the substrate for that work but the SW that uses it lives later.
- **Background polling / focus refetch** — react-query's defaults are fine; we don't need extra cadence.
- **Hash-based ETag on `/api/file`** — file streams aren't part of `dir_cache`.
- **Access-control–aware filtering** — Phase 7. The hash already includes `.minifold_access.json` so cache invalidation is correct when access rules change.
- **Eviction / size cap on IDB** — directories are tiny JSON; eviction can wait until it's actually a problem.
