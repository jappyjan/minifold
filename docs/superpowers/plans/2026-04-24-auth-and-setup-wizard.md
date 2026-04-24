# Phase 2 — Auth + Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-04-23-minifold-design.md](../specs/2026-04-23-minifold-design.md) §3 (First-Time Setup Wizard), §9 (Authentication & User Management), §15 (Data Model).

**Goal:** A fresh Minifold deployment intercepts all requests and shows a setup wizard that creates the first admin. After that, users can log in, see a signed-in shell with their name + sign-out, and the wizard never appears again. Users created by admin will be forced to change their password on first login (groundwork; the admin UI for creating users lives in Phase 8).

**Architecture:** NextAuth.js v5 with a custom `CredentialsProvider` backed by the SQLite `users` table. Passwords hashed with `bcryptjs` (pure-JS, no native build needed). Session strategy: JWT with a 30-day sliding expiry (NextAuth's built-in rolling refresh). A DB-backed `sessions` table + revocation land in Phase 8 alongside the admin session-management UI; the spec's "sessions stored in SQLite" is satisfied there, not here. All app routes are gated by `src/middleware.ts`: no admin → redirect to `/setup`; admin exists but no session → redirect to `/login`; signed-in users proceed. Server actions (Next 16 App Router) power form submission for setup, login, and password-change.

**Tech Stack:**
- `next-auth@^5` (stable v5, no longer beta) — `@auth/core` under the hood
- `bcryptjs@^2` + `@types/bcryptjs` — password hashing
- `zod` — input validation in server actions
- Vitest for unit tests (password, users CRUD, form components)
- Existing stack: Next 16 App Router, TypeScript, tRPC v11, better-sqlite3

**Out of scope (future phases):**
- Wizard step 2 (create first storage provider) → Phase 3
- Wizard step 3 (set global access default) → Phase 8
- Admin UI for user management (create / deactivate / delete / revoke sessions) → Phase 8
- DB-backed session table + revocation on password change → Phase 8
- OIDC/OAuth providers → future

---

## File Structure

```
minifold/
  src/
    middleware.ts                          # route gating (wizard, login, auth)
    server/
      auth/
        auth.ts                            # NextAuth v5 instance, CredentialsProvider
        password.ts                        # bcryptjs hash/verify wrappers
      db/
        users.ts                           # createUser, findUserByEmail, hasAnyAdmin, etc.
        migrations/
          002_auth.sql                     # users table
    app/
      api/
        auth/
          [...nextauth]/
            route.ts                       # NextAuth HTTP handlers
      setup/
        page.tsx                           # wizard shell (server component)
        actions.ts                         # createAdmin server action
      login/
        page.tsx                           # login shell (server component)
        actions.ts                         # signIn server action
    components/
      auth/
        SetupForm.tsx                      # client component — admin creation
        LoginForm.tsx                      # client component — email + password
        SignOutButton.tsx                  # client component — POST signout
      shell/
        Sidebar.tsx                        # MODIFIED: show current user + sign out
  tests/
    server/
      auth/
        password.test.ts
      db/
        users.test.ts
    components/
      auth/
        SetupForm.test.tsx
        LoginForm.test.tsx
```

---

## Task 1: Install auth dependencies

**Files:** Modify `package.json` via `pnpm add`.

- [ ] **Step 1: Install runtime + dev deps**

```bash
pnpm add next-auth@^5 bcryptjs@^2 zod@^3
pnpm add -D @types/bcryptjs
```

- [ ] **Step 2: Verify clean baseline**

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
```

Expected: all green. No code changes yet.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat: add next-auth, bcryptjs, zod for auth phase"
```

**Notes:**
- If `next-auth@^5` resolves to a beta version because v5 hasn't hit stable on npm, use `next-auth@beta` instead. Document the resolved version in the commit message if you had to substitute.
- `bcryptjs` is pure JS (no native build). Coolify image rebuild will not require the Dockerfile `curl` trick or any build toolchain additions.

---

## Task 2: Migration — users table

**Files:** Create `src/server/db/migrations/002_auth.sql` + `tests/server/db/migrations.test.ts` (add a test case).

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
```

- [ ] **Step 2: Extend the bundled-migrations test**

Open `tests/server/db/migrations.test.ts`. Add a new test case after the existing 001 test:

```ts
it("applies 002_auth and creates the users table", () => {
  const tmp = mkdtempSync(join(tmpdir(), "minifold-init-"));
  const db = createDatabase(join(tmp, "test.db"));
  cleanup = () => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  };

  const dir = resolve(process.cwd(), "src/server/db/migrations");
  runMigrations(db, dir);

  const cols = db.prepare("PRAGMA table_info(users)").all() as Array<{
    name: string;
  }>;
  expect(cols.map((c) => c.name).sort()).toEqual(
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
});
```

- [ ] **Step 3: Run the test**

```bash
pnpm test tests/server/db/migrations.test.ts
```

Expected: 2 passed (the existing settings test + the new users test).

- [ ] **Step 4: Run the full suite**

```bash
pnpm test
```

Expected: all prior tests still pass + the new one (Foundation's 17 → 18).

- [ ] **Step 5: Commit**

```bash
git add src/server/db/migrations/002_auth.sql tests/server/db/migrations.test.ts
git commit -m "feat(db): add users table migration"
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
    expect(hash).toMatch(/^\$2[aby]\$/); // bcrypt prefix
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
  findUserByEmail,
  findUserById,
  hasAnyAdmin,
  setLastLogin,
  updateUserPassword,
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
  it("hasAnyAdmin returns false on empty DB", () => {
    expect(hasAnyAdmin(db)).toBe(false);
  });

  it("createUser inserts and findUserByEmail retrieves", () => {
    const created = createUser(db, {
      name: "Jane",
      email: "jane@example.com",
      passwordHash: "$2a$12$xyz",
      role: "admin",
      mustChangePassword: false,
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.email).toBe("jane@example.com");

    const found = findUserByEmail(db, "jane@example.com");
    expect(found?.id).toBe(created.id);
    expect(found?.role).toBe("admin");
    expect(found?.must_change_password).toBe(0);
  });

  it("findUserByEmail is case-insensitive", () => {
    createUser(db, {
      name: "Jane",
      email: "jane@example.com",
      passwordHash: "$2a$12$xyz",
      role: "admin",
      mustChangePassword: false,
    });
    const found = findUserByEmail(db, "JANE@EXAMPLE.COM");
    expect(found).toBeDefined();
  });

  it("hasAnyAdmin returns true once an admin exists", () => {
    createUser(db, {
      name: "Jane",
      email: "jane@example.com",
      passwordHash: "$2a$12$xyz",
      role: "admin",
      mustChangePassword: false,
    });
    expect(hasAnyAdmin(db)).toBe(true);
  });

  it("hasAnyAdmin ignores non-admin users", () => {
    createUser(db, {
      name: "Bob",
      email: "bob@example.com",
      passwordHash: "$2a$12$xyz",
      role: "user",
      mustChangePassword: false,
    });
    expect(hasAnyAdmin(db)).toBe(false);
  });

  it("findUserById returns the user when found, null when not", () => {
    const created = createUser(db, {
      name: "Jane",
      email: "jane@example.com",
      passwordHash: "$2a$12$xyz",
      role: "admin",
      mustChangePassword: false,
    });
    const found: UserRow | null = findUserById(db, created.id);
    expect(found?.email).toBe("jane@example.com");
    expect(findUserById(db, "nonexistent-id")).toBeNull();
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

  it("updateUserPassword replaces the hash and clears must_change_password", () => {
    const created = createUser(db, {
      name: "Jane",
      email: "jane@example.com",
      passwordHash: "$2a$12$old",
      role: "user",
      mustChangePassword: true,
    });
    updateUserPassword(db, created.id, "$2a$12$new");
    const found = findUserById(db, created.id);
    expect(found?.password).toBe("$2a$12$new");
    expect(found?.must_change_password).toBe(0);
  });

  it("createUser rejects duplicate email (unique constraint)", () => {
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
  const row = db
    .prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1")
    .get();
  return row !== undefined;
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
  const row = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.toLowerCase()) as UserRow | undefined;
  return row ?? null;
}

export function findUserById(db: Database, id: string): UserRow | null {
  const row = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(id) as UserRow | undefined;
  return row ?? null;
}

export function setLastLogin(db: Database, id: string): void {
  db.prepare("UPDATE users SET last_login = ? WHERE id = ?").run(Date.now(), id);
}

export function updateUserPassword(db: Database, id: string, passwordHash: string): void {
  db.prepare(
    "UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?",
  ).run(passwordHash, id);
}
```

- [ ] **Step 4: Run — should pass**

```bash
pnpm test tests/server/db/users.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Run full suite + typecheck + lint**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/server/db/users.ts tests/server/db/users.test.ts
git commit -m "feat(db): add users repository (create, find, update password, last login)"
```

---

## Task 5: NextAuth v5 config + CredentialsProvider

**Files:** Create `src/server/auth/auth.ts`.

- [ ] **Step 1: Write the NextAuth config**

Create `src/server/auth/auth.ts`:

```ts
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { getDatabase } from "@/server/db";
import { findUserByEmail, setLastLogin } from "@/server/db/users";
import { verifyPassword } from "./password";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "admin" | "user";
      mustChangePassword: boolean;
    } & DefaultSession["user"];
  }
  interface User {
    id: string;
    role: "admin" | "user";
    mustChangePassword: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "admin" | "user";
    mustChangePassword: boolean;
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
    updateAge: 24 * 60 * 60, // refresh token daily on activity
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const db = getDatabase();
        const user = findUserByEmail(db, parsed.data.email);
        if (!user || user.deactivated === 1) return null;

        const ok = await verifyPassword(parsed.data.password, user.password);
        if (!ok) return null;

        setLastLogin(db, user.id);

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role as "admin" | "user",
          mustChangePassword: user.must_change_password === 1,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.mustChangePassword = user.mustChangePassword;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.mustChangePassword = token.mustChangePassword;
      return session;
    },
  },
});
```

- [ ] **Step 2: Verify typecheck + lint**

```bash
pnpm typecheck
pnpm lint
```

Expected: both pass. If NextAuth v5's type augmentation path differs (e.g., the `module "next-auth"` name resolved to something different), follow the TypeScript error to the correct declaration file path and adjust the `declare module` target. Document the adjustment in the commit message.

- [ ] **Step 3: Commit**

```bash
git add src/server/auth/auth.ts
git commit -m "feat(auth): add NextAuth v5 config with CredentialsProvider"
```

**Notes:**
- No NEXTAUTH_SECRET / AUTH_SECRET env var is set yet. NextAuth v5 generates a dev-mode secret automatically; production will need `AUTH_SECRET`. We'll wire this in Task 11 (config + Coolify env).
- `pages.signIn` points to `/login` — we'll create that route in Task 10.

---

## Task 6: NextAuth HTTP handlers

**Files:** Create `src/app/api/auth/[...nextauth]/route.ts`.

- [ ] **Step 1: Write the handler**

Create `src/app/api/auth/[...nextauth]/route.ts`:

```ts
export { GET, POST } from "@/server/auth/auth";
```

Wait — actually, NextAuth v5 exports a single `handlers` object with `{ GET, POST }`. Re-export from that:

```ts
import { handlers } from "@/server/auth/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 2: Verify typecheck + lint**

```bash
pnpm typecheck
pnpm lint
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/api/auth/[...nextauth]/route.ts'
git commit -m "feat(auth): mount NextAuth HTTP handlers"
```

---

## Task 7: Setup wizard — server action + page shell

**Files:** Create `src/app/setup/actions.ts`, `src/app/setup/page.tsx`.

- [ ] **Step 1: Write the server action**

Create `src/app/setup/actions.ts`:

```ts
"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { getDatabase } from "@/server/db";
import { createUser, hasAnyAdmin } from "@/server/db/users";
import { hashPassword } from "@/server/auth/password";
import { signIn } from "@/server/auth/auth";

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

  const raw = {
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: SetupFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as "name" | "email" | "password";
      fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  createUser(db, {
    name: parsed.data.name,
    email: parsed.data.email,
    passwordHash,
    role: "admin",
    mustChangePassword: false,
  });

  await signIn("credentials", {
    email: parsed.data.email,
    password: parsed.data.password,
    redirectTo: "/",
  });
  // signIn() redirects internally on success; this is defensive.
  redirect("/");
}
```

- [ ] **Step 2: Write the page (server component)**

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

- [ ] **Step 3: Verify typecheck + lint**

```bash
pnpm typecheck
pnpm lint
```

Expected: both pass. The `SetupForm` import is unresolved until Task 8; this task can commit after Task 8 if you prefer to stage them together. To commit now, proceed to Step 4 and skip typecheck — or do Tasks 7 and 8 together.

**Recommended:** combine Tasks 7 and 8 in one commit. Skip Step 4 here and continue to Task 8.

- [ ] **Step 4: Defer commit to Task 8**

No commit here — Task 8 creates `SetupForm` and commits both.

---

## Task 8: SetupForm client component (TDD)

**Files:** Create `src/components/auth/SetupForm.tsx` + `tests/components/auth/SetupForm.test.tsx`.

- [ ] **Step 1: Write the failing test**

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
  it("renders name, email, and password fields", () => {
    render(<SetupForm />);
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create admin/i }),
    ).toBeInTheDocument();
  });

  it("submits form values to the server action", async () => {
    const { createAdmin } = await import("@/app/setup/actions");
    render(<SetupForm />);
    await userEvent.type(screen.getByLabelText(/name/i), "Jane Doe");
    await userEvent.type(screen.getByLabelText(/email/i), "jane@example.com");
    await userEvent.type(
      screen.getByLabelText(/password/i),
      "correct-horse-staple",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /create admin/i }),
    );
    expect(createAdmin).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/components/auth/SetupForm.test.tsx
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the component**

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
          <span className="text-xs text-red-600">
            {state.fieldErrors.email}
          </span>
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

      {state.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}

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

- [ ] **Step 4: Run test — should pass**

```bash
pnpm test tests/components/auth/SetupForm.test.tsx
```

Expected: 2 passed.

- [ ] **Step 5: Full sweep**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all green.

- [ ] **Step 6: Commit Tasks 7 + 8 together**

```bash
git add src/app/setup src/components/auth/SetupForm.tsx tests/components/auth/SetupForm.test.tsx
git commit -m "feat(auth): add first-time setup wizard (admin creation)"
```

---

## Task 9: Middleware — route gating

**Files:** Create `src/middleware.ts`.

- [ ] **Step 1: Write middleware**

Create `src/middleware.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/server/auth/auth";
import { getDatabase } from "@/server/db";
import { hasAnyAdmin } from "@/server/db/users";

const PUBLIC_PREFIXES = ["/api/auth", "/_next", "/favicon.ico"];

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const adminExists = hasAnyAdmin(getDatabase());

  // Before any admin exists: force everyone to the setup wizard.
  if (!adminExists) {
    if (pathname === "/setup") return NextResponse.next();
    return NextResponse.redirect(new URL("/setup", req.url));
  }

  // After setup: block access to /setup.
  if (pathname === "/setup") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Auth gate for everything else.
  const session = await auth();
  if (!session) {
    if (pathname === "/login") return NextResponse.next();
    const loginUrl = new URL("/login", req.url);
    if (pathname !== "/") loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Signed in: bounce them out of /login back to the app.
  if (pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on everything except Next internals + static assets with a dot in the path.
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
```

- [ ] **Step 2: Verify typecheck + lint**

```bash
pnpm typecheck
pnpm lint
```

Expected: both pass. If `auth()` from NextAuth v5 errors when invoked inside middleware (Node runtime vs edge), move middleware to use the JWT-only helper `getToken` from `next-auth/jwt`, or convert to edge-compatible auth. `better-sqlite3` is Node-only, so `hasAnyAdmin` forces Node runtime — which means the default runtime for this middleware needs to be `nodejs`. Add at the top of the file:

```ts
export const runtime = "nodejs";
```

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(auth): gate routes via middleware (setup → login → auth)"
```

**Notes:**
- `better-sqlite3` cannot run in the Edge Runtime. `export const runtime = "nodejs"` on middleware forces the Node runtime.
- The middleware does a DB read on every request (`hasAnyAdmin`). This is a fast indexed query; if it becomes a hot-path concern we can memoize after the first `true` result (once set up, never unsets).

---

## Task 10: Login page + form (TDD)

**Files:** Create `src/app/login/page.tsx`, `src/app/login/actions.ts`, `src/components/auth/LoginForm.tsx` + test.

- [ ] **Step 1: Write the failing component test**

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
  it("renders email and password fields", () => {
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
import { AuthError } from "next-auth";
import { signIn } from "@/server/auth/auth";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  callbackUrl: z.string().optional(),
});

export type LoginFormState = {
  error?: string;
};

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

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: parsed.data.callbackUrl ?? "/",
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: "Invalid email or password." };
    }
    throw err;
  }
  return {};
}
```

- [ ] **Step 4: Write the client form**

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

- [ ] **Step 6: Run tests + sweep**

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

## Task 11: AUTH_SECRET env var + Coolify config

**Files:** Modify `next.config.ts` (no change — just document env requirement), update Coolify app env.

- [ ] **Step 1: Generate a random AUTH_SECRET**

```bash
openssl rand -base64 32
```

Copy the output.

- [ ] **Step 2: Set the env var on the Coolify app**

```bash
coolify app env --help   # check flag syntax
coolify app env create kl2kjsmt42md6ct7zt4g9wsk \
  --key AUTH_SECRET \
  --value "<generated-secret>" \
  --is-build-time=false
```

If the exact flag names differ from what's shown above, use whatever `coolify app env create --help` outputs. Do not commit the secret value anywhere.

- [ ] **Step 3: Also set AUTH_TRUST_HOST**

NextAuth v5 needs `AUTH_TRUST_HOST=true` when running behind a reverse proxy (Coolify's Traefik):

```bash
coolify app env create kl2kjsmt42md6ct7zt4g9wsk \
  --key AUTH_TRUST_HOST \
  --value "true" \
  --is-build-time=false
```

- [ ] **Step 4: For local dev — add an example file**

Create `.env.example`:

```
# Auto-generated for production via Coolify env; set one for local dev:
# openssl rand -base64 32
AUTH_SECRET=
AUTH_TRUST_HOST=true
```

Update `.gitignore` to ignore `.env`, `.env.local` (should already be there from Foundation — verify).

- [ ] **Step 5: Commit the example file**

```bash
git add .env.example
git commit -m "docs: document AUTH_SECRET + AUTH_TRUST_HOST env vars"
```

---

## Task 12: Wire session into Sidebar + add Sign Out

**Files:** Modify `src/components/shell/Sidebar.tsx`. Create `src/components/auth/SignOutButton.tsx`.

- [ ] **Step 1: Create SignOutButton**

Create `src/components/auth/SignOutButton.tsx`:

```tsx
import { signOut } from "@/server/auth/auth";

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
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

- [ ] **Step 2: Update Sidebar**

Replace `src/components/shell/Sidebar.tsx`:

```tsx
import Link from "next/link";
import { auth } from "@/server/auth/auth";
import { SignOutButton } from "@/components/auth/SignOutButton";

export async function Sidebar() {
  const session = await auth();

  return (
    <aside className="flex h-full w-64 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex h-14 items-center px-4 text-lg font-semibold">
        Minifold
      </div>
      <nav className="flex-1 overflow-y-auto px-2">
        {/* Provider list + folders populated in Phase 3+ */}
      </nav>
      <div className="flex flex-col gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
        {session && (
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            Signed in as <span className="font-medium">{session.user.name}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <Link
            href="/admin"
            className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            Admin
          </Link>
          {session && <SignOutButton />}
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Update the Sidebar test**

The existing `tests/components/shell/Sidebar.test.tsx` renders `<Sidebar />` synchronously. Now that Sidebar is an async server component that calls `auth()`, the test needs to adapt. Replace the test file:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Sidebar } from "@/components/shell/Sidebar";

vi.mock("@/server/auth/auth", () => ({
  auth: vi.fn(async () => null),
  signOut: vi.fn(),
}));

describe("Sidebar", () => {
  it("renders the app name", async () => {
    const node = await Sidebar();
    render(node);
    expect(screen.getByText("Minifold")).toBeInTheDocument();
  });

  it("has an admin link at the bottom", async () => {
    const node = await Sidebar();
    render(node);
    expect(screen.getByRole("link", { name: /admin/i })).toBeInTheDocument();
  });

  it("shows 'Signed in as' when a session exists", async () => {
    const { auth } = await import("@/server/auth/auth");
    vi.mocked(auth).mockResolvedValueOnce({
      user: {
        id: "u1",
        name: "Jane",
        email: "jane@example.com",
        role: "admin",
        mustChangePassword: false,
      },
      expires: new Date(Date.now() + 1000).toISOString(),
    });
    const node = await Sidebar();
    render(node);
    expect(screen.getByText(/signed in as/i)).toBeInTheDocument();
    expect(screen.getByText("Jane")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run tests + sweep**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Expected: all green. The updated Sidebar test + SetupForm + LoginForm + password + users tests all pass alongside the prior suite.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/Sidebar.tsx src/components/auth/SignOutButton.tsx tests/components/shell/Sidebar.test.tsx
git commit -m "feat(auth): show signed-in user + sign out in sidebar"
```

---

## Task 13: Final verification + manual deploy

- [ ] **Step 1: Run the full local gauntlet**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all green. Build must succeed with `AUTH_SECRET` unset (NextAuth v5 warns in production builds but doesn't error — an auto-dev secret is used).

- [ ] **Step 2: Local Docker smoke test**

```bash
docker build -t minifold:auth .
docker run -d --rm --name minifold-auth -p 3000:3000 \
  -e AUTH_SECRET="$(openssl rand -base64 32)" \
  -e AUTH_TRUST_HOST=true \
  minifold:auth

# Wait for ready
for i in {1..30}; do
  curl -sf -o /dev/null -w "%{http_code}" http://localhost:3000/ | grep -qE "200|302|307" && break
  sleep 1
done

# First GET should 307 → /setup (no admin yet)
curl -si http://localhost:3000/ | head -5
# Should show Location: /setup

docker stop minifold-auth
```

Expected: unauthenticated request redirects to `/setup`.

- [ ] **Step 3: Push to main + watch CI**

```bash
git status   # confirm clean
git push origin main
gh run watch --exit-status
```

Expected: `verify` + `publish` both green; new image in GHCR.

- [ ] **Step 4: Manual Coolify deploy**

```bash
coolify deploy uuid kl2kjsmt42md6ct7zt4g9wsk
for i in {1..18}; do
  s=$(coolify app get kl2kjsmt42md6ct7zt4g9wsk --format json | jq -r .status)
  echo "[$i] $s"
  [[ "$s" == "running:healthy" ]] && break
  sleep 5
done
```

Expected: `running:healthy`.

- [ ] **Step 5: Live smoke test**

```bash
APP_URL=https://minifold.apps.janjaap.de
# Unauthenticated GET / should 307 to /setup (no admin on this fresh volume)
curl -si "$APP_URL/" | grep -i "^location:"
# Expected: location: /setup

# Direct GET /setup should 200
curl -sI "$APP_URL/setup" | head -1
# Expected: 200
```

Tell the user the app is live at `https://minifold.apps.janjaap.de/setup` and ask them to create the admin account to verify the end-to-end flow.

- [ ] **Step 6: (After user creates admin) verify the wizard can't be revisited**

```bash
curl -si "$APP_URL/setup" | grep -i "^location:"
# Expected: location: /login  (because admin now exists, and no session)
```

---

## Phase 2 exit criteria

- ✅ Migrations include `002_auth.sql`; the `users` table exists with all 9 columns.
- ✅ `pnpm test` passes with the new tests (password, users, SetupForm, LoginForm, Sidebar update) + all prior tests.
- ✅ `pnpm typecheck` + `pnpm lint` clean.
- ✅ `pnpm build` emits a working Next.js standalone build.
- ✅ Docker image builds and runs; `/` redirects to `/setup` when no admin, to `/login` when admin exists but no session, to the app shell when signed in.
- ✅ Test instance at `https://minifold.apps.janjaap.de` shows the wizard on first visit; after the user creates an admin and signs in, the sidebar shows their name and a Sign out button.
- ✅ `AUTH_SECRET` + `AUTH_TRUST_HOST` are set as Coolify env vars (not committed anywhere).

---

## Self-Review

**Spec coverage (Phase 2 only):**
- §3 Setup Wizard step 1 (create admin) — Tasks 7-9
- §3 Setup Wizard steps 2 + 3 — deferred (Phase 3, Phase 8) per scope note
- §9 NextAuth v5 + CredentialsProvider — Task 5
- §9 bcrypt — Task 3
- §9 Sessions 30-day rolling — JWT with `maxAge: 30d`, `updateAge: 1d` (Task 5)
- §9 Sessions invalidated on password change / admin revocation — deferred to Phase 8 (requires DB-backed sessions + admin UI)
- §9 OIDC upgrade path — NextAuth's provider array makes this a one-file change later
- §9 Roles admin/user — user migration Task 2 + typed in auth config Task 5
- §9 First login forced password change — flag stored; UI enforcement deferred to Phase 8 (admin-creates-user flow lives there)
- §9 Sign out — Task 12
- §15 `users` table — Task 2
- §15 `sessions` table — deferred (JWT used instead for now)

**Placeholder scan:** verified — every step has either a complete code block, a complete shell command, or is a pure coordination step (commit). No TBDs.

**Type consistency:** `UserRow`, `NewUser`, `Role`, `createUser`, `findUserByEmail`, `hasAnyAdmin`, `setLastLogin`, `updateUserPassword` all match between Task 4 (definitions) and Task 5 (usage). `SetupFormState` matches Task 7 (definition) and Task 8 (consumption). `LoginFormState` matches Task 10.
