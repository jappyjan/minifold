# Phase 2 — Auth + Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-04-23-minifold-design.md](../specs/2026-04-23-minifold-design.md) §3 (First-Time Setup Wizard), §9 (Authentication & User Management), §15 (Data Model).

**Goal:** A fresh Minifold deployment intercepts all requests and serves a setup wizard that creates the first admin. After that, users can log in, receive a DB-backed session cookie, and are signed out cleanly via logout or by an admin revoking their session. Any authenticated request extends the session's expiry, rolling it forward for 30 days. An admin CLI bundled in the image lets operators recover access (reset password, promote/demote, list users) via `docker exec` without touching SQL.

**Architecture:** No NextAuth. We roll a minimal, proper session layer: on login, a cryptographically-random 32-byte token is generated. The SHA-256 of that token is stored in a `sessions` table alongside `user_id`, `expires_at`, `created_at`, `last_seen_at`. The raw token is set as an `httpOnly`, `SameSite=Lax`, `Secure` (prod) cookie on the client. On every request, middleware reads the cookie, hashes it, looks up the session, checks expiry, loads the user, extends the session if the last-seen-at is older than 1 hour. Logout deletes the row. Changing a password or deleting a user deletes all their sessions. Passwords are hashed with `bcryptjs` (pure JS — no native build). The admin CLI is a small Node script at `bin/cli.mjs`, bundled into the Docker image and wrapped by a `/usr/local/bin/minifold` shim, so operators run `minifold reset-admin --email …` inside the container.

**Tech Stack:**
- `bcryptjs@^2` + `@types/bcryptjs` — password hashing
- `zod` — input validation for forms and CLI arguments
- Node built-ins — `crypto.randomBytes`, `crypto.createHash`
- `next/headers` `cookies()` + `NextRequest.cookies` in middleware
- Vitest for unit tests, plus an integration test for the CLI invoked as a child process
- Existing stack: Next 16 App Router, TypeScript, better-sqlite3, tRPC v11

**Out of scope (future phases):**
- Wizard step 2 (create first storage provider) → Phase 3
- Wizard step 3 (set global access default) → Phase 8
- Admin UI for user management + session revocation UI → Phase 8 (the DB plumbing ships here; the UI on top lives there)
- Forced password change flow on first login — the `must_change_password` column ships here and is used by the CLI's `reset-admin`, but the user-facing redirect-to-change-password flow ships alongside the admin-creates-user UI in Phase 8
- OIDC/OAuth providers — future. The session layer is provider-agnostic; adding OIDC later means adding a second login path that still produces a session row.

---

## File Structure

```
minifold/
  bin/
    cli.mjs                                # admin CLI entry point
  src/
    middleware.ts                          # cookie read → session validate → route gating
    server/
      auth/
        password.ts                        # bcryptjs hash/verify
        session.ts                         # pure session logic (create/validate/destroy)
        cookies.ts                         # next/headers cookie helpers (server actions)
        current-user.ts                    # getCurrentUser() for server components
      db/
        users.ts                           # user CRUD
        sessions.ts                        # session CRUD (row-level)
        migrations/
          002_auth.sql                     # users + sessions tables
    app/
      setup/
        page.tsx
        actions.ts
      login/
        page.tsx
        actions.ts
      logout/
        actions.ts
    components/
      auth/
        SetupForm.tsx
        LoginForm.tsx
        SignOutButton.tsx
      shell/
        Sidebar.tsx                        # MODIFIED: session-aware
  tests/
    server/
      auth/
        password.test.ts
        session.test.ts
      db/
        users.test.ts
        sessions.test.ts
    components/
      auth/
        SetupForm.test.tsx
        LoginForm.test.tsx
    bin/
      cli.test.ts                          # spawns the CLI and asserts output
```

---

## Task 1: Install auth dependencies

**Files:** Modify `package.json` via `pnpm add`.

- [ ] **Step 1: Install runtime + dev deps**

```bash
pnpm add bcryptjs@^2 zod@^3
pnpm add -D @types/bcryptjs
```

No `next-auth`. Session layer is hand-rolled.

- [ ] **Step 2: Verify clean baseline**

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all green. No code changes yet.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat: add bcryptjs + zod for custom auth layer"
```

---

## Task 2: Migration — users + sessions tables

**Files:** Create `src/server/db/migrations/002_auth.sql`. Extend `tests/server/db/migrations.test.ts`.

- [ ] **Step 1: Write migration SQL**

Create `src/server/db/migrations/002_auth.sql`:

```sql
CREATE TABLE users (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  email                TEXT NOT NULL UNIQUE,
  password             TEXT NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'user',
  must_change_password INTEGER NOT NULL DEFAULT 1,
  deactivated          INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  last_login           INTEGER
);

CREATE INDEX idx_users_email ON users(email);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
```

- [ ] **Step 2: Extend the bundled-migrations test**

Open `tests/server/db/migrations.test.ts`. Inside the same `describe("bundled migrations", …)` block, append:

```ts
it("applies 002_auth and creates users + sessions tables", () => {
  const tmp = mkdtempSync(join(tmpdir(), "minifold-init-"));
  const db = createDatabase(join(tmp, "test.db"));
  cleanup = () => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  };

  const dir = resolve(process.cwd(), "src/server/db/migrations");
  runMigrations(db, dir);

  const userCols = db.prepare("PRAGMA table_info(users)").all() as Array<{
    name: string;
  }>;
  expect(userCols.map((c) => c.name).sort()).toEqual(
    [
      "created_at",
      "deactivated",
      "email",
      "id",
      "last_login",
      "must_change_password",
      "name",
      "password",
      "role",
    ].sort(),
  );

  const sessionCols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{
    name: string;
  }>;
  expect(sessionCols.map((c) => c.name).sort()).toEqual(
    [
      "created_at",
      "expires_at",
      "id",
      "last_seen_at",
      "token_hash",
      "user_id",
    ].sort(),
  );
});
```

- [ ] **Step 3: Run test + full suite**

```bash
pnpm test tests/server/db/migrations.test.ts
pnpm test
```

Expected: migrations test has 2 cases passing; full suite all green (Foundation's 17 tests + the new migration case).

- [ ] **Step 4: Commit**

```bash
git add src/server/db/migrations/002_auth.sql tests/server/db/migrations.test.ts
git commit -m "feat(db): add users + sessions table migrations"
```

---

## Task 3: Password hashing wrapper (TDD)

**Files:** Create `src/server/auth/password.ts` + `tests/server/auth/password.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/server/auth/password.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";

describe("password", () => {
  it("hash + verify roundtrip accepts the right password", async () => {
    const hash = await hashPassword("hunter2");
    expect(hash).not.toBe("hunter2");
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(await verifyPassword("hunter2", hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("produces different hashes for the same password (salted)", async () => {
    const a = await hashPassword("hunter2");
    const b = await hashPassword("hunter2");
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/server/auth/password.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/server/auth/password.ts`:

```ts
import bcrypt from "bcryptjs";

const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 4: Run — should pass**

```bash
pnpm test tests/server/auth/password.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/password.ts tests/server/auth/password.test.ts
git commit -m "feat(auth): add bcrypt password hash + verify wrappers"
```

---

## Task 4: User repository (TDD)

**Files:** Create `src/server/db/users.ts` + `tests/server/db/users.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/server/db/users.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import {
  createUser,
  deleteUser,
  findUserByEmail,
  findUserById,
  hasAnyAdmin,
  listUsers,
  setLastLogin,
  updateUserPassword,
  updateUserRole,
  type UserRow,
} from "@/server/db/users";

let tmp: string;
let db: Database;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-users-"));
  db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("users repository", () => {
  it("hasAnyAdmin false on empty DB", () => {
    expect(hasAnyAdmin(db)).toBe(false);
  });

  it("createUser inserts and findUserByEmail retrieves (case-insensitive)", () => {
    const created = createUser(db, {
      name: "Jane",
      email: "Jane@Example.com",
      passwordHash: "$2a$12$xyz",
      role: "admin",
      mustChangePassword: false,
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.email).toBe("jane@example.com");

    const found: UserRow | null = findUserByEmail(db, "JANE@example.COM");
    expect(found?.id).toBe(created.id);
    expect(found?.role).toBe("admin");
    expect(found?.must_change_password).toBe(0);
  });

  it("hasAnyAdmin true once an admin exists, false for 'user' role only", () => {
    createUser(db, {
      name: "Bob",
      email: "bob@example.com",
      passwordHash: "$2a$12$xyz",
      role: "user",
      mustChangePassword: false,
    });
    expect(hasAnyAdmin(db)).toBe(false);

    createUser(db, {
      name: "Jane",
      email: "jane@example.com",
      passwordHash: "$2a$12$xyz",
      role: "admin",
      mustChangePassword: false,
    });
    expect(hasAnyAdmin(db)).toBe(true);
  });

  it("findUserById returns the user or null", () => {
    const created = createUser(db, {
      name: "Jane",
      email: "jane@example.com",
      passwordHash: "$2a$12$xyz",
      role: "admin",
      mustChangePassword: false,
    });
    expect(findUserById(db, created.id)?.email).toBe("jane@example.com");
    expect(findUserById(db, "nonexistent")).toBeNull();
  });

  it("setLastLogin updates the timestamp", () => {
    const created = createUser(db, {
      name: "Jane",
      email: "jane@example.com",
      passwordHash: "$2a$12$xyz",
      role: "admin",
      mustChangePassword: false,
    });
    setLastLogin(db, created.id);
    const found = findUserById(db, created.id);
    expect(found?.last_login).not.toBeNull();
    expect(found?.last_login).toBeGreaterThan(0);
  });

  it("updateUserPassword replaces the hash, sets mustChangePassword", () => {
    const created = createUser(db, {
      name: "Jane",
      email: "jane@example.com",
      passwordHash: "$2a$12$old",
      role: "user",
      mustChangePassword: true,
    });
    updateUserPassword(db, created.id, "$2a$12$new", { mustChangePassword: false });
    const found = findUserById(db, created.id);
    expect(found?.password).toBe("$2a$12$new");
    expect(found?.must_change_password).toBe(0);

    updateUserPassword(db, created.id, "$2a$12$newer", { mustChangePassword: true });
    const again = findUserById(db, created.id);
    expect(again?.must_change_password).toBe(1);
  });

  it("updateUserRole swaps role", () => {
    const created = createUser(db, {
      name: "Bob",
      email: "bob@example.com",
      passwordHash: "$2a$12$xyz",
      role: "user",
      mustChangePassword: false,
    });
    updateUserRole(db, created.id, "admin");
    expect(findUserById(db, created.id)?.role).toBe("admin");
  });

  it("deleteUser removes the user", () => {
    const created = createUser(db, {
      name: "Bob",
      email: "bob@example.com",
      passwordHash: "$2a$12$xyz",
      role: "user",
      mustChangePassword: false,
    });
    deleteUser(db, created.id);
    expect(findUserById(db, created.id)).toBeNull();
  });

  it("listUsers returns all users sorted by created_at", () => {
    createUser(db, {
      name: "A",
      email: "a@x.com",
      passwordHash: "$2a$12$x",
      role: "admin",
      mustChangePassword: false,
    });
    createUser(db, {
      name: "B",
      email: "b@x.com",
      passwordHash: "$2a$12$x",
      role: "user",
      mustChangePassword: false,
    });
    const rows = listUsers(db);
    expect(rows.map((r) => r.email)).toEqual(["a@x.com", "b@x.com"]);
  });

  it("createUser rejects duplicate email", () => {
    createUser(db, {
      name: "Jane",
      email: "jane@example.com",
      passwordHash: "$2a$12$xyz",
      role: "admin",
      mustChangePassword: false,
    });
    expect(() =>
      createUser(db, {
        name: "Other",
        email: "jane@example.com",
        passwordHash: "$2a$12$abc",
        role: "user",
        mustChangePassword: true,
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/server/db/users.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/server/db/users.ts`:

```ts
import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";

export type Role = "admin" | "user";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  password: string;
  role: Role;
  must_change_password: 0 | 1;
  deactivated: 0 | 1;
  created_at: number;
  last_login: number | null;
};

export type NewUser = {
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  mustChangePassword: boolean;
};

export function hasAnyAdmin(db: Database): boolean {
  return (
    db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get() !== undefined
  );
}

export function createUser(db: Database, input: NewUser): UserRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, name, email, password, role, must_change_password, deactivated, created_at, last_login)
     VALUES (@id, @name, @email, @password, @role, @mcp, 0, @now, NULL)`,
  ).run({
    id,
    name: input.name,
    email: input.email.toLowerCase(),
    password: input.passwordHash,
    role: input.role,
    mcp: input.mustChangePassword ? 1 : 0,
    now,
  });
  const row = findUserById(db, id);
  if (!row) throw new Error("createUser: inserted row not found");
  return row;
}

export function findUserByEmail(db: Database, email: string): UserRow | null {
  return (
    (db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email.toLowerCase()) as UserRow | undefined) ?? null
  );
}

export function findUserById(db: Database, id: string): UserRow | null {
  return (
    (db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined) ??
    null
  );
}

export function setLastLogin(db: Database, id: string): void {
  db.prepare("UPDATE users SET last_login = ? WHERE id = ?").run(Date.now(), id);
}

export function updateUserPassword(
  db: Database,
  id: string,
  passwordHash: string,
  opts: { mustChangePassword: boolean },
): void {
  db.prepare(
    "UPDATE users SET password = ?, must_change_password = ? WHERE id = ?",
  ).run(passwordHash, opts.mustChangePassword ? 1 : 0, id);
}

export function updateUserRole(db: Database, id: string, role: Role): void {
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
}

export function deleteUser(db: Database, id: string): void {
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

export function listUsers(db: Database): UserRow[] {
  return db
    .prepare("SELECT * FROM users ORDER BY created_at ASC")
    .all() as UserRow[];
}
```

- [ ] **Step 4: Run + sweep**

```bash
pnpm test tests/server/db/users.test.ts
pnpm typecheck && pnpm lint
```

Expected: 10 passed, typecheck + lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/users.ts tests/server/db/users.test.ts
git commit -m "feat(db): add users repository"
```

---

## Task 5: Session repository (TDD)

**Files:** Create `src/server/db/sessions.ts` + `tests/server/db/sessions.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/server/db/sessions.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createUser } from "@/server/db/users";
import {
  deleteSessionByTokenHash,
  deleteSessionsForUser,
  findSessionByTokenHash,
  insertSession,
  touchSession,
  type SessionRow,
} from "@/server/db/sessions";

let tmp: string;
let db: Database;
let userId: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-sess-"));
  db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
  userId = createUser(db, {
    name: "Jane",
    email: "jane@example.com",
    passwordHash: "$2a$12$xyz",
    role: "admin",
    mustChangePassword: false,
  }).id;
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("sessions repository", () => {
  it("insertSession + findSessionByTokenHash", () => {
    const expiresAt = Date.now() + 1000;
    insertSession(db, {
      id: "s1",
      tokenHash: "hash-1",
      userId,
      expiresAt,
    });
    const found: SessionRow | null = findSessionByTokenHash(db, "hash-1");
    expect(found?.id).toBe("s1");
    expect(found?.user_id).toBe(userId);
    expect(found?.expires_at).toBe(expiresAt);
  });

  it("findSessionByTokenHash returns null for unknown hash", () => {
    expect(findSessionByTokenHash(db, "nope")).toBeNull();
  });

  it("touchSession updates last_seen_at and expires_at", () => {
    const oldExpiry = Date.now() + 1000;
    insertSession(db, {
      id: "s1",
      tokenHash: "hash-1",
      userId,
      expiresAt: oldExpiry,
    });
    const newExpiry = Date.now() + 999_999;
    touchSession(db, "hash-1", newExpiry);
    const found = findSessionByTokenHash(db, "hash-1");
    expect(found?.expires_at).toBe(newExpiry);
    expect(found?.last_seen_at).toBeGreaterThanOrEqual(found!.created_at);
  });

  it("deleteSessionByTokenHash removes the row", () => {
    insertSession(db, {
      id: "s1",
      tokenHash: "hash-1",
      userId,
      expiresAt: Date.now() + 1000,
    });
    deleteSessionByTokenHash(db, "hash-1");
    expect(findSessionByTokenHash(db, "hash-1")).toBeNull();
  });

  it("deleteSessionsForUser removes all of that user's sessions", () => {
    insertSession(db, {
      id: "s1",
      tokenHash: "hash-1",
      userId,
      expiresAt: Date.now() + 1000,
    });
    insertSession(db, {
      id: "s2",
      tokenHash: "hash-2",
      userId,
      expiresAt: Date.now() + 1000,
    });
    deleteSessionsForUser(db, userId);
    expect(findSessionByTokenHash(db, "hash-1")).toBeNull();
    expect(findSessionByTokenHash(db, "hash-2")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/server/db/sessions.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `src/server/db/sessions.ts`:

```ts
import type { Database } from "better-sqlite3";

export type SessionRow = {
  id: string;
  token_hash: string;
  user_id: string;
  expires_at: number;
  created_at: number;
  last_seen_at: number;
};

export type NewSession = {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: number;
};

export function insertSession(db: Database, input: NewSession): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (id, token_hash, user_id, expires_at, created_at, last_seen_at)
     VALUES (@id, @tokenHash, @userId, @expiresAt, @now, @now)`,
  ).run({ ...input, now });
}

export function findSessionByTokenHash(
  db: Database,
  tokenHash: string,
): SessionRow | null {
  return (
    (db
      .prepare("SELECT * FROM sessions WHERE token_hash = ?")
      .get(tokenHash) as SessionRow | undefined) ?? null
  );
}

export function touchSession(
  db: Database,
  tokenHash: string,
  expiresAt: number,
): void {
  db.prepare(
    "UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE token_hash = ?",
  ).run(expiresAt, Date.now(), tokenHash);
}

export function deleteSessionByTokenHash(db: Database, tokenHash: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function deleteSessionsForUser(db: Database, userId: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}
```

- [ ] **Step 4: Run + sweep**

```bash
pnpm test tests/server/db/sessions.test.ts
pnpm typecheck && pnpm lint
```

Expected: 5 passed, all clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/sessions.ts tests/server/db/sessions.test.ts
git commit -m "feat(db): add sessions repository"
```

---

## Task 6: Session manager — pure functions (TDD)

**Files:** Create `src/server/auth/session.ts` + `tests/server/auth/session.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/server/auth/session.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createUser } from "@/server/db/users";
import { deleteSessionsForUser } from "@/server/db/sessions";
import {
  SESSION_TTL_MS,
  TOUCH_AFTER_MS,
  createSession,
  destroySession,
  destroySessionsForUser,
  validateSession,
} from "@/server/auth/session";

let tmp: string;
let db: Database;
let userId: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-session-"));
  db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
  userId = createUser(db, {
    name: "Jane",
    email: "jane@example.com",
    passwordHash: "$2a$12$xyz",
    role: "admin",
    mustChangePassword: false,
  }).id;
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("session manager", () => {
  it("createSession returns a base64url token and stores a hashed record", () => {
    const result = createSession(db, userId);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + SESSION_TTL_MS + 1000);
  });

  it("validateSession returns the user for a valid token", () => {
    const { token } = createSession(db, userId);
    const result = validateSession(db, token);
    expect(result?.user.id).toBe(userId);
    expect(result?.user.email).toBe("jane@example.com");
  });

  it("validateSession returns null for garbage tokens", () => {
    expect(validateSession(db, "not-a-real-token")).toBeNull();
  });

  it("validateSession returns null for an expired session", () => {
    const { token } = createSession(db, userId);
    // Manually expire the session.
    db.prepare("UPDATE sessions SET expires_at = ? WHERE user_id = ?").run(
      Date.now() - 1000,
      userId,
    );
    expect(validateSession(db, token)).toBeNull();
  });

  it("validateSession extends expires_at when last_seen_at is older than TOUCH_AFTER_MS", () => {
    const { token } = createSession(db, userId);
    // Backdate last_seen_at and expires_at to force a touch.
    const old = Date.now() - TOUCH_AFTER_MS - 1000;
    db.prepare(
      "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE user_id = ?",
    ).run(old, Date.now() + 1000, userId);

    const beforeTouch = (
      db
        .prepare("SELECT expires_at FROM sessions WHERE user_id = ?")
        .get(userId) as { expires_at: number }
    ).expires_at;

    validateSession(db, token);

    const afterTouch = (
      db
        .prepare("SELECT expires_at FROM sessions WHERE user_id = ?")
        .get(userId) as { expires_at: number }
    ).expires_at;

    expect(afterTouch).toBeGreaterThan(beforeTouch);
  });

  it("destroySession removes the row", () => {
    const { token } = createSession(db, userId);
    destroySession(db, token);
    expect(validateSession(db, token)).toBeNull();
  });

  it("destroySession on an unknown token is a no-op", () => {
    expect(() => destroySession(db, "bogus")).not.toThrow();
  });

  it("destroySessionsForUser clears every session for the user", () => {
    createSession(db, userId);
    createSession(db, userId);
    destroySessionsForUser(db, userId);
    const sessionsLeft = db
      .prepare("SELECT COUNT(*) as n FROM sessions WHERE user_id = ?")
      .get(userId) as { n: number };
    expect(sessionsLeft.n).toBe(0);
    // Sanity check against the DB helper too.
    deleteSessionsForUser(db, userId); // idempotent
  });

  it("validateSession for a deactivated user returns null and deletes the session", () => {
    const { token } = createSession(db, userId);
    db.prepare("UPDATE users SET deactivated = 1 WHERE id = ?").run(userId);
    expect(validateSession(db, token)).toBeNull();
    expect(
      (db
        .prepare("SELECT COUNT(*) as n FROM sessions WHERE user_id = ?")
        .get(userId) as { n: number }).n,
    ).toBe(0);
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/server/auth/session.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

Create `src/server/auth/session.ts`:

```ts
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { findUserById, type UserRow } from "@/server/db/users";
import {
  deleteSessionByTokenHash,
  deleteSessionsForUser,
  findSessionByTokenHash,
  insertSession,
  touchSession,
} from "@/server/db/sessions";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const TOUCH_AFTER_MS = 60 * 60 * 1000; // 1 hour — min interval before extending expiry

export type ValidSession = {
  user: UserRow;
  expiresAt: number;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(
  db: Database,
  userId: string,
): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  insertSession(db, {
    id: randomUUID(),
    tokenHash,
    userId,
    expiresAt,
  });
  return { token, expiresAt };
}

export function validateSession(db: Database, token: string): ValidSession | null {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = findSessionByTokenHash(db, tokenHash);
  if (!session) return null;

  const now = Date.now();
  if (session.expires_at <= now) {
    deleteSessionByTokenHash(db, tokenHash);
    return null;
  }

  const user = findUserById(db, session.user_id);
  if (!user || user.deactivated === 1) {
    // Defensive: clean up orphans and deactivated-user sessions.
    deleteSessionsForUser(db, session.user_id);
    return null;
  }

  // Sliding expiry: extend only if the last touch was a while ago.
  if (now - session.last_seen_at > TOUCH_AFTER_MS) {
    const newExpiresAt = now + SESSION_TTL_MS;
    touchSession(db, tokenHash, newExpiresAt);
    return { user, expiresAt: newExpiresAt };
  }

  return { user, expiresAt: session.expires_at };
}

export function destroySession(db: Database, token: string): void {
  if (!token) return;
  deleteSessionByTokenHash(db, hashToken(token));
}

export function destroySessionsForUser(db: Database, userId: string): void {
  deleteSessionsForUser(db, userId);
}
```

- [ ] **Step 4: Run + sweep**

```bash
pnpm test tests/server/auth/session.test.ts
pnpm typecheck && pnpm lint
```

Expected: 9 passed, all clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/session.ts tests/server/auth/session.test.ts
git commit -m "feat(auth): add DB-backed session manager (create / validate / destroy)"
```

---

## Task 7: Cookie helpers + current-user accessor

**Files:** Create `src/server/auth/cookies.ts` + `src/server/auth/current-user.ts`.

No tests — these are thin wrappers over `next/headers` `cookies()` whose behaviour is exercised end-to-end by Task 9 middleware + Task 13 manual verification.

- [ ] **Step 1: Write cookie helpers**

Create `src/server/auth/cookies.ts`:

```ts
import { cookies } from "next/headers";

export const SESSION_COOKIE = "minifold_session";

export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function writeSessionCookie(
  token: string,
  expiresAt: number,
): Promise<void> {
  const store = await cookies();
  store.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
```

- [ ] **Step 2: Write current-user accessor**

Create `src/server/auth/current-user.ts`:

```ts
import { getDatabase } from "@/server/db";
import { validateSession } from "./session";
import { readSessionCookie } from "./cookies";
import type { UserRow } from "@/server/db/users";

export async function getCurrentUser(): Promise<UserRow | null> {
  const token = await readSessionCookie();
  if (!token) return null;
  const result = validateSession(getDatabase(), token);
  return result?.user ?? null;
}
```

- [ ] **Step 3: Verify typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: both pass. (`cookies()` returns a Promise in Next 15+, which is why the helpers are `async`.)

- [ ] **Step 4: Commit**

```bash
git add src/server/auth/cookies.ts src/server/auth/current-user.ts
git commit -m "feat(auth): add cookie helpers + getCurrentUser accessor"
```

---

## Task 8: Setup wizard — action + page + form (TDD for form)

**Files:** Create `src/app/setup/actions.ts`, `src/app/setup/page.tsx`, `src/components/auth/SetupForm.tsx` + test.

- [ ] **Step 1: Write the server action**

Create `src/app/setup/actions.ts`:

```ts
"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { getDatabase } from "@/server/db";
import { createUser, hasAnyAdmin } from "@/server/db/users";
import { hashPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { writeSessionCookie } from "@/server/auth/cookies";

const schema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  email: z.string().email("Invalid email"),
  password: z.string().min(12, "Password must be at least 12 characters"),
});

export type SetupFormState = {
  error?: string;
  fieldErrors?: Partial<Record<"name" | "email" | "password", string>>;
};

export async function createAdmin(
  _prev: SetupFormState,
  formData: FormData,
): Promise<SetupFormState> {
  const db = getDatabase();
  if (hasAnyAdmin(db)) {
    return { error: "Setup has already been completed." };
  }

  const parsed = schema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    const fieldErrors: SetupFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as "name" | "email" | "password";
      fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const user = createUser(db, {
    name: parsed.data.name,
    email: parsed.data.email,
    passwordHash,
    role: "admin",
    mustChangePassword: false,
  });

  const { token, expiresAt } = createSession(db, user.id);
  await writeSessionCookie(token, expiresAt);
  redirect("/");
}
```

- [ ] **Step 2: Write the page**

Create `src/app/setup/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getDatabase } from "@/server/db";
import { hasAnyAdmin } from "@/server/db/users";
import { SetupForm } from "@/components/auth/SetupForm";

export default function SetupPage() {
  if (hasAnyAdmin(getDatabase())) {
    redirect("/login");
  }
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <h1 className="mb-1 text-2xl font-semibold">Welcome to Minifold</h1>
      <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-400">
        Create your admin account to finish setting up this instance.
      </p>
      <SetupForm />
    </div>
  );
}
```

- [ ] **Step 3: Write the failing form test**

Create `tests/components/auth/SetupForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { SetupForm } from "@/components/auth/SetupForm";

vi.mock("@/app/setup/actions", () => ({
  createAdmin: vi.fn(async () => ({})),
}));

describe("SetupForm", () => {
  it("renders name, email, password fields + submit", () => {
    render(<SetupForm />);
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create admin/i }),
    ).toBeInTheDocument();
  });

  it("submits form values", async () => {
    const { createAdmin } = await import("@/app/setup/actions");
    render(<SetupForm />);
    await userEvent.type(screen.getByLabelText(/name/i), "Jane");
    await userEvent.type(screen.getByLabelText(/email/i), "jane@example.com");
    await userEvent.type(
      screen.getByLabelText(/password/i),
      "correct-horse-staple",
    );
    await userEvent.click(screen.getByRole("button", { name: /create admin/i }));
    expect(createAdmin).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run — should fail**

```bash
pnpm test tests/components/auth/SetupForm.test.tsx
```

Expected: FAIL.

- [ ] **Step 5: Write the form**

Create `src/components/auth/SetupForm.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { createAdmin, type SetupFormState } from "@/app/setup/actions";

const initialState: SetupFormState = {};

export function SetupForm() {
  const [state, action, pending] = useActionState(createAdmin, initialState);

  return (
    <form action={action} className="flex flex-col gap-4">
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
        <span>Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.email && (
          <span className="text-xs text-red-600">{state.fieldErrors.email}</span>
        )}
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.password && (
          <span className="text-xs text-red-600">
            {state.fieldErrors.password}
          </span>
        )}
      </label>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {pending ? "Creating…" : "Create admin"}
      </button>
    </form>
  );
}
```

- [ ] **Step 6: Run test + sweep**

```bash
pnpm test tests/components/auth/SetupForm.test.tsx
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/app/setup src/components/auth/SetupForm.tsx tests/components/auth/SetupForm.test.tsx
git commit -m "feat(auth): add first-time setup wizard (admin creation)"
```

---

## Task 9: Middleware — cookie → session validate → gating

**Files:** Create `src/middleware.ts`.

- [ ] **Step 1: Write middleware**

Create `src/middleware.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { getDatabase } from "@/server/db";
import { hasAnyAdmin } from "@/server/db/users";
import { validateSession } from "@/server/auth/session";
import { SESSION_COOKIE } from "@/server/auth/cookies";

export const runtime = "nodejs";

const PUBLIC_PREFIXES = ["/_next", "/favicon.ico"];

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const db = getDatabase();
  const adminExists = hasAnyAdmin(db);

  // Before any admin exists: force everyone to the setup wizard.
  if (!adminExists) {
    if (pathname === "/setup") return NextResponse.next();
    return NextResponse.redirect(new URL("/setup", req.url));
  }

  // After setup: /setup is gone for good.
  if (pathname === "/setup") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Validate the session cookie.
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? validateSession(db, token) : null;

  if (!session) {
    if (pathname === "/login") return NextResponse.next();
    const loginUrl = new URL("/login", req.url);
    if (pathname !== "/") loginUrl.searchParams.set("callbackUrl", pathname);
    const res = NextResponse.redirect(loginUrl);
    // Make sure stale cookies don't linger on the client.
    if (token) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  // Signed in: bounce away from /login.
  if (pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
```

- [ ] **Step 2: Verify typecheck + lint + build**

```bash
pnpm typecheck && pnpm lint && pnpm build
```

Expected: all pass. If Next 16 rejects `export const runtime = "nodejs"` in middleware or the build throws an "Edge runtime only" error about better-sqlite3, that's a signal we need to move the `hasAnyAdmin` + session validation out of middleware and into each server component / layout. In that case, report BLOCKED; the fallback is to gate routes from a root `layout.tsx` check rather than middleware. Keep the middleware approach unless the build actively refuses.

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(auth): gate routes via middleware (setup → login → session)"
```

---

## Task 10: Login page + form + action (TDD for form)

**Files:** Create `src/app/login/actions.ts`, `src/app/login/page.tsx`, `src/components/auth/LoginForm.tsx` + test.

- [ ] **Step 1: Write the failing form test**

Create `tests/components/auth/LoginForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { LoginForm } from "@/components/auth/LoginForm";

vi.mock("@/app/login/actions", () => ({
  login: vi.fn(async () => ({})),
}));

describe("LoginForm", () => {
  it("renders email + password + submit", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("submits form values", async () => {
    const { login } = await import("@/app/login/actions");
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "jane@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "pw");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(login).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/components/auth/LoginForm.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Write the server action**

Create `src/app/login/actions.ts`:

```ts
"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { getDatabase } from "@/server/db";
import { findUserByEmail, setLastLogin } from "@/server/db/users";
import { verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { writeSessionCookie } from "@/server/auth/cookies";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  callbackUrl: z.string().optional(),
});

export type LoginFormState = { error?: string };

export async function login(
  _prev: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    callbackUrl: formData.get("callbackUrl"),
  });
  if (!parsed.success) {
    return { error: "Please enter a valid email and password." };
  }

  const db = getDatabase();
  const user = findUserByEmail(db, parsed.data.email);
  if (!user || user.deactivated === 1) {
    return { error: "Invalid email or password." };
  }

  const ok = await verifyPassword(parsed.data.password, user.password);
  if (!ok) {
    return { error: "Invalid email or password." };
  }

  setLastLogin(db, user.id);
  const { token, expiresAt } = createSession(db, user.id);
  await writeSessionCookie(token, expiresAt);

  const dest =
    parsed.data.callbackUrl && parsed.data.callbackUrl.startsWith("/")
      ? parsed.data.callbackUrl
      : "/";
  redirect(dest);
}
```

- [ ] **Step 4: Write the form**

Create `src/components/auth/LoginForm.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { login, type LoginFormState } from "@/app/login/actions";

const initialState: LoginFormState = {};

export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const [state, action, pending] = useActionState(login, initialState);

  return (
    <form action={action} className="flex flex-col gap-4">
      {callbackUrl && (
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
      )}
      <label className="flex flex-col gap-1 text-sm">
        <span>Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        />
      </label>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Write the page**

Create `src/app/login/page.tsx`:

```tsx
import { LoginForm } from "@/components/auth/LoginForm";

type SearchParams = { callbackUrl?: string };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <h1 className="mb-1 text-2xl font-semibold">Sign in to Minifold</h1>
      <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-400">
        Enter your credentials to continue.
      </p>
      <LoginForm callbackUrl={params.callbackUrl} />
    </div>
  );
}
```

- [ ] **Step 6: Run test + sweep**

```bash
pnpm test tests/components/auth/LoginForm.test.tsx
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/app/login src/components/auth/LoginForm.tsx tests/components/auth/LoginForm.test.tsx
git commit -m "feat(auth): add login page with credentials form"
```

---

## Task 11: Logout action + Sidebar integration

**Files:** Create `src/app/logout/actions.ts`, `src/components/auth/SignOutButton.tsx`. Modify `src/components/shell/Sidebar.tsx` + its test.

- [ ] **Step 1: Write the logout action**

Create `src/app/logout/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { getDatabase } from "@/server/db";
import { destroySession } from "@/server/auth/session";
import { clearSessionCookie, readSessionCookie } from "@/server/auth/cookies";

export async function logout(): Promise<void> {
  const token = await readSessionCookie();
  if (token) {
    destroySession(getDatabase(), token);
  }
  await clearSessionCookie();
  redirect("/login");
}
```

- [ ] **Step 2: Write the sign-out button**

Create `src/components/auth/SignOutButton.tsx`:

```tsx
import { logout } from "@/app/logout/actions";

export function SignOutButton() {
  return (
    <form action={logout}>
      <button
        type="submit"
        className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        Sign out
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Update the Sidebar to show the current user**

Replace `src/components/shell/Sidebar.tsx`:

```tsx
import Link from "next/link";
import { getCurrentUser } from "@/server/auth/current-user";
import { SignOutButton } from "@/components/auth/SignOutButton";

export async function Sidebar() {
  const user = await getCurrentUser();

  return (
    <aside className="flex h-full w-64 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex h-14 items-center px-4 text-lg font-semibold">
        Minifold
      </div>
      <nav className="flex-1 overflow-y-auto px-2">
        {/* Provider list + folders populated in Phase 3+ */}
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

- [ ] **Step 4: Update the Sidebar test**

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
      email: "jane@example.com",
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
});
```

- [ ] **Step 5: Run tests + sweep**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/app/logout src/components/auth/SignOutButton.tsx src/components/shell/Sidebar.tsx tests/components/shell/Sidebar.test.tsx
git commit -m "feat(auth): add logout + session-aware sidebar"
```

---

## Task 12: Admin CLI (`bin/cli.mjs`) with tests

**Files:** Create `bin/cli.mjs` + `tests/bin/cli.test.ts`.

Commands:
- `minifold list-users` — print a table of id / email / role / deactivated / last-login
- `minifold reset-admin --email <email>` — generate a random password, update the user's hash, print the new password to stdout so the operator can copy it. If the user doesn't exist or isn't an admin, set `role='admin'` too. Also deletes all the user's sessions.
- `minifold promote --email <email>` — make the user an admin
- `minifold demote --email <email>` — revoke admin, ensure at least one admin remains
- `minifold delete-user --email <email>` — delete the user (cascades to sessions)

- [ ] **Step 1: Write the failing integration test**

Create `tests/bin/cli.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createUser, findUserByEmail } from "@/server/db/users";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";

const CLI = resolve(process.cwd(), "bin/cli.mjs");

let tmp: string;
let dbPath: string;
let db: Database;

async function seedAdmin(email: string, plain: string) {
  const hash = await hashPassword(plain);
  return createUser(db, {
    name: "Seed",
    email,
    passwordHash: hash,
    role: "admin",
    mustChangePassword: false,
  });
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-cli-"));
  dbPath = join(tmp, "test.db");
  db = createDatabase(dbPath);
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function run(args: string[]) {
  return spawnSync("node", [CLI, ...args], {
    env: { ...process.env, DATABASE_PATH: dbPath },
    encoding: "utf8",
  });
}

describe("minifold CLI", () => {
  it("list-users prints an empty notice when the DB is empty", () => {
    const r = run(["list-users"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no users/i);
  });

  it("list-users prints a table of users", async () => {
    await seedAdmin("admin@example.com", "original-password");
    const r = run(["list-users"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("admin@example.com");
    expect(r.stdout).toContain("admin");
  });

  it("reset-admin updates the password, promotes to admin, and prints the new password", async () => {
    await seedAdmin("admin@example.com", "original-password");
    createSession(db, findUserByEmail(db, "admin@example.com")!.id);

    const r = run(["reset-admin", "--email", "admin@example.com"]);
    expect(r.status).toBe(0);
    const match = r.stdout.match(/New password: (\S+)/);
    expect(match).not.toBeNull();
    const newPassword = match![1];

    const user = findUserByEmail(db, "admin@example.com")!;
    expect(user.role).toBe("admin");
    expect(user.must_change_password).toBe(1);
    expect(await verifyPassword(newPassword, user.password)).toBe(true);
    expect(await verifyPassword("original-password", user.password)).toBe(false);

    const remaining = db
      .prepare("SELECT COUNT(*) as n FROM sessions WHERE user_id = ?")
      .get(user.id) as { n: number };
    expect(remaining.n).toBe(0);
  });

  it("reset-admin creates the admin if the email does not exist", () => {
    const r = run(["reset-admin", "--email", "new@example.com"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/New password:/);
    const user = findUserByEmail(db, "new@example.com")!;
    expect(user).toBeDefined();
    expect(user.role).toBe("admin");
  });

  it("promote turns a 'user' into 'admin'", async () => {
    createUser(db, {
      name: "Bob",
      email: "bob@example.com",
      passwordHash: await hashPassword("x"),
      role: "user",
      mustChangePassword: false,
    });
    const r = run(["promote", "--email", "bob@example.com"]);
    expect(r.status).toBe(0);
    expect(findUserByEmail(db, "bob@example.com")?.role).toBe("admin");
  });

  it("demote refuses to remove the last admin", async () => {
    await seedAdmin("admin@example.com", "pw");
    const r = run(["demote", "--email", "admin@example.com"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain("last admin");
    expect(findUserByEmail(db, "admin@example.com")?.role).toBe("admin");
  });

  it("demote works when another admin exists", async () => {
    await seedAdmin("a@example.com", "pw");
    await seedAdmin("b@example.com", "pw");
    const r = run(["demote", "--email", "b@example.com"]);
    expect(r.status).toBe(0);
    expect(findUserByEmail(db, "b@example.com")?.role).toBe("user");
  });

  it("delete-user removes the user and cascades sessions", async () => {
    const u = await seedAdmin("a@example.com", "pw");
    await seedAdmin("b@example.com", "pw");
    createSession(db, u.id);
    const r = run(["delete-user", "--email", "a@example.com"]);
    expect(r.status).toBe(0);
    expect(findUserByEmail(db, "a@example.com")).toBeNull();
    const n = db
      .prepare("SELECT COUNT(*) as n FROM sessions WHERE user_id = ?")
      .get(u.id) as { n: number };
    expect(n.n).toBe(0);
  });

  it("delete-user refuses to delete the last admin", async () => {
    await seedAdmin("a@example.com", "pw");
    const r = run(["delete-user", "--email", "a@example.com"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain("last admin");
    expect(findUserByEmail(db, "a@example.com")).not.toBeNull();
  });

  it("prints help when invoked with no args", () => {
    const r = run([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/commands:/i);
    expect(r.stdout).toMatch(/reset-admin/);
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/bin/cli.test.ts
```

Expected: FAIL (file not found).

- [ ] **Step 3: Write the CLI**

Create `bin/cli.mjs`:

```js
#!/usr/bin/env node
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

// Keep this file dependency-free from the rest of the app so it works both from
// the source tree (via `pnpm test`) and from the Docker standalone output.

const BCRYPT_COST = 12;

function createDb(path) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function usage() {
  console.log(`minifold — admin CLI

Commands:
  list-users                              List all users.
  reset-admin   --email <email>           Reset the password for an admin user (creates one if missing).
  promote       --email <email>           Promote a user to admin.
  demote        --email <email>           Demote an admin to user (refuses if last admin).
  delete-user   --email <email>           Delete a user (refuses if last admin).

Environment:
  DATABASE_PATH   Path to the SQLite DB. Defaults to /app/data/minifold.db in the image,
                  or ./data/minifold.db locally.
`);
}

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      out[a.slice(2)] = args[i + 1];
      i++;
    }
  }
  return out;
}

function dbPath() {
  return (
    process.env.DATABASE_PATH ?? resolve(process.cwd(), "data/minifold.db")
  );
}

function randomPassword() {
  // 24 chars, base64url — plenty of entropy, readable enough to copy.
  return randomBytes(18).toString("base64url");
}

function findByEmail(db, email) {
  return db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.toLowerCase());
}

function countAdmins(db) {
  const row = db
    .prepare("SELECT COUNT(*) as n FROM users WHERE role = 'admin'")
    .get();
  return row.n;
}

function cmdListUsers(db) {
  const rows = db
    .prepare("SELECT id, email, role, deactivated, last_login FROM users ORDER BY created_at")
    .all();
  if (rows.length === 0) {
    console.log("No users.");
    return 0;
  }
  console.log(
    ["EMAIL", "ROLE", "DEACTIVATED", "LAST_LOGIN", "ID"].join("\t"),
  );
  for (const r of rows) {
    console.log(
      [
        r.email,
        r.role,
        r.deactivated ? "yes" : "no",
        r.last_login ? new Date(r.last_login).toISOString() : "-",
        r.id,
      ].join("\t"),
    );
  }
  return 0;
}

async function cmdResetAdmin(db, email) {
  if (!email) {
    console.error("--email is required");
    return 2;
  }
  const newPassword = randomPassword();
  const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
  const existing = findByEmail(db, email);
  if (existing) {
    db.prepare(
      "UPDATE users SET password = ?, role = 'admin', must_change_password = 1, deactivated = 0 WHERE id = ?",
    ).run(hash, existing.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(existing.id);
  } else {
    const id = randomBytes(16).toString("hex").replace(
      /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
      "$1-$2-$3-$4-$5",
    );
    db.prepare(
      `INSERT INTO users (id, name, email, password, role, must_change_password, deactivated, created_at, last_login)
       VALUES (?, ?, ?, ?, 'admin', 1, 0, ?, NULL)`,
    ).run(id, email.split("@")[0], email.toLowerCase(), hash, Date.now());
  }
  console.log(`Admin email:  ${email.toLowerCase()}`);
  console.log(`New password: ${newPassword}`);
  console.log("(The user will be asked to change this on next login.)");
  return 0;
}

function cmdPromote(db, email) {
  if (!email) {
    console.error("--email is required");
    return 2;
  }
  const user = findByEmail(db, email);
  if (!user) {
    console.error(`No such user: ${email}`);
    return 1;
  }
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
  console.log(`${email} is now an admin.`);
  return 0;
}

function cmdDemote(db, email) {
  if (!email) {
    console.error("--email is required");
    return 2;
  }
  const user = findByEmail(db, email);
  if (!user) {
    console.error(`No such user: ${email}`);
    return 1;
  }
  if (user.role !== "admin") {
    console.log(`${email} is already a non-admin.`);
    return 0;
  }
  if (countAdmins(db) <= 1) {
    console.error("Refusing to demote the last admin.");
    return 1;
  }
  db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(user.id);
  console.log(`${email} is now a regular user.`);
  return 0;
}

function cmdDeleteUser(db, email) {
  if (!email) {
    console.error("--email is required");
    return 2;
  }
  const user = findByEmail(db, email);
  if (!user) {
    console.error(`No such user: ${email}`);
    return 1;
  }
  if (user.role === "admin" && countAdmins(db) <= 1) {
    console.error("Refusing to delete the last admin.");
    return 1;
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
  console.log(`Deleted ${email}.`);
  return 0;
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd) {
    usage();
    return 0;
  }
  const flags = parseFlags(rest);
  const db = createDb(dbPath());
  try {
    switch (cmd) {
      case "list-users":
        return cmdListUsers(db);
      case "reset-admin":
        return await cmdResetAdmin(db, flags.email);
      case "promote":
        return cmdPromote(db, flags.email);
      case "demote":
        return cmdDemote(db, flags.email);
      case "delete-user":
        return cmdDeleteUser(db, flags.email);
      case "--help":
      case "help":
        usage();
        return 0;
      default:
        console.error(`Unknown command: ${cmd}`);
        usage();
        return 2;
    }
  } finally {
    db.close();
  }
}

main().then(
  (code) => process.exit(code ?? 0),
  (err) => {
    console.error(err?.stack ?? err);
    process.exit(1);
  },
);
```

- [ ] **Step 4: Make the CLI executable**

```bash
chmod +x bin/cli.mjs
```

- [ ] **Step 5: Run tests + sweep**

```bash
pnpm test tests/bin/cli.test.ts
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 10 passed in the CLI test, all other tests green.

- [ ] **Step 6: Commit**

```bash
git add bin/cli.mjs tests/bin/cli.test.ts
git commit -m "feat(cli): add admin CLI (list/reset-admin/promote/demote/delete)"
```

---

## Task 13: Bundle the CLI into the Docker image

**Files:** Modify `Dockerfile`.

- [ ] **Step 1: Update Dockerfile runner stage**

Open `Dockerfile`. After the `COPY --from=build` lines and before `USER nextjs`, add:

```dockerfile
COPY --from=build --chown=nextjs:nodejs /app/bin ./bin
COPY --from=build --chown=nextjs:nodejs /app/src/server/db/migrations ./src/server/db/migrations
RUN printf '#!/bin/sh\nexec node /app/bin/cli.mjs "$@"\n' > /usr/local/bin/minifold \
 && chmod +x /usr/local/bin/minifold
```

Rationale:
- `bin/` isn't part of the Next standalone trace; we copy it manually.
- The migrations folder is already traced via `outputFileTracingIncludes`, but the CLI also runs migrations on first DB access — if the same `getDatabase()` path would be invoked from `bin/`, we'd need migrations there. Since `bin/cli.mjs` opens `better-sqlite3` directly (no `runMigrations`), the separate copy here is defensive: if a future CLI command needs migrations, they're available. Leaving the COPY in keeps the `bin/` and app code symmetric.
- `/usr/local/bin/minifold` shim lets operators type `minifold reset-admin …` instead of `node /app/bin/cli.mjs …`.

Full updated runner stage:

```dockerfile
# ---- runner ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_PATH=/app/data/minifold.db

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs \
 && mkdir -p /app/data \
 && chown -R nextjs:nodejs /app

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/bin ./bin
COPY --from=build --chown=nextjs:nodejs /app/src/server/db/migrations ./src/server/db/migrations

# The standalone bundle does NOT include node_modules that the CLI needs directly
# (bcryptjs, better-sqlite3). Copy them so `minifold` works in the container.
COPY --from=build --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=build --chown=nextjs:nodejs /app/node_modules/bcryptjs ./node_modules/bcryptjs
COPY --from=build --chown=nextjs:nodejs /app/node_modules/bindings ./node_modules/bindings
COPY --from=build --chown=nextjs:nodejs /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

RUN printf '#!/bin/sh\nexec node /app/bin/cli.mjs "$@"\n' > /usr/local/bin/minifold \
 && chmod +x /usr/local/bin/minifold

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

**Why the extra `node_modules` copies:** Next.js standalone output only traces what the server needs via webpack; `bin/cli.mjs` imports `better-sqlite3` and `bcryptjs` outside webpack's view, so we copy those packages manually. `bindings` and `file-uri-to-path` are `better-sqlite3`'s transitive native loader deps. If at build time any of these packages change their internal deps, the CLI test (which runs from source, not image) still catches regressions; if the container-level CLI breaks at runtime, `docker exec minifold-test minifold list-users` will fail visibly.

- [ ] **Step 2: Local Docker smoke test of the CLI**

```bash
docker build -t minifold:cli-test .
# Start a throwaway container with a fresh volume:
docker run -d --rm --name minifold-cli-smoke -v minifold-cli-vol:/app/data minifold:cli-test
sleep 5
docker exec minifold-cli-smoke minifold list-users
# Expected: "No users." on the fresh volume

docker exec minifold-cli-smoke minifold reset-admin --email admin@example.com
# Expected: outputs a new password

docker exec minifold-cli-smoke minifold list-users
# Expected: shows admin@example.com as admin

docker stop minifold-cli-smoke
docker volume rm minifold-cli-vol
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat(cli): bundle admin CLI into Docker image as /usr/local/bin/minifold"
```

---

## Task 14: Final verification + manual deploy

- [ ] **Step 1: Full local gauntlet**

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all green.

- [ ] **Step 2: Local containerized smoke test**

```bash
docker build -t minifold:auth .
docker run -d --rm --name minifold-auth -p 3000:3000 minifold:auth
sleep 5

# /setup should 307 on a fresh DB (no admin yet)
curl -si http://localhost:3000/ | head -3
# Expected: Location: /setup

# /setup itself should 200
curl -sI http://localhost:3000/setup | head -1
# Expected: 200

# The CLI should work inside the running container
docker exec minifold-auth minifold list-users
# Expected: No users.

docker stop minifold-auth
```

- [ ] **Step 3: Push + watch CI**

```bash
git push origin main
gh run watch --exit-status
```

Expected: `verify` + `publish` both green.

- [ ] **Step 4: Deploy to Coolify**

The persistent volume has no data yet (no admin was ever created on the live instance). A fresh admin flow will be tested there.

```bash
coolify deploy uuid kl2kjsmt42md6ct7zt4g9wsk
for i in {1..18}; do
  s=$(coolify app get kl2kjsmt42md6ct7zt4g9wsk --format json | jq -r .status)
  echo "[$i] $s"
  [[ "$s" == "running:healthy" ]] && break
  sleep 5
done
```

- [ ] **Step 5: Live smoke test**

```bash
APP_URL=https://minifold.apps.janjaap.de
# Unauthenticated GET / should 307 to /setup
curl -si "$APP_URL/" | grep -i "^location:"
# Expected: location: /setup

# /setup should 200
curl -sI "$APP_URL/setup" | head -1
# Expected: 200

# /login (before any admin) should also 307 to /setup via middleware
curl -si "$APP_URL/login" | grep -i "^location:"
# Expected: location: /setup
```

Report to the user: the wizard is live. After they visit the URL and create the admin account, verify post-setup behaviour:

```bash
curl -si "$APP_URL/setup" | grep -i "^location:"
# Expected: location: /login (setup is done, no session)

curl -si "$APP_URL/" | grep -i "^location:"
# Expected: location: /login?callbackUrl=/
```

- [ ] **Step 6: Verify CLI works inside the live container**

Coolify uses Docker Compose internally; the CLI can be invoked by SSHing to the server or via Coolify's `coolify app` exec command (if supported). Confirm via:

```bash
# Find the coolify CLI's exec command (may need --help)
coolify app --help | grep -i exec || true
```

If Coolify CLI lacks an exec verb, the operator path is: SSH to the netcup box, `docker ps | grep minifold`, `docker exec -it <container> minifold list-users`. Document this in project memory after a successful live test.

---

## Phase 2 exit criteria

- ✅ `users` and `sessions` tables exist; migrations idempotent and tested.
- ✅ `pnpm test` passes with all new test files.
- ✅ `pnpm typecheck` + `pnpm lint` clean.
- ✅ `pnpm build` emits a working Next.js standalone build.
- ✅ Docker image builds; `minifold list-users` and `minifold reset-admin` work via `docker exec`.
- ✅ Test instance at `https://minifold.apps.janjaap.de` serves the wizard on first visit, login afterward, gated shell once signed in.
- ✅ Sessions are stored in SQLite, checked on every request, revocable by deleting a row.
- ✅ No NextAuth, no JWT. No secrets required for auth to work at runtime; the session layer generates + stores its own random tokens.

---

## Self-Review

**Spec coverage (Phase 2 only):**
- §3 Setup Wizard step 1 (admin) — Tasks 8-9. Steps 2 + 3 explicitly deferred.
- §9 Passwords bcrypt — Task 3.
- §9 Sessions stored in SQLite, 30-day rolling — Tasks 5, 6 (TTL + TOUCH_AFTER). Matches spec.
- §9 Sessions invalidated on password change — `destroySessionsForUser` exists; called from `updateUserPassword` consumers in Phase 8's admin-UI work. Also exercised by the CLI's `reset-admin`.
- §9 Admin role / user role — Task 2 migration.
- §9 First login forced password change — flag ships; user-facing flow deferred to Phase 8 (when admin-creates-user UI lands).
- §9 OIDC upgrade path — adding OIDC later means adding a second login endpoint that ends in the same `createSession` call. Clean.
- §9 Sign out — Task 11.
- §15 users table — Task 2.
- §15 sessions table — Task 2. (Spec's data model didn't include a sessions table, but the spec §9 requires DB-backed sessions, so adding it here is consistent with the intent.)

**Placeholder scan:** every step has complete code / command blocks. No TBDs.

**Type consistency:**
- `UserRow`, `Role`, `NewUser` are defined in Task 4 and used in Tasks 5, 6, 8, 10, 11.
- `SessionRow`, `NewSession` in Task 5, used in Task 6.
- `ValidSession` in Task 6, used in Task 9.
- `SESSION_COOKIE` in Task 7, used in Task 9, 11.
- `SetupFormState` in Task 8, `LoginFormState` in Task 10.
- CLI commands (`list-users`, `reset-admin`, `promote`, `demote`, `delete-user`) are consistent across the test (Task 12 step 1) and implementation (Task 12 step 3) and Dockerfile shim (Task 13).
