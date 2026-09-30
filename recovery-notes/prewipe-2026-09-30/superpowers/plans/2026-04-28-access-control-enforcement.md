# Phase 7: Access Control (Enforcement) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce per-path access permissions sourced from `.minifold_access.yaml` dot-files at every server-side surface (browse listing, RSC page, `/api/file`, `/api/thumb`), with a per-request memoizing resolver and configurable provider/global defaults.

**Architecture:** A single `Resolver` abstraction is built once per request from `(currentUser, providerSlug)` via `buildResolverForRequest()`. The resolver walks up parent directories looking for `.minifold_access.yaml` files, parses them through a pure parser, applies the resolution chain (overrides → default → provider default → global default), and returns one of three decisions: `allow` / `deny-anonymous` / `deny-authed`. Each surface translates the decision into its native response (filter / redirect / 404). YAML reads are memoized per resolver instance.

**Tech Stack:** TypeScript, Next.js 16 App Router, tRPC v11, better-sqlite3, Vitest, `yaml` (new dep).

**Spec:** `docs/superpowers/specs/2026-04-28-access-control-design.md`

---

## File Structure

**New files:**
- `src/server/access/types.ts` — `Level`, `SimpleLevel`, `Decision`, `ParsedAccess` types
- `src/server/access/format.ts` — `parseAccessFile(text)` pure parser
- `src/server/access/read-access-file.ts` — `readAccessFile(storage, dirPath)` storage-bound reader
- `src/server/access/global-default.ts` — `getGlobalDefaultAccess(db)` settings reader
- `src/server/access/resolver.ts` — `createAccessResolver(opts)` factory
- `src/server/access/build-resolver.ts` — `buildResolverForRequest({user, providerSlug})` request-scoped factory
- `src/server/db/migrations/005_seed_global_access.sql` — seed `global_default_access`

**Modified files:**
- `src/server/db/providers.ts` — extend `LocalConfig` and `S3Config` with optional `defaultAccess`
- `src/server/trpc/routers/browse.ts` — `protectedProcedure` → `publicProcedure` + resolver-based filtering
- `src/app/[provider]/layout.tsx` — drop the blanket auth redirect (page handles it via resolver)
- `src/app/[provider]/[[...path]]/page.tsx` — call resolver; `redirect('/login?callbackUrl=...')` or `notFound()` on denial
- `src/app/api/file/[provider]/[...path]/route.ts` — replace `if (!user) → 401` with resolver; any non-`allow` → 404
- `src/app/api/thumb/[provider]/[...path]/route.ts` — same as `/api/file`
- `package.json` — add `yaml` dependency

**New test files:**
- `tests/server/access/format.test.ts`
- `tests/server/access/read-access-file.test.ts`
- `tests/server/access/global-default.test.ts`
- `tests/server/access/resolver.test.ts`
- `tests/server/access/build-resolver.test.ts`

**Modified test files:**
- `tests/server/db/migrations.test.ts` — add 005 assertion
- `tests/server/db/providers.test.ts` — add a roundtrip test for `defaultAccess`
- `tests/server/trpc/browse.test.ts` — rewrite the auth assertion + add access scenarios
- `tests/app/api/file/route.test.ts` — replace 401 expectation with 404 + add access scenarios
- `tests/app/api/thumb/thumb.test.ts` — same kind of change

---

## Conventions & Reminders

- Codebase uses `noUncheckedIndexedAccess: true` — indexed access (e.g., `arr[i]`, `obj[k]`) is typed `T | undefined`. Always guard.
- Path joining: paths within a provider use `/` separators, no leading or trailing slash; the empty string `""` is the provider root.
- Login redirect uses `?callbackUrl=...` (existing convention — see `src/app/login/actions.ts`).
- Username comparisons must be case-insensitive — usernames are stored lowercased and the YAML list is lowercased on parse.
- Commits: small, conventional-commit style (`feat(access): …`, `test(access): …`, `chore(deps): …`).
- After every code-touching task, run `npm test -- <changed-test-files>` and ensure pass before committing. Run `npm run typecheck` before final task.

---

## Task 1: Add `yaml` dependency

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the dependency**

```bash
npm install yaml
```

Expected: `yaml` appears in `package.json` `dependencies` and `package-lock.json` is updated.

- [ ] **Step 2: Verify the install**

```bash
node -e "console.log(require('yaml').parse('foo: 1').foo)"
```

Expected output: `1`

- [ ] **Step 3: Verify typecheck still passes**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add yaml for access-control file parsing"
```

---

## Task 2: Migration 005 — seed `global_default_access`

**Files:**
- Create: `src/server/db/migrations/005_seed_global_access.sql`
- Test: `tests/server/db/migrations.test.ts` (modify)

- [ ] **Step 1: Write the failing test**

Append this `it(...)` block at the end of `describe("bundled migrations", ...)` in `tests/server/db/migrations.test.ts`:

```ts
  it("applies 005_seed_global_access and seeds global_default_access='signed-in'", () => {
    const tmp = mkdtempSync(join(tmpdir(), "minifold-init-"));
    const db = createDatabase(join(tmp, "test.db"));
    cleanup = () => {
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    };

    const dir = resolve(process.cwd(), "src/server/db/migrations");
    runMigrations(db, dir);

    const row = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("global_default_access") as { value: string } | undefined;
    expect(row?.value).toBe("signed-in");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/server/db/migrations.test.ts
```

Expected: the new test fails (no such row).

- [ ] **Step 3: Create the migration**

Write `src/server/db/migrations/005_seed_global_access.sql`:

```sql
INSERT OR IGNORE INTO settings (key, value)
VALUES ('global_default_access', 'signed-in');
```

- [ ] **Step 4: Run the test — expect pass**

```bash
npm test -- tests/server/db/migrations.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/migrations/005_seed_global_access.sql tests/server/db/migrations.test.ts
git commit -m "feat(access): seed global_default_access='signed-in' (migration 005)"
```

---

## Task 3: Extend provider config types with `defaultAccess`

**Files:**
- Modify: `src/server/db/providers.ts`
- Test: `tests/server/db/providers.test.ts` (modify)

- [ ] **Step 1: Write the failing test**

Append this `it(...)` block to `tests/server/db/providers.test.ts` (inside the appropriate describe block — match the file's existing style):

```ts
  it("roundtrips a local provider with defaultAccess", () => {
    const created = createProvider(db, {
      slug: "nas",
      name: "NAS",
      type: "local",
      config: { rootPath: "/srv/files", defaultAccess: "public" },
    });
    expect(created.config).toEqual({
      rootPath: "/srv/files",
      defaultAccess: "public",
    });
    const found = findProviderBySlug(db, "nas");
    expect(found?.config).toEqual({
      rootPath: "/srv/files",
      defaultAccess: "public",
    });
  });
```

If the test file does not already import `findProviderBySlug` or `createProvider`, add them to the existing import at the top.

- [ ] **Step 2: Run the test — expect TS error or runtime mismatch**

```bash
npm test -- tests/server/db/providers.test.ts
```

Expected: TypeScript flags `defaultAccess` as not on `LocalConfig`.

- [ ] **Step 3: Update `LocalConfig` and `S3Config` in `src/server/db/providers.ts`**

Replace the existing `LocalConfig` and `S3Config` type declarations (lines 7-18) with:

```ts
export type LocalConfig = {
  rootPath: string;
  defaultAccess?: "public" | "signed-in";
};

export type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  pathStyle: boolean;
  defaultAccess?: "public" | "signed-in";
};
```

No DB migration required — `providers.config` is freeform encrypted JSON that is decrypted into the typed shape.

- [ ] **Step 4: Run the test — expect pass**

```bash
npm test -- tests/server/db/providers.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/providers.ts tests/server/db/providers.test.ts
git commit -m "feat(access): optional defaultAccess on LocalConfig and S3Config"
```

---

## Task 4: Access types module

**Files:**
- Create: `src/server/access/types.ts`

- [ ] **Step 1: Create the types module**

```ts
// src/server/access/types.ts
//
// Access-control type vocabulary shared across the access subsystem.

/** Levels that can appear in `.minifold_access.yaml` and provider/global defaults. */
export type SimpleLevel = "public" | "signed-in";

/** Full level shape including user-list — only present in YAML files, not in DB defaults. */
export type Level = SimpleLevel | string[]; // string[] = lowercased usernames (user-list)

/** Outcome of an access check for a specific (user, path). */
export type Decision = "allow" | "deny-anonymous" | "deny-authed";

/** Result of parsing a `.minifold_access.yaml` file. */
export type ParsedAccess = {
  default?: Level;
  overrides: Record<string, Level>;
  warnings: string[];
};

/** Type guard: is the level a user-list? */
export function isUserList(level: Level): level is string[] {
  return Array.isArray(level);
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/access/types.ts
git commit -m "feat(access): add Level/Decision/ParsedAccess types"
```

---

## Task 5: `parseAccessFile` pure parser (TDD)

**Files:**
- Create: `src/server/access/format.ts`
- Test: `tests/server/access/format.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/server/access/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseAccessFile } from "@/server/access/format";

describe("parseAccessFile", () => {
  it("parses default + string overrides", () => {
    const out = parseAccessFile(
      [
        "default: signed-in",
        "overrides:",
        "  preview.stl: public",
        "  secret.stl: signed-in",
      ].join("\n"),
    );
    expect(out.default).toBe("signed-in");
    expect(out.overrides).toEqual({
      "preview.stl": "public",
      "secret.stl": "signed-in",
    });
    expect(out.warnings).toEqual([]);
  });

  it("parses a list value as a user-list, lowercased", () => {
    const out = parseAccessFile(
      ["overrides:", "  patrons.stl: [Alice, Bob]"].join("\n"),
    );
    expect(out.overrides["patrons.stl"]).toEqual(["alice", "bob"]);
    expect(out.warnings).toEqual([]);
  });

  it("accepts a default user-list", () => {
    const out = parseAccessFile("default: [alice]");
    expect(out.default).toEqual(["alice"]);
  });

  it("treats malformed YAML as empty + warning", () => {
    const out = parseAccessFile(":\n bad: [unclosed");
    expect(out.default).toBeUndefined();
    expect(out.overrides).toEqual({});
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("treats non-object root as empty + warning", () => {
    const out = parseAccessFile("- just\n- a\n- list");
    expect(out.default).toBeUndefined();
    expect(out.overrides).toEqual({});
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("drops invalid level value with a warning", () => {
    const out = parseAccessFile("default: secret");
    expect(out.default).toBeUndefined();
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("drops invalid override value with a warning, keeps the others", () => {
    const out = parseAccessFile(
      [
        "overrides:",
        "  good.stl: public",
        "  bad.stl: secret",
        "  also-good.stl: [alice]",
      ].join("\n"),
    );
    expect(out.overrides).toEqual({
      "good.stl": "public",
      "also-good.stl": ["alice"],
    });
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("drops list entries that are not strings, with a warning", () => {
    const out = parseAccessFile("default: [alice, 123, bob]");
    expect(out.default).toEqual(["alice", "bob"]);
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("accepts a file with comments only / no usable keys", () => {
    const out = parseAccessFile("# nothing here\n");
    expect(out.default).toBeUndefined();
    expect(out.overrides).toEqual({});
    expect(out.warnings).toEqual([]);
  });

  it("ignores unknown top-level keys with a warning", () => {
    const out = parseAccessFile(
      ["default: public", "extra: ignored"].join("\n"),
    );
    expect(out.default).toBe("public");
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("accepts empty overrides map", () => {
    const out = parseAccessFile("default: public\noverrides: {}");
    expect(out.default).toBe("public");
    expect(out.overrides).toEqual({});
  });

  it("rejects an empty user-list with a warning (still treated as user-list)", () => {
    // Spec: empty list = nobody allowed (admin still bypasses via resolver).
    // Parser treats `[]` as a valid user-list of zero usernames; the resolver
    // applies it. No warning here.
    const out = parseAccessFile("default: []");
    expect(out.default).toEqual([]);
    expect(out.warnings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/server/access/format.test.ts
```

Expected: import error — `format.ts` does not exist.

- [ ] **Step 3: Implement `parseAccessFile`**

Create `src/server/access/format.ts`:

```ts
import { parse as parseYaml, YAMLParseError } from "yaml";
import type { Level, ParsedAccess } from "./types";

const SIMPLE_LEVELS = new Set(["public", "signed-in"]);

function coerceLevel(
  value: unknown,
  pushWarning: (msg: string) => void,
  context: string,
): Level | undefined {
  if (typeof value === "string") {
    if (SIMPLE_LEVELS.has(value)) return value as Level;
    pushWarning(`${context}: invalid level "${value}"`);
    return undefined;
  }
  if (Array.isArray(value)) {
    const usernames: string[] = [];
    for (const item of value) {
      if (typeof item === "string") {
        usernames.push(item.toLowerCase());
      } else {
        pushWarning(`${context}: list contains non-string entry`);
      }
    }
    return usernames;
  }
  pushWarning(`${context}: expected string or list`);
  return undefined;
}

export function parseAccessFile(text: string): ParsedAccess {
  const warnings: string[] = [];
  const result: ParsedAccess = { overrides: {}, warnings };

  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    warnings.push(
      `failed to parse YAML: ${err instanceof YAMLParseError ? err.message : String(err)}`,
    );
    return result;
  }

  if (raw === null || raw === undefined) return result;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push("root must be a mapping (key: value)");
    return result;
  }

  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key === "default") continue;
    if (key === "overrides") continue;
    warnings.push(`unknown top-level key "${key}"`);
  }

  if ("default" in obj) {
    const lvl = coerceLevel(obj.default, (m) => warnings.push(m), "default");
    if (lvl !== undefined) result.default = lvl;
  }

  if ("overrides" in obj) {
    const ov = obj.overrides;
    if (ov === null || ov === undefined) {
      // treat as empty
    } else if (typeof ov !== "object" || Array.isArray(ov)) {
      warnings.push("overrides must be a mapping");
    } else {
      for (const [name, value] of Object.entries(ov as Record<string, unknown>)) {
        const lvl = coerceLevel(value, (m) => warnings.push(m), `overrides.${name}`);
        if (lvl !== undefined) result.overrides[name] = lvl;
      }
    }
  }

  return result;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- tests/server/access/format.test.ts
```

Expected: all 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/access/format.ts tests/server/access/format.test.ts
git commit -m "feat(access): parseAccessFile YAML parser with warning-on-invalid semantics"
```

---

## Task 6: `readAccessFile` storage-bound reader (TDD)

**Files:**
- Create: `src/server/access/read-access-file.ts`
- Test: `tests/server/access/read-access-file.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/access/read-access-file.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStorageProvider } from "@/server/storage/local";
import { readAccessFile } from "@/server/access/read-access-file";

let tmp: string;
let provider: LocalStorageProvider;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-access-read-"));
  provider = new LocalStorageProvider({ slug: "nas", rootPath: tmp });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("readAccessFile", () => {
  it("returns null when the access file does not exist", async () => {
    const result = await readAccessFile(provider, "");
    expect(result).toBeNull();
  });

  it("reads + parses the access file at the provider root", async () => {
    writeFileSync(
      join(tmp, ".minifold_access.yaml"),
      "default: public\n",
    );
    const result = await readAccessFile(provider, "");
    expect(result?.default).toBe("public");
  });

  it("reads + parses the access file in a subdirectory", async () => {
    mkdirSync(join(tmp, "sub"));
    writeFileSync(
      join(tmp, "sub", ".minifold_access.yaml"),
      "default: signed-in\noverrides:\n  x.stl: public\n",
    );
    const result = await readAccessFile(provider, "sub");
    expect(result?.default).toBe("signed-in");
    expect(result?.overrides).toEqual({ "x.stl": "public" });
  });

  it("returns a parsed result with warnings for malformed YAML (does not throw)", async () => {
    writeFileSync(
      join(tmp, ".minifold_access.yaml"),
      "::not-yaml::\n",
    );
    const result = await readAccessFile(provider, "");
    expect(result).not.toBeNull();
    expect(result?.warnings.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test — expect import failure**

```bash
npm test -- tests/server/access/read-access-file.test.ts
```

Expected: import error.

- [ ] **Step 3: Implement `readAccessFile`**

Create `src/server/access/read-access-file.ts`:

```ts
import type { StorageProvider } from "@/server/storage/types";
import { parseAccessFile } from "./format";
import type { ParsedAccess } from "./types";

const ACCESS_FILE_NAME = ".minifold_access.yaml";

export function accessFilePath(dirPath: string): string {
  return dirPath === "" ? ACCESS_FILE_NAME : `${dirPath}/${ACCESS_FILE_NAME}`;
}

/**
 * Reads and parses `<dirPath>/.minifold_access.yaml` via the storage provider.
 * Returns `null` if the file does not exist (or could not be read at all).
 * Returns a `ParsedAccess` (possibly with warnings) otherwise.
 *
 * Logs malformed-file warnings to `console.warn` so operators see them in
 * server logs without locking out the subtree.
 */
export async function readAccessFile(
  storage: StorageProvider,
  dirPath: string,
): Promise<ParsedAccess | null> {
  const path = accessFilePath(dirPath);
  let exists: boolean;
  try {
    exists = await storage.exists(path);
  } catch {
    return null;
  }
  if (!exists) return null;

  let text: string;
  try {
    const stream = await storage.read(path);
    text = await readStreamToString(stream);
  } catch {
    return null;
  }

  const parsed = parseAccessFile(text);
  if (parsed.warnings.length > 0) {
    for (const w of parsed.warnings) {
      console.warn(`[access] ${storage.slug}/${path}: ${w}`);
    }
  }
  return parsed;
}

async function readStreamToString(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return new TextDecoder("utf-8").decode(buf);
}
```

- [ ] **Step 4: Run the test — expect pass**

```bash
npm test -- tests/server/access/read-access-file.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/access/read-access-file.ts tests/server/access/read-access-file.test.ts
git commit -m "feat(access): readAccessFile — storage-bound access-file loader"
```

---

## Task 7: `getGlobalDefaultAccess` settings reader (TDD)

**Files:**
- Create: `src/server/access/global-default.ts`
- Test: `tests/server/access/global-default.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/access/global-default.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { setSetting } from "@/server/db/settings";
import { getGlobalDefaultAccess } from "@/server/access/global-default";

let tmp: string;
let db: Database;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-global-default-"));
  db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("getGlobalDefaultAccess", () => {
  it("reads the seeded default ('signed-in') after fresh migrations", () => {
    expect(getGlobalDefaultAccess(db)).toBe("signed-in");
  });

  it("reads 'public' when configured", () => {
    setSetting(db, "global_default_access", "public");
    expect(getGlobalDefaultAccess(db)).toBe("public");
  });

  it("falls back to 'signed-in' when the row is missing", () => {
    db.prepare("DELETE FROM settings WHERE key = 'global_default_access'").run();
    expect(getGlobalDefaultAccess(db)).toBe("signed-in");
  });

  it("falls back to 'signed-in' when the value is invalid", () => {
    setSetting(db, "global_default_access", "garbage");
    expect(getGlobalDefaultAccess(db)).toBe("signed-in");
  });
});
```

- [ ] **Step 2: Run the test — expect import error**

```bash
npm test -- tests/server/access/global-default.test.ts
```

- [ ] **Step 3: Implement `getGlobalDefaultAccess`**

Create `src/server/access/global-default.ts`:

```ts
import type { Database } from "better-sqlite3";
import { getSetting } from "@/server/db/settings";
import type { SimpleLevel } from "./types";

const KEY = "global_default_access";

export function getGlobalDefaultAccess(db: Database): SimpleLevel {
  const raw = getSetting(db, KEY);
  if (raw === "public" || raw === "signed-in") return raw;
  return "signed-in";
}
```

- [ ] **Step 4: Run the test — expect pass**

```bash
npm test -- tests/server/access/global-default.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/server/access/global-default.ts tests/server/access/global-default.test.ts
git commit -m "feat(access): getGlobalDefaultAccess settings reader with fallback"
```

---

## Task 8: `createAccessResolver` core resolver (TDD)

**Files:**
- Create: `src/server/access/resolver.ts`
- Test: `tests/server/access/resolver.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/access/resolver.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStorageProvider } from "@/server/storage/local";
import { createAccessResolver } from "@/server/access/resolver";
import type { UserRow } from "@/server/db/users";

let tmp: string;
let storage: LocalStorageProvider;

const userAlice: UserRow = {
  id: "u-a",
  name: "Alice",
  username: "alice",
  password: "x",
  role: "user",
  must_change_password: 0,
  deactivated: 0,
  created_at: 0,
  last_login: null,
};

const userBob: UserRow = { ...userAlice, id: "u-b", username: "bob" };

const admin: UserRow = { ...userAlice, id: "u-ad", username: "ad", role: "admin" };

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-resolver-"));
  storage = new LocalStorageProvider({ slug: "nas", rootPath: tmp });
  mkdirSync(join(tmp, "a"));
  mkdirSync(join(tmp, "a", "b"));
  writeFileSync(join(tmp, "a", "b", "c.stl"), Buffer.from([0]));
  writeFileSync(join(tmp, "a", "b", "extra.stl"), Buffer.from([0]));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("createAccessResolver", () => {
  it("admins always resolve to allow", async () => {
    const r = createAccessResolver({
      user: admin,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await r.resolve("a/b/c.stl", "file")).toBe("allow");
    expect(await r.resolve("a/b", "directory")).toBe("allow");
  });

  it("falls through to global default when no access files exist", async () => {
    const rPub = createAccessResolver({
      user: null,
      storage,
      providerDefault: undefined,
      globalDefault: "public",
    });
    expect(await rPub.resolve("a/b/c.stl", "file")).toBe("allow");

    const rSigned = createAccessResolver({
      user: null,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await rSigned.resolve("a/b/c.stl", "file")).toBe("deny-anonymous");

    const rSignedOk = createAccessResolver({
      user: userAlice,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await rSignedOk.resolve("a/b/c.stl", "file")).toBe("allow");
  });

  it("provider default overrides global default", async () => {
    const r = createAccessResolver({
      user: null,
      storage,
      providerDefault: "public",
      globalDefault: "signed-in",
    });
    expect(await r.resolve("a/b/c.stl", "file")).toBe("allow");
  });

  it("a `default` in the file's parent directory takes priority over provider default", async () => {
    writeFileSync(join(tmp, "a", "b", ".minifold_access.yaml"), "default: signed-in\n");
    const r = createAccessResolver({
      user: null,
      storage,
      providerDefault: "public",
      globalDefault: "signed-in",
    });
    expect(await r.resolve("a/b/c.stl", "file")).toBe("deny-anonymous");
  });

  it("an `overrides[basename]` for a file beats `default` in the same dir", async () => {
    writeFileSync(
      join(tmp, "a", "b", ".minifold_access.yaml"),
      "default: signed-in\noverrides:\n  c.stl: public\n",
    );
    const r = createAccessResolver({
      user: null,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await r.resolve("a/b/c.stl", "file")).toBe("allow");
    // sibling file unaffected
    expect(await r.resolve("a/b/extra.stl", "file")).toBe("deny-anonymous");
  });

  it("walks up to parent directory's `default` when current dir's access file has neither overrides[name] nor default", async () => {
    writeFileSync(join(tmp, "a", ".minifold_access.yaml"), "default: public\n");
    writeFileSync(join(tmp, "a", "b", ".minifold_access.yaml"), "overrides: {}\n");
    const r = createAccessResolver({
      user: null,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await r.resolve("a/b/c.stl", "file")).toBe("allow");
  });

  it("walks all the way to provider root", async () => {
    writeFileSync(join(tmp, ".minifold_access.yaml"), "default: public\n");
    const r = createAccessResolver({
      user: null,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await r.resolve("a/b/c.stl", "file")).toBe("allow");
  });

  it("user-list allows listed user, denies non-listed authed user, redirects anonymous", async () => {
    writeFileSync(
      join(tmp, "a", "b", ".minifold_access.yaml"),
      "default: [alice]\n",
    );
    const rAlice = createAccessResolver({
      user: userAlice,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await rAlice.resolve("a/b/c.stl", "file")).toBe("allow");

    const rBob = createAccessResolver({
      user: userBob,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await rBob.resolve("a/b/c.stl", "file")).toBe("deny-authed");

    const rAnon = createAccessResolver({
      user: null,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await rAnon.resolve("a/b/c.stl", "file")).toBe("deny-anonymous");
  });

  it("user-list comparison is case-insensitive", async () => {
    writeFileSync(
      join(tmp, "a", "b", ".minifold_access.yaml"),
      "default: [Alice]\n",
    );
    const r = createAccessResolver({
      user: userAlice, // username 'alice'
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await r.resolve("a/b/c.stl", "file")).toBe("allow");
  });

  it("empty user-list denies everyone except admins", async () => {
    writeFileSync(join(tmp, "a", "b", ".minifold_access.yaml"), "default: []\n");
    const rUser = createAccessResolver({
      user: userAlice,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await rUser.resolve("a/b/c.stl", "file")).toBe("deny-authed");

    const rAdmin = createAccessResolver({
      user: admin,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await rAdmin.resolve("a/b/c.stl", "file")).toBe("allow");
  });

  it("directories never consult overrides — only `default` of their own access file", async () => {
    writeFileSync(
      join(tmp, "a", ".minifold_access.yaml"),
      "default: signed-in\noverrides:\n  b: public\n", // 'b' override is ignored for dir-kind lookups
    );
    const r = createAccessResolver({
      user: null,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    // The directory 'a/b' has no own access file, so we walk up to 'a' and use its `default: signed-in`.
    // The `overrides: { b: public }` in 'a' must NOT apply to directory 'b'.
    expect(await r.resolve("a/b", "directory")).toBe("deny-anonymous");
  });

  it("a directory's own `default` is used before walking up", async () => {
    writeFileSync(
      join(tmp, "a", "b", ".minifold_access.yaml"),
      "default: public\n",
    );
    const r = createAccessResolver({
      user: null,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await r.resolve("a/b", "directory")).toBe("allow");
  });

  it("malformed access file at one level is skipped — walk-up continues", async () => {
    writeFileSync(join(tmp, "a", ".minifold_access.yaml"), "default: public\n");
    writeFileSync(
      join(tmp, "a", "b", ".minifold_access.yaml"),
      ":not-yaml::\n", // malformed
    );
    const r = createAccessResolver({
      user: null,
      storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    expect(await r.resolve("a/b/c.stl", "file")).toBe("allow");
  });

  it("memoizes file reads — listing N files in the same dir reads the access file once", async () => {
    writeFileSync(
      join(tmp, "a", "b", ".minifold_access.yaml"),
      "default: public\n",
    );
    let reads = 0;
    const wrapped = new Proxy(storage, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (prop === "read") {
          return async (p: string) => {
            reads++;
            return v.call(target, p);
          };
        }
        return v;
      },
    });
    const r = createAccessResolver({
      user: null,
      storage: wrapped as typeof storage,
      providerDefault: undefined,
      globalDefault: "signed-in",
    });
    await r.resolve("a/b/c.stl", "file");
    await r.resolve("a/b/extra.stl", "file");
    expect(reads).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test — expect import error**

```bash
npm test -- tests/server/access/resolver.test.ts
```

- [ ] **Step 3: Implement `createAccessResolver`**

Create `src/server/access/resolver.ts`:

```ts
import type { StorageProvider } from "@/server/storage/types";
import type { UserRow } from "@/server/db/users";
import type { Decision, Level, ParsedAccess, SimpleLevel } from "./types";
import { isUserList } from "./types";
import { readAccessFile } from "./read-access-file";

export type ResolverOptions = {
  user: UserRow | null;
  storage: StorageProvider;
  providerDefault: SimpleLevel | undefined;
  globalDefault: SimpleLevel;
};

export type EntryKind = "file" | "directory";

export interface Resolver {
  resolve(path: string, kind: EntryKind): Promise<Decision>;
}

export function createAccessResolver(opts: ResolverOptions): Resolver {
  const cache = new Map<string, ParsedAccess | null>();

  async function loadAccess(dir: string): Promise<ParsedAccess | null> {
    const cached = cache.get(dir);
    if (cached !== undefined) return cached;
    const fresh = await readAccessFile(opts.storage, dir);
    cache.set(dir, fresh);
    return fresh;
  }

  async function resolve(path: string, kind: EntryKind): Promise<Decision> {
    if (opts.user?.role === "admin") return "allow";

    let dir: string;
    let overrideKey: string | null = null;

    if (kind === "file") {
      dir = parentPath(path);
      overrideKey = baseName(path);
    } else {
      dir = path;
    }

    let levelToApply: Level | null = null;
    let firstIteration = true;

    while (true) {
      const access = await loadAccess(dir);
      if (access) {
        if (firstIteration && overrideKey !== null) {
          const ov = access.overrides[overrideKey];
          if (ov !== undefined) {
            levelToApply = ov;
            break;
          }
        }
        if (access.default !== undefined) {
          levelToApply = access.default;
          break;
        }
      }
      if (dir === "") break;
      dir = parentPath(dir);
      firstIteration = false;
    }

    if (levelToApply === null && opts.providerDefault !== undefined) {
      levelToApply = opts.providerDefault;
    }
    if (levelToApply === null) {
      levelToApply = opts.globalDefault;
    }

    return applyLevel(levelToApply, opts.user);
  }

  return { resolve };
}

function applyLevel(level: Level, user: UserRow | null): Decision {
  if (level === "public") return "allow";
  if (level === "signed-in") return user ? "allow" : "deny-anonymous";
  if (isUserList(level)) {
    if (!user) return "deny-anonymous";
    return level.includes(user.username.toLowerCase()) ? "allow" : "deny-authed";
  }
  // Defensive: unknown level shape — fail closed for non-admins.
  return user ? "deny-authed" : "deny-anonymous";
}

function parentPath(p: string): string {
  if (p === "") return "";
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function baseName(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}
```

- [ ] **Step 4: Run the test — expect pass**

```bash
npm test -- tests/server/access/resolver.test.ts
```

Expected: all 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/access/resolver.ts tests/server/access/resolver.test.ts
git commit -m "feat(access): createAccessResolver with walk-up resolution + per-request memoization"
```

---

## Task 9: `buildResolverForRequest` — request-scoped factory (TDD)

**Files:**
- Create: `src/server/access/build-resolver.ts`
- Test: `tests/server/access/build-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/access/build-resolver.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __resetDatabase, getDatabase } from "@/server/db";
import { createProvider } from "@/server/db/providers";
import { setSetting } from "@/server/db/settings";
import { createUser, type UserRow } from "@/server/db/users";
import { buildResolverForRequest } from "@/server/access/build-resolver";

let tmp: string;
let storageRoot: string;
let user: UserRow;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-build-resolver-"));
  storageRoot = join(tmp, "files");
  mkdirSync(storageRoot, { recursive: true });

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

describe("buildResolverForRequest", () => {
  it("returns null for an unknown provider", () => {
    expect(
      buildResolverForRequest({ user, providerSlug: "missing" }),
    ).toBeNull();
  });

  it("returns a resolver bound to the right user + globals + providerDefault", async () => {
    // Provider has no defaultAccess, global is the seeded 'signed-in'.
    const r1 = buildResolverForRequest({ user: null, providerSlug: "nas" });
    expect(await r1!.resolve("anything.stl", "file")).toBe("deny-anonymous");
    const r2 = buildResolverForRequest({ user, providerSlug: "nas" });
    expect(await r2!.resolve("anything.stl", "file")).toBe("allow");

    // Flip global default to public.
    setSetting(getDatabase(), "global_default_access", "public");
    const r3 = buildResolverForRequest({ user: null, providerSlug: "nas" });
    expect(await r3!.resolve("anything.stl", "file")).toBe("allow");
  });

  it("uses the provider's defaultAccess when configured", async () => {
    // Add a second provider with defaultAccess=public, with global stuck at signed-in.
    const db = getDatabase();
    const otherRoot = join(tmp, "other");
    mkdirSync(otherRoot, { recursive: true });
    createProvider(db, {
      slug: "pub",
      name: "Public",
      type: "local",
      config: { rootPath: otherRoot, defaultAccess: "public" },
    });
    const r = buildResolverForRequest({ user: null, providerSlug: "pub" });
    writeFileSync(join(otherRoot, "x.md"), "x");
    expect(await r!.resolve("x.md", "file")).toBe("allow");
  });
});
```

- [ ] **Step 2: Run the test — expect import failure**

```bash
npm test -- tests/server/access/build-resolver.test.ts
```

- [ ] **Step 3: Implement `buildResolverForRequest`**

Create `src/server/access/build-resolver.ts`:

```ts
import { getDatabase } from "@/server/db";
import { findProviderBySlug } from "@/server/db/providers";
import { providerFromRow } from "@/server/storage/factory";
import type { UserRow } from "@/server/db/users";
import { createAccessResolver, type Resolver } from "./resolver";
import { getGlobalDefaultAccess } from "./global-default";

type Args = {
  user: UserRow | null;
  providerSlug: string;
};

export function buildResolverForRequest({ user, providerSlug }: Args): Resolver | null {
  const db = getDatabase();
  const row = findProviderBySlug(db, providerSlug);
  if (!row) return null;
  const storage = providerFromRow(row);
  const config = row.config as { defaultAccess?: "public" | "signed-in" };
  const providerDefault = config.defaultAccess;
  const globalDefault = getGlobalDefaultAccess(db);
  return createAccessResolver({ user, storage, providerDefault, globalDefault });
}
```

- [ ] **Step 4: Run the test — expect pass**

```bash
npm test -- tests/server/access/build-resolver.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/server/access/build-resolver.ts tests/server/access/build-resolver.test.ts
git commit -m "feat(access): buildResolverForRequest binds resolver to user + provider + globals"
```

---

## Task 10: Wire resolver into `browse.list`

**Files:**
- Modify: `src/server/trpc/routers/browse.ts`
- Modify: `tests/server/trpc/browse.test.ts`

- [ ] **Step 1: Update the tests**

Open `tests/server/trpc/browse.test.ts`. Replace the **entire** `describe("browse.list", ...)` block with:

```ts
describe("browse.list", () => {
  it("does not throw UNAUTHORIZED for anonymous callers — directory access decides", async () => {
    // With access enforcement, browse.list is public. Whether the call succeeds
    // depends on whether the caller can see the directory itself.
    // Default global is 'signed-in' (seeded by migration 005), so anonymous on the
    // root directory resolves to deny-anonymous → NOT_FOUND (no UNAUTHORIZED).
    const caller = appRouter.createCaller({ currentUser: null });
    await expect(
      caller.browse.list({ providerSlug: "nas", path: "" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
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
    writeFileSync(join(storageRoot, ".minifold_access.yaml"), "default: signed-in\n");
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

  it("filters out files the resolver denies for the current user", async () => {
    // Make the dir public, but mark a.stl as user-list [bob] — alice can't see a.stl.
    writeFileSync(
      join(storageRoot, ".minifold_access.yaml"),
      "default: public\noverrides:\n  a.stl: [bob]\n",
    );
    const caller = appRouter.createCaller({ currentUser: user }); // alice
    const result = await caller.browse.list({ providerSlug: "nas", path: "" });
    if (!result.changed) throw new Error("expected changed:true");
    expect(result.entries.map((e) => e.name)).toEqual(["b.stl"]);
  });

  it("anonymous caller sees only public entries when the directory itself is public", async () => {
    // Directory default public (so anonymous can list); per-file overrides gate b.stl.
    writeFileSync(
      join(storageRoot, ".minifold_access.yaml"),
      "default: public\noverrides:\n  b.stl: signed-in\n",
    );
    const caller = appRouter.createCaller({ currentUser: null });
    const result = await caller.browse.list({ providerSlug: "nas", path: "" });
    if (!result.changed) throw new Error("expected changed:true");
    expect(result.entries.map((e) => e.name)).toEqual(["a.stl"]);
  });

  it("admin sees everything, including entries denied to regular users", async () => {
    writeFileSync(
      join(storageRoot, ".minifold_access.yaml"),
      "default: [bob]\n",
    );
    const db = getDatabase();
    const admin = createUser(db, {
      name: "Root",
      username: "root",
      passwordHash: "x",
      role: "admin",
      mustChangePassword: false,
    });
    const caller = appRouter.createCaller({ currentUser: admin });
    const result = await caller.browse.list({ providerSlug: "nas", path: "" });
    if (!result.changed) throw new Error("expected changed:true");
    expect(result.entries.map((e) => e.name)).toEqual(["a.stl", "b.stl"]);
  });

  it("returns NOT_FOUND when the directory itself is denied to the user", async () => {
    // Create a subdirectory that's user-list only.
    mkdirSync(join(storageRoot, "secret"));
    writeFileSync(join(storageRoot, "secret", "x.stl"), Buffer.from([0]));
    writeFileSync(
      join(storageRoot, "secret", ".minifold_access.yaml"),
      "default: [bob]\n",
    );
    const caller = appRouter.createCaller({ currentUser: user }); // alice
    await expect(
      caller.browse.list({ providerSlug: "nas", path: "secret" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
```

You'll need to add `mkdirSync` to the `node:fs` import at the top of the test file. The existing import is `import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";` — `mkdirSync` is already there, so no change needed.

Also note: the old "filters hidden entries" test referenced `.minifold_access.json` (an artifact of the parent spec). The new test uses `.minifold_access.yaml`. Verify this when copying.

- [ ] **Step 2: Run the test — expect failures**

```bash
npm test -- tests/server/trpc/browse.test.ts
```

Expected: tests fail because the procedure still throws UNAUTHORIZED on null user, no resolver wired in.

- [ ] **Step 3: Update `src/server/trpc/routers/browse.ts`**

Replace the **entire file contents** with:

```ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../trpc";
import { computeDirHash } from "@/server/browse/dir-hash";
import { isHiddenEntry } from "@/server/browse/hidden";
import { sortEntries } from "@/server/browse/sort";
import { upsertDirCache } from "@/server/db/dir-cache";
import { getDatabase } from "@/server/db";
import {
  NotFoundError,
  PathTraversalError,
  type Entry,
} from "@/server/storage/types";
import { listWithCache } from "@/server/browse/list-cache";
import { findProviderBySlug } from "@/server/db/providers";
import { providerFromRow } from "@/server/storage/factory";
import { createAccessResolver } from "@/server/access/resolver";
import { getGlobalDefaultAccess } from "@/server/access/global-default";

export const browseRouter = router({
  list: publicProcedure
    .input(
      z.object({
        providerSlug: z.string().min(1),
        path: z.string(),
        knownHash: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const db = getDatabase();
      const row = findProviderBySlug(db, input.providerSlug);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const provider = providerFromRow(row);

      const config = row.config as { defaultAccess?: "public" | "signed-in" };
      const resolver = createAccessResolver({
        user: ctx.currentUser,
        storage: provider,
        providerDefault: config.defaultAccess,
        globalDefault: getGlobalDefaultAccess(db),
      });

      // Gate the directory itself first — if user can't see it, behave as 404.
      const dirDecision = await resolver.resolve(input.path, "directory");
      if (dirDecision !== "allow") {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      let raw: Entry[];
      try {
        raw = await listWithCache(provider, input.path);
      } catch (err) {
        if (err instanceof NotFoundError || err instanceof PathTraversalError) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        throw err;
      }

      const hash = computeDirHash(raw);
      const cacheKey = `${input.providerSlug}/${input.path}`;
      upsertDirCache(db, cacheKey, hash, Date.now());

      if (input.knownHash === hash) {
        return { changed: false as const, hash };
      }

      const visibleAfterHidden = raw.filter((e) => !isHiddenEntry(e.name));
      const allowed: Entry[] = [];
      for (const entry of visibleAfterHidden) {
        const child =
          input.path === "" ? entry.name : `${input.path}/${entry.name}`;
        const decision = await resolver.resolve(child, entry.type);
        if (decision === "allow") allowed.push(entry);
      }

      const sorted = sortEntries(allowed);
      return { changed: true as const, hash, entries: sorted };
    }),
});
```

- [ ] **Step 4: Run the test — expect pass**

```bash
npm test -- tests/server/trpc/browse.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/browse.ts tests/server/trpc/browse.test.ts
git commit -m "feat(access): browse.list filters via resolver, switches to publicProcedure"
```

---

## Task 11: Drop blanket auth redirect from `[provider]/layout.tsx`

**Files:**
- Modify: `src/app/[provider]/layout.tsx`

(There is no existing test for this layout. The behaviour is exercised through the page-level integration tests.)

- [ ] **Step 1: Replace the layout file contents**

Open `src/app/[provider]/layout.tsx` and replace the **entire contents** with:

```tsx
// The browse routes used to gate every request on `getCurrentUser()` here,
// but Phase 7 access control means anonymous users may browse public folders.
// Per-path access is enforced inside `[[...path]]/page.tsx` via the resolver.
export default function ProviderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/[provider]/layout.tsx"
git commit -m "feat(access): drop blanket auth redirect in provider layout — page enforces per-path"
```

---

## Task 12: Wire resolver into `[provider]/[[...path]]/page.tsx`

**Files:**
- Modify: `src/app/[provider]/[[...path]]/page.tsx`

(No existing test for the page. The behaviour is exercised manually + via component-level tests; an integration test through the route is not in scope here. Subagents should still verify by manual smoke testing if possible, but the typecheck is the gate.)

- [ ] **Step 1: Replace the file contents**

Open `src/app/[provider]/[[...path]]/page.tsx` and replace the **entire contents** with:

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
import { decodePathSegments } from "@/server/browse/encode-path";
import { listWithCache } from "@/server/browse/list-cache";
import { isThumbnailServiceEnabled } from "@/server/thumb/config";
import { Breadcrumbs } from "@/components/browse/Breadcrumbs";
import { FolderBrowser } from "@/components/browse/FolderBrowser";
import { FolderDescription } from "@/components/browse/FolderDescription";
import { FileDetail } from "@/components/browse/FileDetail";
import { getCurrentUser } from "@/server/auth/current-user";
import { createAccessResolver } from "@/server/access/resolver";
import { getGlobalDefaultAccess } from "@/server/access/global-default";

type Params = { provider: string; path?: string[] };
type SearchParams = { showAll?: string | string[] };

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

  if (entry.type === "directory") {
    const allEntries = await listWithCache(provider, path);
    const hash = computeDirHash(allEntries);
    const visibleAfterHidden = allEntries.filter((e) => !isHiddenEntry(e.name));

    // Filter children by the resolver — per-path enforcement on every entry.
    const allowedChildren: Entry[] = [];
    for (const child of visibleAfterHidden) {
      const childPath = path === "" ? child.name : `${path}/${child.name}`;
      const childDecision = await resolver.resolve(childPath, child.type);
      if (childDecision === "allow") allowedChildren.push(child);
    }
    const visible = sortEntries(allowedChildren);

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

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Run the full server-side test suite to ensure no regressions**

```bash
npm test -- tests/server tests/app/admin tests/app/setup
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[provider]/[[...path]]/page.tsx"
git commit -m "feat(access): RSC page enforces resolver — login redirect or 404 on denial; filters children"
```

---

## Task 13: Wire resolver into `/api/file` route

**Files:**
- Modify: `src/app/api/file/[provider]/[...path]/route.ts`
- Modify: `tests/app/api/file/route.test.ts`

- [ ] **Step 1: Update the existing tests**

Open `tests/app/api/file/route.test.ts`. Make these changes:

**Change 1:** Replace the `it("401s when not signed in", …)` test with:

```ts
  it("404s on a signed-in path when not signed in (no info leak)", async () => {
    // Default global is 'signed-in' (seeded by migration 005).
    const { getCurrentUser } = await import("@/server/auth/current-user");
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/nas/notes.md"),
      await ctx("nas", ["notes.md"]),
    );
    expect(res.status).toBe(404);
  });
```

**Change 2:** Add these new `it(...)` tests at the end of the `describe("GET /api/file/[provider]/[...path]", …)` block:

```ts
  it("streams a public file even when anonymous", async () => {
    writeFileSync(
      join(filesRoot, ".minifold_access.yaml"),
      "default: signed-in\noverrides:\n  notes.md: public\n",
    );
    const { getCurrentUser } = await import("@/server/auth/current-user");
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/nas/notes.md"),
      await ctx("nas", ["notes.md"]),
    );
    expect(res.status).toBe(200);
  });

  it("404s when an authed user is not on the user-list", async () => {
    writeFileSync(
      join(filesRoot, ".minifold_access.yaml"),
      "overrides:\n  notes.md: [bob]\n",
    );
    await authedAsUser(); // username 'user', not on list
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/nas/notes.md"),
      await ctx("nas", ["notes.md"]),
    );
    expect(res.status).toBe(404);
  });

  it("admin can stream a denied file", async () => {
    writeFileSync(
      join(filesRoot, ".minifold_access.yaml"),
      "overrides:\n  notes.md: [bob]\n",
    );
    const mod = await import("@/server/auth/current-user");
    vi.mocked(mod.getCurrentUser).mockResolvedValue({
      id: "u-ad",
      name: "Admin",
      username: "ad",
      role: "admin",
      must_change_password: 0,
      deactivated: 0,
      created_at: 0,
      last_login: null,
      password: "x",
    });
    const { GET } = await import("@/app/api/file/[provider]/[...path]/route");
    const res = await GET(
      new Request("http://x/api/file/nas/notes.md"),
      await ctx("nas", ["notes.md"]),
    );
    expect(res.status).toBe(200);
  });
```

- [ ] **Step 2: Run the test — expect failures**

```bash
npm test -- tests/app/api/file/route.test.ts
```

Expected: tests fail because the route still 401s and no resolver is wired in.

- [ ] **Step 3: Update the route**

Open `src/app/api/file/[provider]/[...path]/route.ts` and replace the **entire contents** with:

```ts
import { getCurrentUser } from "@/server/auth/current-user";
import { mimeFor } from "@/server/browse/mime";
import { decodePathSegments } from "@/server/browse/encode-path";
import {
  NotFoundError,
  PathTraversalError,
} from "@/server/storage/types";
import { getDatabase } from "@/server/db";
import { findProviderBySlug } from "@/server/db/providers";
import { providerFromRow } from "@/server/storage/factory";
import { createAccessResolver } from "@/server/access/resolver";
import { getGlobalDefaultAccess } from "@/server/access/global-default";

type Ctx = {
  params: Promise<{ provider: string; path: string[] }>;
};

export async function GET(req: Request, ctx: Ctx) {
  const user = await getCurrentUser();

  const { provider: slug, path: rawSegments } = await ctx.params;
  const segments = decodePathSegments(rawSegments ?? []);
  if (!segments) return new Response("Bad Request", { status: 400 });

  const row = findProviderBySlug(getDatabase(), slug);
  if (!row) return new Response("Not Found", { status: 404 });
  const provider = providerFromRow(row);

  const path = segments.join("/");
  const fileName = segments[segments.length - 1] ?? "";

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

  const config = row.config as { defaultAccess?: "public" | "signed-in" };
  const resolver = createAccessResolver({
    user,
    storage: provider,
    providerDefault: config.defaultAccess,
    globalDefault: getGlobalDefaultAccess(getDatabase()),
  });
  const decision = await resolver.resolve(path, "file");
  if (decision !== "allow") {
    // API routes always 404 on denial — never reveal existence.
    return new Response("Not Found", { status: 404 });
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
  const dispositionType = inline ? "inline" : "attachment";

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": mimeFor(fileName),
      "content-length": String(entry.size),
      "content-disposition": `${dispositionType}; ${dispositionFilename(fileName)}`,
      "cache-control": "private, max-age=0",
    },
  });
}

// RFC 6266 / RFC 5987: emit both `filename=` (ASCII fallback) and
// `filename*=UTF-8''…` (percent-encoded UTF-8) so browsers handle non-ASCII
// names correctly. CR/LF are stripped to avoid header injection.
function dispositionFilename(name: string): string {
  const safe = name.replace(/[\r\n]/g, "");
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "\\$&");
  const encoded = encodeURIComponent(safe);
  return `filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
```

- [ ] **Step 4: Run the test — expect pass**

```bash
npm test -- tests/app/api/file/route.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/file/[provider]/[...path]/route.ts" "tests/app/api/file/route.test.ts"
git commit -m "feat(access): /api/file gates via resolver — 404 on denial, never 401"
```

---

## Task 14: Wire resolver into `/api/thumb` route

**Files:**
- Modify: `src/app/api/thumb/[provider]/[...path]/route.ts`
- Modify: `tests/app/api/thumb/thumb.test.ts`

- [ ] **Step 1: Update the existing 401 test**

Open `tests/app/api/thumb/thumb.test.ts`. Find the existing test:

```ts
  it("7. 401 when unauthenticated", async () => {
    const mod = await import("@/server/auth/current-user");
    vi.mocked(mod.getCurrentUser).mockResolvedValue(null);
    const { GET } = await import(
      "@/app/api/thumb/[provider]/[...path]/route"
    );
    const res = await GET(
      new Request("http://x/api/thumb/nas/prints/anchor.stl") as unknown as NextRequest,
      await ctx("nas", ["prints", "anchor.stl"]),
    );
    expect(res.status).toBe(401);
  });
```

Replace it (in place) with:

```ts
  it("7. 404 when unauthenticated on a signed-in path (no info leak)", async () => {
    // Default global is 'signed-in' (seeded by migration 005). Anonymous → 404.
    const mod = await import("@/server/auth/current-user");
    vi.mocked(mod.getCurrentUser).mockResolvedValue(null);
    const { GET } = await import(
      "@/app/api/thumb/[provider]/[...path]/route"
    );
    const res = await GET(
      new Request("http://x/api/thumb/nas/prints/anchor.stl") as unknown as NextRequest,
      await ctx("nas", ["prints", "anchor.stl"]),
    );
    expect(res.status).toBe(404);
  });
```

- [ ] **Step 2: Add new access-related tests at the end of the `describe("GET /api/thumb/[provider]/[...path]", …)` block**

Append (immediately before the final `});` closing the describe):

```ts
  it("8. 404 when an authed user is not on the user-list", async () => {
    writeFileSync(
      join(filesRoot, "prints", ".minifold_access.yaml"),
      "overrides:\n  anchor.stl: [bob]\n",
    );
    await authedAsUser(); // username 'user', not on list
    await stubFetchThumbnailOk(); // would succeed if we got past the resolver
    const { GET } = await import(
      "@/app/api/thumb/[provider]/[...path]/route"
    );
    const res = await GET(
      new Request("http://x/api/thumb/nas/prints/anchor.stl") as unknown as NextRequest,
      await ctx("nas", ["prints", "anchor.stl"]),
    );
    expect(res.status).toBe(404);
  });

  it("9. admin gets the thumbnail even for an access-denied file", async () => {
    writeFileSync(
      join(filesRoot, "prints", ".minifold_access.yaml"),
      "overrides:\n  anchor.stl: [bob]\n",
    );
    const mod = await import("@/server/auth/current-user");
    vi.mocked(mod.getCurrentUser).mockResolvedValue({
      id: "u-ad",
      name: "Admin",
      username: "ad",
      role: "admin",
      must_change_password: 0,
      deactivated: 0,
      created_at: 0,
      last_login: null,
      password: "x",
    });
    await stubFetchThumbnailOk();
    const { GET } = await import(
      "@/app/api/thumb/[provider]/[...path]/route"
    );
    const res = await GET(
      new Request("http://x/api/thumb/nas/prints/anchor.stl") as unknown as NextRequest,
      await ctx("nas", ["prints", "anchor.stl"]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
  });

  it("10. anonymous gets thumbnail for a public file", async () => {
    writeFileSync(
      join(filesRoot, "prints", ".minifold_access.yaml"),
      "overrides:\n  anchor.stl: public\n",
    );
    const mod = await import("@/server/auth/current-user");
    vi.mocked(mod.getCurrentUser).mockResolvedValue(null);
    await stubFetchThumbnailOk();
    const { GET } = await import(
      "@/app/api/thumb/[provider]/[...path]/route"
    );
    const res = await GET(
      new Request("http://x/api/thumb/nas/prints/anchor.stl") as unknown as NextRequest,
      await ctx("nas", ["prints", "anchor.stl"]),
    );
    expect(res.status).toBe(200);
  });
```

- [ ] **Step 3: Run the test — expect failures**

```bash
npm test -- tests/app/api/thumb/thumb.test.ts
```

Expected: 401 → 404 mismatch + new tests fail (no resolver yet).

- [ ] **Step 4: Update the route**

Open `src/app/api/thumb/[provider]/[...path]/route.ts` and replace the **entire contents** with:

```ts
import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/current-user";
import { decodePathSegments } from "@/server/browse/encode-path";
import { thumbSidecarPath } from "@/server/thumb/sidecar-name";
import { getThumbnailServiceUrl } from "@/server/thumb/config";
import { fetchThumbnail, ThumbnailServiceError } from "@/server/thumb/client";
import { NotFoundError, PathTraversalError } from "@/server/storage/types";
import { getDatabase } from "@/server/db";
import { findProviderBySlug } from "@/server/db/providers";
import { providerFromRow } from "@/server/storage/factory";
import { createAccessResolver } from "@/server/access/resolver";
import { getGlobalDefaultAccess } from "@/server/access/global-default";

const SUPPORTED_EXT = new Set(["stl", "3mf"]);
const TIMEOUT_MS = 30_000;

type Ctx = {
  params: Promise<{ provider: string; path: string[] }>;
};

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const user = await getCurrentUser();

  const { provider: slug, path: rawSegments = [] } = await ctx.params;
  const segments = decodePathSegments(rawSegments);
  if (!segments) return new Response("Bad Request", { status: 400 });
  const path = segments.join("/");

  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (!SUPPORTED_EXT.has(ext)) return new Response("Unsupported", { status: 400 });

  const row = findProviderBySlug(getDatabase(), slug);
  if (!row) return new Response("Not Found", { status: 404 });
  const provider = providerFromRow(row);

  const config = row.config as { defaultAccess?: "public" | "signed-in" };
  const resolver = createAccessResolver({
    user,
    storage: provider,
    providerDefault: config.defaultAccess,
    globalDefault: getGlobalDefaultAccess(getDatabase()),
  });
  const decision = await resolver.resolve(path, "file");
  if (decision !== "allow") {
    return new Response("Not Found", { status: 404 });
  }

  const serviceUrl = getThumbnailServiceUrl();
  if (!serviceUrl) return new Response("Thumbnails Disabled", { status: 404 });

  const sidecar = thumbSidecarPath(path);

  // Serve cached sidecar if available.
  try {
    if (await provider.exists(sidecar)) {
      const stream = await provider.read(sidecar);
      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": "image/webp",
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    }
  } catch {
    // Fall through to regenerate.
  }

  // Read the source file.
  let source: Buffer;
  try {
    const stream = await provider.read(path);
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    source = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof PathTraversalError) {
      return new Response("Not Found", { status: 404 });
    }
    throw err;
  }

  // Generate thumbnail via worker service.
  let thumb: Buffer;
  try {
    thumb = await fetchThumbnail({
      serviceUrl,
      data: source,
      format: ext as "stl" | "3mf",
      timeoutMs: TIMEOUT_MS,
    });
  } catch (err) {
    if (err instanceof ThumbnailServiceError) {
      return new Response("Thumbnail Service Error", { status: 502 });
    }
    throw err;
  }

  // Cache the sidecar (best-effort — don't block the response on write errors).
  void provider.write(sidecar, thumb).catch(() => {});

  return new Response(new Uint8Array(thumb), {
    status: 200,
    headers: {
      "content-type": "image/webp",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
```

- [ ] **Step 5: Run the test — expect pass**

```bash
npm test -- tests/app/api/thumb/thumb.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/thumb/[provider]/[...path]/route.ts" "tests/app/api/thumb/thumb.test.ts"
git commit -m "feat(access): /api/thumb gates via resolver — 404 on denial, never 401"
```

---

## Task 15: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Lint**

```bash
npm run lint
```

Expected: no errors. Fix any minor issues (unused imports, etc.) inline before continuing.

- [ ] **Step 4: Manual sanity check (optional but recommended)**

If a local Minifold instance is running with a configured local provider, drop a `.minifold_access.yaml` into a folder:

```yaml
default: signed-in
overrides:
  some-public.stl: public
```

Verify:
- Anonymous browser to `/{provider}` redirects to login.
- Anonymous direct fetch to `/{provider}/some-public.stl` streams the file.
- Anonymous direct fetch to `/{provider}/other-private.stl` returns 404.
- After login, browse listing shows everything except hidden `.minifold_*` files.

- [ ] **Step 5: If lint or any test produced new uncommitted changes from auto-fix, commit them**

```bash
git status
git add -- <specific files only — never -A>
git commit -m "chore(access): lint + format cleanup"
```

(Skip this step if there are no changes.)

---

## Self-Review Notes

- All 7 spec sections (file format, resolution, semantics, enforcement points, performance, schema/config, out-of-scope) are covered by Tasks 1–14.
- No TBDs, no "implement appropriately" — every code-touching step has the exact code to write.
- Type names are consistent: `SimpleLevel` / `Level` / `Decision` / `ParsedAccess` / `Resolver` / `EntryKind` are defined once and reused.
- The `?callbackUrl=` query param matches the existing login-redirect convention (verified in `src/app/login/actions.ts`).
- Migration filename `005_seed_global_access.sql` continues the existing 00X numbering.
- Per-request memoization is verified by an explicit count test (Task 8).
- Admin bypass is tested at the resolver level (Task 8) and at every enforcement surface (Tasks 10, 13, 14).
- Walk-up edge cases are covered: dir's own access file, walk-up across multiple levels, malformed file at intermediate level, provider default fallback, global default fallback (Task 8).
- The intentional case where a YAML `default: secret` (invalid level) is logged as a warning and the file's `default` is treated as missing — which means walk-up continues — is covered (Task 5).

