# Phase 3 — Storage Providers (Local FS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-04-23-minifold-design.md](../specs/2026-04-23-minifold-design.md) §3 (Setup Wizard step 2), §4 (Storage Providers, LocalFS only this phase), §15 (Data Model — `providers` table).

**Goal:** After Phase 3, a fresh deployment walks the operator through creating an admin, THEN adding a first local-FS storage provider. Providers appear in the sidebar. The admin CLI can add/list/remove providers without touching SQL. The `StorageProvider` interface is finalised and one implementation (local) ships with full test coverage; S3 lands in Phase 3.5 as a second implementation against the same interface.

**Architecture:** A new `StorageProvider` interface (`list`, `stat`, `read`, `write`, `exists`) abstracts all FS access. `LocalStorageProvider` implements it against `node:fs` with strict path-traversal defense — every operation resolves the joined path and rejects anything escaping `rootPath`. The `providers` table stores `slug`, `name`, `type`, `position`, and an AES-GCM-encrypted `config` JSON blob. The encryption key is a 32-byte value auto-generated on first use and persisted in the existing `settings` table (key `config_encryption_key`). A `providerFactory` takes a decrypted row and returns a typed `StorageProvider`. The setup wizard page renders `SetupForm` when no admin exists, `ProviderForm` when admin exists but no provider, then redirects to `/`. Middleware treats "setup complete" as `hasAnyAdmin && hasAnyProvider`. The sidebar lists providers as top-level links to `/{slug}` (those routes 404 until Phase 4 wires up file browsing).

**Tech Stack:**
- Existing: Next 16 App Router, TypeScript, better-sqlite3, Vitest, Tailwind v4
- New Node built-ins used: `node:fs` (sync + promises), `node:crypto` (`createCipheriv`, `createDecipheriv`, `randomBytes`)
- No new runtime deps; no AWS SDK yet (Phase 3.5)

**Out of scope (future phases):**
- S3 storage provider → Phase 3.5
- Admin UI for managing providers beyond the wizard → Phase 8 (CLI covers it until then)
- File browsing / directory listings in the UI → Phase 4
- `.minifold_access.json` file-level ACLs → Phase 7 (uses `StorageProvider.read/write/exists` defined here)

---

## Design notes

### Provider slug format
Slugs must be URL-safe and memorable. Validator: `/^[a-z0-9-]{1,32}$/`. Lowercased on insert, unique. Used as the first URL segment (`/nas/prints/benchy.stl` → slug `nas`, path `prints/benchy.stl`).

### Encryption key bootstrap
On first call to `encryptJSON(plain)`:
1. Read `config_encryption_key` from `settings`.
2. If missing, generate `randomBytes(32)`, base64-encode, `INSERT OR IGNORE` into settings, re-read (concurrency-safe).
3. Decode and use as AES-256-GCM key.

Storage format: `"<iv-hex>:<authtag-hex>:<ciphertext-hex>"`. Three colon-separated hex strings. Decoder splits on `:` — each field is hex, no collision risk.

### Path-traversal defense
`LocalStorageProvider.resolvePath(relative)` does:
1. `const full = path.resolve(this.rootPath, relative)`.
2. If `!full.startsWith(this.rootResolved + path.sep) && full !== this.rootResolved`, throw `PathTraversalError`.
3. Return `full`.

Covers `../`, absolute paths, symlink shenanigans (resolve follows symlinks so the post-resolve check catches them if they escape).

### Setup-complete semantics
`isSetupComplete(db)` ≡ `hasAnyAdmin(db) && hasAnyProvider(db)`. Middleware:
- not complete → redirect to `/setup` (except `/setup` itself and public prefixes)
- complete + no session → redirect to `/login`
- complete + session → through

The `/setup` page renders:
1. If `!hasAnyAdmin(db)` → `<SetupForm />` (Phase 2 component, unchanged)
2. Else if `!hasAnyProvider(db)` → `<ProviderForm />` (new)
3. Else → `redirect("/")`

This way the user sees a single URL (`/setup`) with progressive state; no route hoops.

---

## File Structure

```
minifold/
  bin/
    cli.mjs                                   # MODIFIED: add-provider, list-providers, remove-provider
  src/
    proxy.ts                                  # MODIFIED: setup-complete check
    server/
      auth/
        encryption.ts                         # NEW: AES-GCM wrap/unwrap + key bootstrap
      db/
        settings.ts                           # NEW: getSetting, setSetting helpers
        providers.ts                          # NEW: CRUD (with encryption)
        migrations/
          003_providers.sql                   # NEW
      storage/
        types.ts                              # NEW: StorageProvider, Entry, PathTraversalError
        local.ts                              # NEW: LocalStorageProvider
        factory.ts                            # NEW: fromRow(row) → StorageProvider
    app/
      setup/
        page.tsx                              # MODIFIED: multi-step
        actions.ts                            # MODIFIED: add createFirstProvider action
    components/
      setup/
        ProviderForm.tsx                      # NEW: step-2 form
      shell/
        Sidebar.tsx                           # MODIFIED: list providers
  tests/
    server/
      auth/
        encryption.test.ts                    # NEW
      db/
        settings.test.ts                      # NEW
        providers.test.ts                     # NEW
        migrations.test.ts                    # EXTENDED: 003 case
      storage/
        local.test.ts                         # NEW
        factory.test.ts                       # NEW
    components/
      setup/
        ProviderForm.test.tsx                 # NEW
      shell/
        Sidebar.test.tsx                      # EXTENDED
    bin/
      cli.test.ts                             # EXTENDED: provider subcommands
```

---

## Task 1: Migration — providers table

**Files:**
- Create: `src/server/db/migrations/003_providers.sql`
- Modify: `tests/server/db/migrations.test.ts` (append a case)

- [ ] **Step 1: Write migration**

Create `src/server/db/migrations/003_providers.sql`:

```sql
CREATE TABLE providers (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  config      TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_providers_position ON providers(position);
```

Note: `created_at` isn't in the spec's data model but we add it so the CLI can show "added on" info without a schema change.

- [ ] **Step 2: Extend migrations test**

In `tests/server/db/migrations.test.ts`, inside the existing `describe("bundled migrations", …)`, append:

```ts
it("applies 003_providers and creates providers table", () => {
  const tmp = mkdtempSync(join(tmpdir(), "minifold-init-"));
  const db = createDatabase(join(tmp, "test.db"));
  cleanup = () => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  };

  const dir = resolve(process.cwd(), "src/server/db/migrations");
  runMigrations(db, dir);

  const cols = db.prepare("PRAGMA table_info(providers)").all() as Array<{
    name: string;
  }>;
  expect(cols.map((c) => c.name).sort()).toEqual(
    ["config", "created_at", "name", "position", "slug", "type"].sort(),
  );
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm test tests/server/db/migrations.test.ts
pnpm test
```

Expected: 3 passing migration cases; full suite 61 (Phase 2 ended at 60 + 1 new).

- [ ] **Step 4: Commit**

```bash
git add src/server/db/migrations/003_providers.sql tests/server/db/migrations.test.ts
git commit -m "feat(db): add providers table migration"
```

---

## Task 2: Settings repository (TDD)

**Files:**
- Create: `src/server/db/settings.ts` + `tests/server/db/settings.test.ts`

The `settings` table has existed since Foundation but we never wrote helpers for it. We need them now for encryption-key bootstrap.

- [ ] **Step 1: Write the failing test**

Create `tests/server/db/settings.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { getSetting, setSetting } from "@/server/db/settings";

let tmp: string;
let db: Database;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-settings-"));
  db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("settings repository", () => {
  it("getSetting returns null for a missing key", () => {
    expect(getSetting(db, "missing")).toBeNull();
  });

  it("setSetting + getSetting roundtrip", () => {
    setSetting(db, "theme", "dark");
    expect(getSetting(db, "theme")).toBe("dark");
  });

  it("setSetting overwrites an existing value", () => {
    setSetting(db, "theme", "dark");
    setSetting(db, "theme", "light");
    expect(getSetting(db, "theme")).toBe("light");
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/server/db/settings.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/server/db/settings.ts`:

```ts
import type { Database } from "better-sqlite3";

export function getSetting(db: Database, key: string): string | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}
```

- [ ] **Step 4: Run test + commit**

```bash
pnpm test tests/server/db/settings.test.ts
pnpm typecheck && pnpm lint
git add src/server/db/settings.ts tests/server/db/settings.test.ts
git commit -m "feat(db): add settings repository (get/set)"
```

---

## Task 3: Encryption helpers (TDD)

**Files:**
- Create: `src/server/auth/encryption.ts` + `tests/server/auth/encryption.test.ts`

AES-256-GCM with a 32-byte key lazily created in the `settings` table. Plaintext in / ciphertext out as a single string.

- [ ] **Step 1: Write the failing test**

Create `tests/server/auth/encryption.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { getSetting } from "@/server/db/settings";
import { decryptJSON, encryptJSON } from "@/server/auth/encryption";

let tmp: string;
let db: Database;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-enc-"));
  db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("encryption", () => {
  it("encrypt + decrypt roundtrip", () => {
    const plain = { secret: "hunter2", n: 42 };
    const cipher = encryptJSON(db, plain);
    expect(cipher).not.toContain("hunter2");
    expect(decryptJSON(db, cipher)).toEqual(plain);
  });

  it("generates and persists an encryption key on first use", () => {
    expect(getSetting(db, "config_encryption_key")).toBeNull();
    encryptJSON(db, { x: 1 });
    const key = getSetting(db, "config_encryption_key");
    expect(key).toMatch(/^[A-Za-z0-9+/=]{40,}$/); // base64
  });

  it("two encryptions of the same plaintext produce different ciphertexts (random IV)", () => {
    const a = encryptJSON(db, { x: 1 });
    const b = encryptJSON(db, { x: 1 });
    expect(a).not.toBe(b);
  });

  it("reuses the same key across calls", () => {
    const a = encryptJSON(db, { x: 1 });
    const keyAfterFirst = getSetting(db, "config_encryption_key");
    const b = encryptJSON(db, { x: 2 });
    const keyAfterSecond = getSetting(db, "config_encryption_key");
    expect(keyAfterFirst).toBe(keyAfterSecond);
    // And both decrypt with the same key.
    expect(decryptJSON(db, a)).toEqual({ x: 1 });
    expect(decryptJSON(db, b)).toEqual({ x: 2 });
  });

  it("decryptJSON throws on tampered ciphertext", () => {
    const cipher = encryptJSON(db, { x: 1 });
    // Flip a byte in the ciphertext segment (third colon-separated field).
    const parts = cipher.split(":");
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]!.replace(/^./, "0")}`;
    expect(() => decryptJSON(db, tampered)).toThrow();
  });

  it("decryptJSON throws on malformed input", () => {
    expect(() => decryptJSON(db, "not-a-valid-ciphertext")).toThrow();
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/server/auth/encryption.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/server/auth/encryption.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Database } from "better-sqlite3";
import { getSetting, setSetting } from "@/server/db/settings";

const KEY_SETTING = "config_encryption_key";
const ALGO = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits, GCM standard
const KEY_LENGTH = 32; // 256 bits

function loadOrCreateKey(db: Database): Buffer {
  const existing = getSetting(db, KEY_SETTING);
  if (existing) return Buffer.from(existing, "base64");

  const generated = randomBytes(KEY_LENGTH);
  const asB64 = generated.toString("base64");
  // INSERT OR IGNORE via setSetting's upsert — if another process created it first,
  // we still re-read to get the canonical value.
  setSetting(db, KEY_SETTING, asB64);
  const canonical = getSetting(db, KEY_SETTING);
  if (!canonical) throw new Error("encryption: failed to persist key");
  return Buffer.from(canonical, "base64");
}

export function encryptJSON(db: Database, plain: unknown): string {
  const key = loadOrCreateKey(db);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const json = Buffer.from(JSON.stringify(plain), "utf8");
  const enc = Buffer.concat([cipher.update(json), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptJSON<T = unknown>(db: Database, payload: string): T {
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("decryptJSON: malformed payload");
  const [ivHex, tagHex, encHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const enc = Buffer.from(encHex, "hex");
  if (iv.length !== IV_LENGTH) throw new Error("decryptJSON: bad IV length");

  const key = loadOrCreateKey(db);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString("utf8")) as T;
}
```

- [ ] **Step 4: Run + commit**

```bash
pnpm test tests/server/auth/encryption.test.ts
pnpm typecheck && pnpm lint
git add src/server/auth/encryption.ts tests/server/auth/encryption.test.ts
git commit -m "feat(auth): add AES-GCM config encryption with auto-generated key"
```

---

## Task 4: StorageProvider interface + Entry type

**Files:**
- Create: `src/server/storage/types.ts`

No tests — this file only exports types and a custom error class. Test coverage comes from the implementations in later tasks.

- [ ] **Step 1: Write the types**

Create `src/server/storage/types.ts`:

```ts
export type Entry = {
  name: string;
  type: "file" | "directory";
  size: number; // bytes; 0 for directories
  modifiedAt: Date;
  etag?: string; // S3 only; undefined for local FS
};

export interface StorageProvider {
  readonly slug: string;
  list(path: string): Promise<Entry[]>;
  stat(path: string): Promise<Entry>;
  read(path: string): Promise<ReadableStream<Uint8Array>>;
  write(path: string, data: Buffer): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export class PathTraversalError extends Error {
  constructor(attempted: string) {
    super(`Path escapes provider root: ${attempted}`);
    this.name = "PathTraversalError";
  }
}

export class NotFoundError extends Error {
  constructor(path: string) {
    super(`Not found: ${path}`);
    this.name = "NotFoundError";
  }
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/server/storage/types.ts
git commit -m "feat(storage): add StorageProvider interface + error types"
```

---

## Task 5: LocalStorageProvider (TDD)

**Files:**
- Create: `src/server/storage/local.ts` + `tests/server/storage/local.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/storage/local.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStorageProvider } from "@/server/storage/local";
import { NotFoundError, PathTraversalError } from "@/server/storage/types";

let root: string;
let provider: LocalStorageProvider;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "minifold-local-"));
  mkdirSync(join(root, "prints"));
  writeFileSync(join(root, "prints", "anchor.stl"), Buffer.from([0, 1, 2, 3]));
  writeFileSync(join(root, "hello.md"), "# hi");
  mkdirSync(join(root, "prints", "sub"));
  provider = new LocalStorageProvider({ slug: "local", rootPath: root });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("LocalStorageProvider.list", () => {
  it("lists immediate children of the root", async () => {
    const entries = await provider.list("");
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["hello.md", "prints"]);
    const file = entries.find((e) => e.name === "hello.md")!;
    expect(file.type).toBe("file");
    expect(file.size).toBeGreaterThan(0);
    const dir = entries.find((e) => e.name === "prints")!;
    expect(dir.type).toBe("directory");
    expect(dir.size).toBe(0);
  });

  it("lists a nested directory", async () => {
    const entries = await provider.list("prints");
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["anchor.stl", "sub"]);
  });

  it("throws NotFoundError for a missing directory", async () => {
    await expect(provider.list("does-not-exist")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("blocks path traversal via ..", async () => {
    await expect(provider.list("../../../etc")).rejects.toBeInstanceOf(
      PathTraversalError,
    );
  });

  it("blocks absolute path arguments", async () => {
    await expect(provider.list("/etc")).rejects.toBeInstanceOf(PathTraversalError);
  });
});

describe("LocalStorageProvider.stat", () => {
  it("returns file metadata", async () => {
    const entry = await provider.stat("hello.md");
    expect(entry.name).toBe("hello.md");
    expect(entry.type).toBe("file");
    expect(entry.size).toBe(4); // "# hi" is 4 bytes
    expect(entry.modifiedAt).toBeInstanceOf(Date);
  });

  it("returns directory metadata", async () => {
    const entry = await provider.stat("prints");
    expect(entry.type).toBe("directory");
    expect(entry.size).toBe(0);
  });

  it("throws NotFoundError for missing path", async () => {
    await expect(provider.stat("no-such-file")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("LocalStorageProvider.exists", () => {
  it("returns true for existing file", async () => {
    expect(await provider.exists("hello.md")).toBe(true);
  });
  it("returns true for existing directory", async () => {
    expect(await provider.exists("prints")).toBe(true);
  });
  it("returns false for missing path", async () => {
    expect(await provider.exists("nope")).toBe(false);
  });
  it("returns false on traversal attempts (no leak)", async () => {
    expect(await provider.exists("../etc/passwd")).toBe(false);
  });
});

describe("LocalStorageProvider.read + write", () => {
  it("write creates a file and read streams its content back", async () => {
    await provider.write("new.txt", Buffer.from("hello, world"));
    expect(await provider.exists("new.txt")).toBe(true);

    const stream = await provider.read("new.txt");
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const total = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    expect(total.toString("utf8")).toBe("hello, world");
  });

  it("write creates parent directories as needed", async () => {
    await provider.write("deep/nested/dir/file.txt", Buffer.from("ok"));
    expect(await provider.exists("deep/nested/dir/file.txt")).toBe(true);
  });

  it("write blocks traversal", async () => {
    await expect(
      provider.write("../outside.txt", Buffer.from("x")),
    ).rejects.toBeInstanceOf(PathTraversalError);
  });

  it("read throws NotFoundError for missing files", async () => {
    await expect(provider.read("missing.bin")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/server/storage/local.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/server/storage/local.ts`:

```ts
import {
  createReadStream,
  type Stats,
} from "node:fs";
import {
  mkdir,
  readdir,
  stat as statAsync,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import {
  NotFoundError,
  PathTraversalError,
  type Entry,
  type StorageProvider,
} from "./types";

type Options = {
  slug: string;
  rootPath: string;
};

export class LocalStorageProvider implements StorageProvider {
  readonly slug: string;
  private readonly rootPath: string;
  private readonly rootResolved: string;

  constructor(opts: Options) {
    this.slug = opts.slug;
    this.rootPath = opts.rootPath;
    this.rootResolved = resolve(opts.rootPath);
  }

  private resolveWithin(relative: string): string {
    const full = resolve(this.rootResolved, relative);
    if (full !== this.rootResolved && !full.startsWith(this.rootResolved + sep)) {
      throw new PathTraversalError(relative);
    }
    return full;
  }

  private static toEntry(name: string, stats: Stats): Entry {
    return {
      name,
      type: stats.isDirectory() ? "directory" : "file",
      size: stats.isDirectory() ? 0 : stats.size,
      modifiedAt: stats.mtime,
    };
  }

  async list(path: string): Promise<Entry[]> {
    const target = this.resolveWithin(path);
    let dirents;
    try {
      dirents = await readdir(target, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new NotFoundError(path);
      }
      throw err;
    }
    const entries: Entry[] = [];
    for (const d of dirents) {
      const childStats = await statAsync(resolve(target, d.name));
      entries.push(LocalStorageProvider.toEntry(d.name, childStats));
    }
    return entries;
  }

  async stat(path: string): Promise<Entry> {
    const target = this.resolveWithin(path);
    let stats;
    try {
      stats = await statAsync(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new NotFoundError(path);
      }
      throw err;
    }
    const name = target.slice(target.lastIndexOf(sep) + 1);
    return LocalStorageProvider.toEntry(name, stats);
  }

  async read(path: string): Promise<ReadableStream<Uint8Array>> {
    const target = this.resolveWithin(path);
    try {
      await statAsync(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new NotFoundError(path);
      }
      throw err;
    }
    const nodeStream = createReadStream(target);
    return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  }

  async write(path: string, data: Buffer): Promise<void> {
    const target = this.resolveWithin(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async exists(path: string): Promise<boolean> {
    try {
      const target = this.resolveWithin(path);
      await statAsync(target);
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: Run test**

```bash
pnpm test tests/server/storage/local.test.ts
```

Expected: all passing (~14 test cases).

- [ ] **Step 5: Run sweep + commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add src/server/storage/local.ts tests/server/storage/local.test.ts
git commit -m "feat(storage): add LocalStorageProvider with path-traversal defense"
```

---

## Task 6: Providers repository (TDD)

**Files:**
- Create: `src/server/db/providers.ts` + `tests/server/db/providers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/db/providers.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import {
  createProvider,
  deleteProvider,
  findProviderBySlug,
  hasAnyProvider,
  listProviders,
  updateProviderPosition,
  type ProviderRow,
} from "@/server/db/providers";

let tmp: string;
let db: Database;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-providers-"));
  db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("providers repository", () => {
  it("hasAnyProvider false on empty DB", () => {
    expect(hasAnyProvider(db)).toBe(false);
  });

  it("createProvider inserts and findProviderBySlug retrieves (config decrypted)", () => {
    const row: ProviderRow = createProvider(db, {
      slug: "nas",
      name: "NAS",
      type: "local",
      config: { rootPath: "/files" },
    });
    expect(row.slug).toBe("nas");
    expect(row.name).toBe("NAS");
    expect(row.type).toBe("local");
    expect(row.config).toEqual({ rootPath: "/files" });
    expect(row.position).toBe(0);

    const found = findProviderBySlug(db, "nas");
    expect(found?.config).toEqual({ rootPath: "/files" });
  });

  it("findProviderBySlug returns null for unknown slug", () => {
    expect(findProviderBySlug(db, "missing")).toBeNull();
  });

  it("config is stored encrypted (raw DB bytes do not contain plaintext)", () => {
    createProvider(db, {
      slug: "nas",
      name: "NAS",
      type: "local",
      config: { rootPath: "/files", secretFlag: "plaintext-marker-xyz" },
    });
    const raw = db
      .prepare("SELECT config FROM providers WHERE slug = ?")
      .get("nas") as { config: string };
    expect(raw.config).not.toContain("plaintext-marker-xyz");
    expect(raw.config).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it("listProviders returns providers sorted by position", () => {
    createProvider(db, { slug: "a", name: "A", type: "local", config: { rootPath: "/a" } });
    createProvider(db, { slug: "b", name: "B", type: "local", config: { rootPath: "/b" } });
    createProvider(db, { slug: "c", name: "C", type: "local", config: { rootPath: "/c" } });
    updateProviderPosition(db, "b", 0);
    updateProviderPosition(db, "a", 1);
    updateProviderPosition(db, "c", 2);
    const list = listProviders(db);
    expect(list.map((p) => p.slug)).toEqual(["b", "a", "c"]);
  });

  it("hasAnyProvider returns true once one exists", () => {
    expect(hasAnyProvider(db)).toBe(false);
    createProvider(db, {
      slug: "nas",
      name: "NAS",
      type: "local",
      config: { rootPath: "/files" },
    });
    expect(hasAnyProvider(db)).toBe(true);
  });

  it("deleteProvider removes it", () => {
    createProvider(db, {
      slug: "nas",
      name: "NAS",
      type: "local",
      config: { rootPath: "/files" },
    });
    deleteProvider(db, "nas");
    expect(findProviderBySlug(db, "nas")).toBeNull();
    expect(hasAnyProvider(db)).toBe(false);
  });

  it("createProvider rejects duplicate slug", () => {
    createProvider(db, { slug: "a", name: "A", type: "local", config: { rootPath: "/a" } });
    expect(() =>
      createProvider(db, { slug: "a", name: "A2", type: "local", config: { rootPath: "/b" } }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/server/db/providers.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/server/db/providers.ts`:

```ts
import type { Database } from "better-sqlite3";
import { decryptJSON, encryptJSON } from "@/server/auth/encryption";

export type ProviderType = "local" | "s3";

export type LocalConfig = {
  rootPath: string;
};

export type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  pathStyle: boolean;
};

export type ProviderConfig = LocalConfig | S3Config;

export type ProviderRow = {
  slug: string;
  name: string;
  type: ProviderType;
  config: ProviderConfig;
  position: number;
  created_at: number;
};

type RawRow = Omit<ProviderRow, "config"> & { config: string };

export type NewProvider = {
  slug: string;
  name: string;
  type: ProviderType;
  config: ProviderConfig;
};

function decodeRow(db: Database, raw: RawRow): ProviderRow {
  return {
    ...raw,
    config: decryptJSON<ProviderConfig>(db, raw.config),
  };
}

export function hasAnyProvider(db: Database): boolean {
  return (
    db.prepare("SELECT 1 FROM providers LIMIT 1").get() !== undefined
  );
}

export function createProvider(db: Database, input: NewProvider): ProviderRow {
  const slug = input.slug.toLowerCase();
  const encrypted = encryptJSON(db, input.config);
  const now = Date.now();
  db.prepare(
    `INSERT INTO providers (slug, name, type, config, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(slug, input.name, input.type, encrypted, 0, now);
  const found = findProviderBySlug(db, slug);
  if (!found) throw new Error("createProvider: inserted row not found");
  return found;
}

export function findProviderBySlug(db: Database, slug: string): ProviderRow | null {
  const raw = db
    .prepare("SELECT * FROM providers WHERE slug = ?")
    .get(slug.toLowerCase()) as RawRow | undefined;
  return raw ? decodeRow(db, raw) : null;
}

export function listProviders(db: Database): ProviderRow[] {
  const rows = db
    .prepare("SELECT * FROM providers ORDER BY position ASC, created_at ASC")
    .all() as RawRow[];
  return rows.map((r) => decodeRow(db, r));
}

export function updateProviderPosition(
  db: Database,
  slug: string,
  position: number,
): void {
  db.prepare("UPDATE providers SET position = ? WHERE slug = ?").run(position, slug);
}

export function deleteProvider(db: Database, slug: string): void {
  db.prepare("DELETE FROM providers WHERE slug = ?").run(slug);
}
```

- [ ] **Step 4: Run + commit**

```bash
pnpm test tests/server/db/providers.test.ts
pnpm typecheck && pnpm lint
git add src/server/db/providers.ts tests/server/db/providers.test.ts
git commit -m "feat(db): add providers repository with encrypted config"
```

---

## Task 7: Provider factory (TDD)

**Files:**
- Create: `src/server/storage/factory.ts` + `tests/server/storage/factory.test.ts`

The factory takes a decoded `ProviderRow` and returns the right `StorageProvider` instance. For Phase 3, only `local` is implemented; `s3` throws `NotImplementedError` (to be replaced in Phase 3.5).

- [ ] **Step 1: Write the failing test**

Create `tests/server/storage/factory.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { providerFromRow } from "@/server/storage/factory";
import { LocalStorageProvider } from "@/server/storage/local";

describe("providerFromRow", () => {
  it("returns a LocalStorageProvider for type=local", () => {
    const p = providerFromRow({
      slug: "nas",
      name: "NAS",
      type: "local",
      config: { rootPath: "/tmp" },
      position: 0,
      created_at: Date.now(),
    });
    expect(p).toBeInstanceOf(LocalStorageProvider);
    expect(p.slug).toBe("nas");
  });

  it("throws for type=s3 in Phase 3", () => {
    expect(() =>
      providerFromRow({
        slug: "s3",
        name: "S3",
        type: "s3",
        config: {
          endpoint: "https://s3.example.com",
          bucket: "x",
          region: "us-east-1",
          accessKeyId: "a",
          secretAccessKey: "b",
          pathStyle: true,
        },
        position: 0,
        created_at: Date.now(),
      }),
    ).toThrow(/s3 provider not yet implemented/i);
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/server/storage/factory.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `src/server/storage/factory.ts`:

```ts
import type { ProviderRow } from "@/server/db/providers";
import { LocalStorageProvider } from "./local";
import type { StorageProvider } from "./types";

export function providerFromRow(row: ProviderRow): StorageProvider {
  switch (row.type) {
    case "local":
      return new LocalStorageProvider({
        slug: row.slug,
        rootPath: (row.config as { rootPath: string }).rootPath,
      });
    case "s3":
      throw new Error("s3 provider not yet implemented (Phase 3.5)");
    default: {
      const exhaustive: never = row.type;
      throw new Error(`Unknown provider type: ${String(exhaustive)}`);
    }
  }
}
```

- [ ] **Step 4: Run + commit**

```bash
pnpm test tests/server/storage/factory.test.ts
pnpm typecheck && pnpm lint
git add src/server/storage/factory.ts tests/server/storage/factory.test.ts
git commit -m "feat(storage): add provider factory (local only; s3 in Phase 3.5)"
```

---

## Task 8: Wizard step 2 — ProviderForm + action + multi-step page

**Files:**
- Create: `src/components/setup/ProviderForm.tsx` + test
- Modify: `src/app/setup/actions.ts`, `src/app/setup/page.tsx`

- [ ] **Step 1: Write the failing form test**

Create `tests/components/setup/ProviderForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ProviderForm } from "@/components/setup/ProviderForm";

vi.mock("@/app/setup/actions", () => ({
  createFirstProvider: vi.fn(async () => ({})),
}));

describe("ProviderForm", () => {
  it("renders slug, name, rootPath fields + submit", () => {
    render(<ProviderForm />);
    expect(screen.getByLabelText(/slug/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/root path/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add provider/i }),
    ).toBeInTheDocument();
  });

  it("submits form values", async () => {
    const { createFirstProvider } = await import("@/app/setup/actions");
    render(<ProviderForm />);
    await userEvent.type(screen.getByLabelText(/slug/i), "nas");
    await userEvent.type(screen.getByLabelText(/^name$/i), "NAS Files");
    await userEvent.type(screen.getByLabelText(/root path/i), "/files");
    await userEvent.click(screen.getByRole("button", { name: /add provider/i }));
    expect(createFirstProvider).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/components/setup/ProviderForm.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Extend setup actions**

Modify `src/app/setup/actions.ts` — append (keep the existing `createAdmin` action):

```ts
// ... (existing imports at top)
import { createProvider, hasAnyProvider } from "@/server/db/providers";

// ... (existing createAdmin + schema)

const providerSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,32}$/i, "Slug: 1-32 chars, letters/digits/- only"),
  name: z.string().trim().min(1, "Name is required").max(200),
  rootPath: z.string().trim().min(1, "Root path is required"),
});

export type ProviderFormState = {
  error?: string;
  fieldErrors?: Partial<Record<"slug" | "name" | "rootPath", string>>;
};

export async function createFirstProvider(
  _prev: ProviderFormState,
  formData: FormData,
): Promise<ProviderFormState> {
  const db = getDatabase();
  if (hasAnyProvider(db)) {
    return { error: "A provider already exists." };
  }

  const parsed = providerSchema.safeParse({
    slug: formData.get("slug"),
    name: formData.get("name"),
    rootPath: formData.get("rootPath"),
  });
  if (!parsed.success) {
    const fieldErrors: ProviderFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as "slug" | "name" | "rootPath";
      fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }

  createProvider(db, {
    slug: parsed.data.slug,
    name: parsed.data.name,
    type: "local",
    config: { rootPath: parsed.data.rootPath },
  });

  redirect("/");
}
```

- [ ] **Step 4: Write the form component**

Create `src/components/setup/ProviderForm.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import {
  createFirstProvider,
  type ProviderFormState,
} from "@/app/setup/actions";

const initialState: ProviderFormState = {};

export function ProviderForm() {
  const [state, action, pending] = useActionState(createFirstProvider, initialState);

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span>Slug</span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          URL-safe identifier, e.g. &quot;nas&quot; — becomes the first URL segment.
        </span>
        <input
          name="slug"
          type="text"
          required
          className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.slug && (
          <span className="text-xs text-red-600">{state.fieldErrors.slug}</span>
        )}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>Name</span>
        <input
          name="name"
          type="text"
          required
          className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.name && (
          <span className="text-xs text-red-600">{state.fieldErrors.name}</span>
        )}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span>Root path</span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          Absolute path inside the container, e.g. <code>/files</code>.
        </span>
        <input
          name="rootPath"
          type="text"
          required
          defaultValue="/files"
          className="rounded border border-neutral-300 bg-white px-3 py-2 font-mono dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.rootPath && (
          <span className="text-xs text-red-600">{state.fieldErrors.rootPath}</span>
        )}
      </label>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {pending ? "Adding…" : "Add provider"}
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Update the setup page for multi-step**

Replace `src/app/setup/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getDatabase } from "@/server/db";
import { hasAnyAdmin } from "@/server/db/users";
import { hasAnyProvider } from "@/server/db/providers";
import { SetupForm } from "@/components/auth/SetupForm";
import { ProviderForm } from "@/components/setup/ProviderForm";

export default function SetupPage() {
  const db = getDatabase();
  const adminExists = hasAnyAdmin(db);
  const providerExists = hasAnyProvider(db);

  if (adminExists && providerExists) {
    redirect("/");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      {!adminExists ? (
        <>
          <h1 className="mb-1 text-2xl font-semibold">Welcome to Minifold</h1>
          <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-400">
            Step 1 of 2 — create your admin account.
          </p>
          <SetupForm />
        </>
      ) : (
        <>
          <h1 className="mb-1 text-2xl font-semibold">Add your first files</h1>
          <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-400">
            Step 2 of 2 — point Minifold at a folder on this host.
          </p>
          <ProviderForm />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run tests**

```bash
pnpm test tests/components/setup/ProviderForm.test.tsx
pnpm test
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/app/setup src/components/setup tests/components/setup
git commit -m "feat(setup): add wizard step 2 (create first local provider)"
```

---

## Task 9: Middleware update — setup complete = admin + provider

**Files:**
- Modify: `src/proxy.ts`

- [ ] **Step 1: Replace the adminExists check**

Open `src/proxy.ts`. Replace the `hasAnyAdmin` import + usage with an `isSetupComplete` helper. Full updated file:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { getDatabase } from "@/server/db";
import { hasAnyAdmin } from "@/server/db/users";
import { hasAnyProvider } from "@/server/db/providers";
import { validateSession } from "@/server/auth/session";
import { SESSION_COOKIE } from "@/server/auth/cookies";

const PUBLIC_PREFIXES = ["/_next", "/favicon.ico"];

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const db = getDatabase();
  const setupComplete = hasAnyAdmin(db) && hasAnyProvider(db);

  if (!setupComplete) {
    if (pathname === "/setup") return NextResponse.next();
    return NextResponse.redirect(new URL("/setup", req.url));
  }

  if (pathname === "/setup") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? validateSession(db, token) : null;

  if (!session) {
    if (pathname === "/login") return NextResponse.next();
    const loginUrl = new URL("/login", req.url);
    if (pathname !== "/") loginUrl.searchParams.set("callbackUrl", pathname);
    const res = NextResponse.redirect(loginUrl);
    if (token) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  if (pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
```

- [ ] **Step 2: Verify + commit**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add src/proxy.ts
git commit -m "feat(proxy): treat setup as incomplete until provider exists"
```

---

## Task 10: Sidebar — list providers

**Files:**
- Modify: `src/components/shell/Sidebar.tsx` + `tests/components/shell/Sidebar.test.tsx`

- [ ] **Step 1: Update Sidebar**

Replace `src/components/shell/Sidebar.tsx`:

```tsx
import Link from "next/link";
import { getCurrentUser } from "@/server/auth/current-user";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { getDatabase } from "@/server/db";
import { listProviders } from "@/server/db/providers";

export async function Sidebar() {
  const user = await getCurrentUser();
  const providers = user ? listProviders(getDatabase()) : [];

  return (
    <aside className="flex h-full w-64 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex h-14 items-center px-4 text-lg font-semibold">
        Minifold
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {providers.length > 0 && (
          <div>
            <div className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              Providers
            </div>
            <ul className="flex flex-col">
              {providers.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/${p.slug}`}
                    className="block rounded px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>
      <div className="flex flex-col gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
        {user && (
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            Signed in as <span className="font-medium">{user.name}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <Link
            href="/admin"
            className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            Admin
          </Link>
          {user && <SignOutButton />}
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Update the Sidebar test**

Replace `tests/components/shell/Sidebar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Sidebar } from "@/components/shell/Sidebar";

vi.mock("@/server/auth/current-user", () => ({
  getCurrentUser: vi.fn(async () => null),
}));
vi.mock("@/app/logout/actions", () => ({ logout: vi.fn() }));
vi.mock("@/server/db", () => ({ getDatabase: vi.fn(() => ({})) }));
vi.mock("@/server/db/providers", () => ({ listProviders: vi.fn(() => []) }));

describe("Sidebar", () => {
  it("renders the app name", async () => {
    const node = await Sidebar();
    render(node);
    expect(screen.getByText("Minifold")).toBeInTheDocument();
  });

  it("has an admin link", async () => {
    const node = await Sidebar();
    render(node);
    expect(screen.getByRole("link", { name: /admin/i })).toBeInTheDocument();
  });

  it("shows 'Signed in as' when a session exists", async () => {
    const { getCurrentUser } = await import("@/server/auth/current-user");
    vi.mocked(getCurrentUser).mockResolvedValueOnce({
      id: "u1",
      name: "Jane",
      username: "jane",
      password: "$hash",
      role: "admin",
      must_change_password: 0,
      deactivated: 0,
      created_at: Date.now(),
      last_login: null,
    });
    const node = await Sidebar();
    render(node);
    expect(screen.getByText(/signed in as/i)).toBeInTheDocument();
    expect(screen.getByText("Jane")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("lists providers when a session exists", async () => {
    const { getCurrentUser } = await import("@/server/auth/current-user");
    const { listProviders } = await import("@/server/db/providers");
    vi.mocked(getCurrentUser).mockResolvedValueOnce({
      id: "u1",
      name: "Jane",
      username: "jane",
      password: "$hash",
      role: "admin",
      must_change_password: 0,
      deactivated: 0,
      created_at: Date.now(),
      last_login: null,
    });
    vi.mocked(listProviders).mockReturnValueOnce([
      {
        slug: "nas",
        name: "NAS Files",
        type: "local",
        config: { rootPath: "/files" },
        position: 0,
        created_at: Date.now(),
      },
    ]);
    const node = await Sidebar();
    render(node);
    expect(screen.getByRole("link", { name: /nas files/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run tests + commit**

```bash
pnpm test tests/components/shell/Sidebar.test.tsx
pnpm typecheck && pnpm lint && pnpm test
git add src/components/shell/Sidebar.tsx tests/components/shell/Sidebar.test.tsx
git commit -m "feat(shell): list providers in sidebar"
```

---

## Task 11: CLI — provider subcommands

**Files:**
- Modify: `bin/cli.mjs`
- Modify: `tests/bin/cli.test.ts`

Three new commands:
- `list-providers` — print a table of providers
- `add-provider --slug <s> --name <n> --root-path <p>` — creates a local provider (only type supported in Phase 3)
- `remove-provider --slug <s>` — deletes by slug

- [ ] **Step 1: Extend the test file**

In `tests/bin/cli.test.ts`, add a new `describe` block at the end of the file (before the final closing `});`):

```ts
describe("minifold CLI — providers", () => {
  it("list-providers prints an empty notice when none exist", () => {
    const r = run(["list-providers"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no providers/i);
  });

  it("add-provider creates a local provider and list-providers shows it", () => {
    const added = run([
      "add-provider",
      "--slug",
      "nas",
      "--name",
      "NAS",
      "--root-path",
      "/files",
    ]);
    expect(added.status).toBe(0);
    expect(added.stdout).toMatch(/added provider/i);

    const listed = run(["list-providers"]);
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain("nas");
    expect(listed.stdout).toContain("NAS");
    expect(listed.stdout).toContain("local");
  });

  it("add-provider --slug is required", () => {
    const r = run(["add-provider", "--name", "x", "--root-path", "/x"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain("--slug");
  });

  it("add-provider rejects invalid slugs", () => {
    const r = run([
      "add-provider",
      "--slug",
      "Bad Slug!",
      "--name",
      "x",
      "--root-path",
      "/x",
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain("slug");
  });

  it("add-provider rejects duplicate slug", () => {
    run(["add-provider", "--slug", "nas", "--name", "NAS", "--root-path", "/files"]);
    const second = run([
      "add-provider",
      "--slug",
      "nas",
      "--name",
      "NAS2",
      "--root-path",
      "/other",
    ]);
    expect(second.status).not.toBe(0);
    expect(second.stderr.toLowerCase()).toMatch(/exists|unique/);
  });

  it("remove-provider deletes it", () => {
    run(["add-provider", "--slug", "nas", "--name", "NAS", "--root-path", "/files"]);
    const removed = run(["remove-provider", "--slug", "nas"]);
    expect(removed.status).toBe(0);
    expect(run(["list-providers"]).stdout).toMatch(/no providers/i);
  });

  it("remove-provider on unknown slug fails", () => {
    const r = run(["remove-provider", "--slug", "nope"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain("no such provider");
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/bin/cli.test.ts
```

Expected: the new cases fail; existing ones still pass.

- [ ] **Step 3: Add encryption + provider logic to the CLI**

The CLI must now use AES-GCM encryption to store configs. To keep `bin/cli.mjs` dependency-free from TypeScript app code, inline the encryption helpers.

Edit `bin/cli.mjs`. After the existing `runMigrations` helper (near the top), add:

```js
import {
  createCipheriv,
  createDecipheriv,
  // randomBytes already imported above — do not re-import
} from "node:crypto";

const SLUG_RE = /^[a-z0-9-]{1,32}$/i;
const KEY_SETTING = "config_encryption_key";

function getSetting(db, key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row?.value ?? null;
}

function setSetting(db, key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

function loadOrCreateKey(db) {
  const existing = getSetting(db, KEY_SETTING);
  if (existing) return Buffer.from(existing, "base64");
  const generated = randomBytes(32);
  setSetting(db, KEY_SETTING, generated.toString("base64"));
  return generated;
}

function encryptJSON(db, plain) {
  const key = loadOrCreateKey(db);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(plain), "utf8")),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${enc.toString("hex")}`;
}

function decryptJSON(db, payload) {
  const [ivHex, tagHex, encHex] = payload.split(":");
  if (!ivHex || !tagHex || !encHex) throw new Error("decryptJSON: malformed");
  const key = loadOrCreateKey(db);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encHex, "hex")),
    decipher.final(),
  ]);
  return JSON.parse(dec.toString("utf8"));
}
```

(`randomBytes` is already imported at the top of the existing file; only add the `createCipheriv` + `createDecipheriv` imports if they're missing.)

Now add the three provider commands. After the existing `cmdDeleteUser` function, append:

```js
function cmdListProviders(db) {
  const rows = db
    .prepare("SELECT slug, name, type, position, created_at FROM providers ORDER BY position, created_at")
    .all();
  if (rows.length === 0) {
    console.log("No providers.");
    return 0;
  }
  console.log(["SLUG", "NAME", "TYPE", "POSITION", "CREATED"].join("\t"));
  for (const r of rows) {
    console.log(
      [
        r.slug,
        r.name,
        r.type,
        r.position,
        new Date(r.created_at).toISOString(),
      ].join("\t"),
    );
  }
  return 0;
}

function cmdAddProvider(db, flags) {
  if (!flags.slug) {
    console.error("--slug is required");
    return 2;
  }
  if (!SLUG_RE.test(flags.slug)) {
    console.error("--slug must match /^[a-z0-9-]{1,32}$/i");
    return 2;
  }
  if (!flags.name) {
    console.error("--name is required");
    return 2;
  }
  if (!flags["root-path"]) {
    console.error("--root-path is required");
    return 2;
  }
  const slug = flags.slug.toLowerCase();
  const existing = db
    .prepare("SELECT 1 FROM providers WHERE slug = ?")
    .get(slug);
  if (existing) {
    console.error(`Provider slug already exists: ${slug}`);
    return 1;
  }
  const encrypted = encryptJSON(db, { rootPath: flags["root-path"] });
  const now = Date.now();
  db.prepare(
    `INSERT INTO providers (slug, name, type, config, position, created_at)
     VALUES (?, ?, 'local', ?, 0, ?)`,
  ).run(slug, flags.name, encrypted, now);
  console.log(`Added provider ${slug} (${flags.name}) → ${flags["root-path"]}`);
  return 0;
}

function cmdRemoveProvider(db, slug) {
  if (!slug) {
    console.error("--slug is required");
    return 2;
  }
  const found = db
    .prepare("SELECT 1 FROM providers WHERE slug = ?")
    .get(slug.toLowerCase());
  if (!found) {
    console.error(`No such provider: ${slug}`);
    return 1;
  }
  db.prepare("DELETE FROM providers WHERE slug = ?").run(slug.toLowerCase());
  console.log(`Removed provider ${slug}.`);
  return 0;
}
```

Update the `usage()` help text to mention the new commands:

```js
function usage() {
  console.log(`minifold — admin CLI

User commands:
  list-users                              List all users.
  reset-admin   --username <name>         Reset the password for an admin user (creates one if missing).
  promote       --username <name>         Promote a user to admin.
  demote        --username <name>         Demote an admin to user (refuses if last admin).
  delete-user   --username <name>         Delete a user (refuses if last admin).

Provider commands:
  list-providers                          List configured storage providers.
  add-provider  --slug <s> --name <n> --root-path <p>
                                          Add a local-FS provider.
  remove-provider --slug <s>              Remove a provider.

Environment:
  DATABASE_PATH   Path to the SQLite DB. Defaults to /app/data/minifold.db in the image,
                  or ./data/minifold.db locally.
`);
}
```

Update the `switch` in `main()` to handle the new commands:

```js
      case "list-providers":
        return cmdListProviders(db);
      case "add-provider":
        return cmdAddProvider(db, flags);
      case "remove-provider":
        return cmdRemoveProvider(db, flags.slug);
```

Insert those three cases alongside the existing ones.

- [ ] **Step 4: Run tests**

```bash
pnpm test tests/bin/cli.test.ts
pnpm typecheck && pnpm lint && pnpm test
```

Expected: CLI tests 10 + 7 new = 17 passing. Full suite green.

- [ ] **Step 5: Commit**

```bash
git add bin/cli.mjs tests/bin/cli.test.ts
git commit -m "feat(cli): add provider subcommands (list/add/remove)"
```

---

## Task 12: Final verification + manual deploy

- [ ] **Step 1: Local gauntlet**

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all green.

- [ ] **Step 2: Local Docker smoke test**

```bash
docker build -t minifold:phase3 .

# Fresh volume (no admin, no provider)
docker run -d --rm --name mf-p3 -p 3000:3000 -v mf-p3-data:/app/data -v mf-p3-files:/files minifold:phase3
sleep 5

# Unauthenticated GET / should 307 to /setup
curl -si http://localhost:3000/ | grep -i "^location:"
# Expected: location: /setup

# The CLI still works
docker exec mf-p3 minifold list-users
docker exec mf-p3 minifold list-providers
# Expected: "No users." and "No providers."

# CLI can seed an admin + provider
docker exec mf-p3 minifold reset-admin --username admin
docker exec mf-p3 minifold add-provider --slug local --name "Local Files" --root-path /files

# Setup should now be complete — GET / redirects to /login
curl -si http://localhost:3000/ | grep -i "^location:"
# Expected: location: /login?callbackUrl=/   (or just /login)

docker stop mf-p3
docker volume rm mf-p3-data mf-p3-files
```

If any step fails, stop and debug before pushing.

- [ ] **Step 3: Push + watch CI**

```bash
git push origin main
gh run watch --exit-status
```

Expected: verify + publish both green.

- [ ] **Step 4: Add a `/files` volume to Coolify**

The test instance needs a writable host path for the local provider. Add a second persistent volume:

```bash
coolify app storage create --help   # confirm flags
coolify app storage create kl2kjsmt42md6ct7zt4g9wsk \
  --type persistent --name minifold-files --mount-path /files
```

- [ ] **Step 5: Manual Coolify deploy**

```bash
coolify deploy uuid kl2kjsmt42md6ct7zt4g9wsk
for i in {1..18}; do
  s=$(coolify app get kl2kjsmt42md6ct7zt4g9wsk --format json | jq -r .status)
  echo "[$i] $s"
  [[ "$s" == "running:healthy" ]] && break
  sleep 5
done
```

- [ ] **Step 6: Live smoke test**

The live instance's volume already has the Phase 2 admin (if you created one when testing Phase 2). Possible states:
- **Admin exists, no provider**: `/` redirects to `/setup`; `/setup` shows **step 2** (provider form).
- **No admin, no provider** (fresh volume): `/` redirects to `/setup`; `/setup` shows step 1 (admin form).

```bash
APP_URL=https://minifold.apps.janjaap.de
curl -si "$APP_URL/" | grep -i "^location:"
# Expected: /setup

curl -s "$APP_URL/setup" | grep -Eo "Step 1 of 2|Step 2 of 2" | head -1
# Shows whichever step is next.
```

Then tell the user to visit `https://minifold.apps.janjaap.de/setup` and finish the wizard. If they're stuck on step 2 because no writable `/files` was mounted until just now, the CLI recovery path works too:

```bash
# Find the running container and invoke the CLI. Coolify doesn't expose `app exec`,
# so the operator SSHes to the netcup box:
#   ssh netcup 'docker exec $(docker ps --format "{{.Names}}" | grep minifold-test) \
#     minifold add-provider --slug local --name "Local Files" --root-path /files'
```

---

## Phase 3 exit criteria

- ✅ `pnpm test` passes with the new tests (settings, encryption, providers repo, local storage, factory, provider form, sidebar expanded, CLI expanded).
- ✅ `pnpm typecheck` + `pnpm lint` clean.
- ✅ `pnpm build` emits a working standalone build.
- ✅ Docker image builds; `minifold list-providers` and `add-provider` both work via `docker exec`.
- ✅ Live URL: unauthenticated GET `/` redirects to `/setup`. `/setup` shows step 1 when no admin, step 2 when admin exists but no provider. After both, redirects to `/` → `/login`.
- ✅ Providers appear in the sidebar once a session exists.
- ✅ `providers.config` is stored encrypted; raw DB dump does NOT contain plaintext config.

---

## Self-Review

**Spec coverage (Phase 3 scope only):**
- §3 Setup Wizard step 2 (first provider) — Tasks 8, 9.
- §4 `StorageProvider` interface — Task 4.
- §4 `Entry` type — Task 4.
- §4 Local implementation — Task 5.
- §4 S3 implementation — explicitly deferred to Phase 3.5.
- §4 Multiple providers, slug/name/type/config, AES-encrypted config — Tasks 1, 3, 6.
- §4 Providers as top-level sidebar roots — Task 10.
- §4 URL ↔ path mapping (`/{slug}/{path}`) — Task 10 links; the routes that consume those URLs are Phase 4's responsibility, explicitly out of scope.
- §15 `providers` table (slug/name/type/config/position) — Task 1 migration; `created_at` added for CLI UX.

**Placeholder scan:** every step has complete code or concrete commands. No TBDs, no "handle edge cases", no "similar to". ✅

**Type consistency:**
- `ProviderRow`, `ProviderType`, `NewProvider`, `LocalConfig`, `S3Config`, `ProviderConfig` defined in Task 6 and used in Tasks 7, 8, 10.
- `StorageProvider`, `Entry`, `PathTraversalError`, `NotFoundError` defined in Task 4 and used in Tasks 5, 7.
- `SetupFormState` (existing) and new `ProviderFormState` kept distinct — Task 8.
- `createFirstProvider` action signature matches the form's `useActionState` consumer (Task 8).
- CLI subcommands: `list-providers`, `add-provider`, `remove-provider` match across test (Task 11 step 1), implementation (Task 11 step 3), and usage() help text (Task 11 step 3).
