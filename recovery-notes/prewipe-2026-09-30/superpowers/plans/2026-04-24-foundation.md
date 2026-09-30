# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-04-23-minifold-design.md](../specs/2026-04-23-minifold-design.md)

**Goal:** Ship a runnable Next.js 15 + TypeScript + tRPC v11 + SQLite application shell that boots in Docker, exposes a working tRPC health endpoint, enforces migrations at first DB access, and has the development infrastructure (tests, lint, format) needed for subsequent phases.

**Architecture:** Next.js 15 App Router with `output: 'standalone'` for a minimal production image. `better-sqlite3` as the DB driver with WAL mode enabled. A minimal migration runner reads SQL files from `src/server/db/migrations/` and applies unapplied ones on first DB access. tRPC v11 is mounted at `/api/trpc/[trpc]` via the fetch adapter. The React layer wraps children in a `TRPCProvider` (React Query + tRPC client). App shell is just a sidebar + top bar + content region — no real data, just layout.

**Tech Stack:**
- Next.js 15 (App Router, standalone output, Turbopack dev)
- TypeScript 5.6+ (strict mode)
- tRPC v11 (`@trpc/server`, `@trpc/client`, `@trpc/react-query`)
- `@tanstack/react-query` v5
- `better-sqlite3` v11
- Tailwind CSS v4
- Vitest v2 + `@testing-library/react` + `happy-dom`
- ESLint (Next.js config) + Prettier
- Docker (multi-stage, `node:22-bookworm-slim`)

**Out of scope (future phases):**
- Auth, setup wizard, `SESSION_SECRET` auto-gen (Phase 2)
- Storage providers (Phase 3)
- File browsing, 3D viewer, thumbnails (Phases 4-5)
- Hash-based caching, access control, admin UI, PWA, deployment templates (Phases 6-9)

---

## File Structure

```
minifold/
  package.json
  pnpm-lock.yaml
  tsconfig.json
  next.config.ts
  vitest.config.ts
  postcss.config.mjs
  eslint.config.mjs
  .prettierrc.json
  .prettierignore
  .dockerignore
  Dockerfile
  docker-compose.yml
  src/
    app/
      layout.tsx              # root layout, wraps TRPCProvider + app shell
      page.tsx                # placeholder home
      globals.css             # Tailwind directives
      api/
        trpc/
          [trpc]/
            route.ts          # tRPC fetch adapter
    components/
      shell/
        AppShell.tsx          # composition of Sidebar + TopBar + content slot
        Sidebar.tsx           # desktop sidebar (static placeholder)
        TopBar.tsx            # mobile top bar with hamburger → drawer toggle
    server/
      db/
        client.ts             # better-sqlite3 init, WAL, foreign keys
        migrate.ts             # migration runner
        index.ts              # lazy singleton + migration bootstrap
        migrations/
          001_init.sql        # settings table
      trpc/
        trpc.ts               # initTRPC, context, procedure builders
        router.ts             # appRouter, export AppRouter type
        routers/
          health.ts           # { status: 'ok' } query
    trpc/
      client.ts               # tRPC React Query client factory
      Provider.tsx            # client boundary, wires QueryClient + tRPC
  tests/
    smoke.test.ts
    server/
      db/
        client.test.ts
        migrate.test.ts
        migrations.test.ts
        bootstrap.test.ts
      trpc/
        health.test.ts
    components/
      shell/
        Sidebar.test.tsx
        TopBar.test.tsx
```

---

## Task 1: Initialize project + install dependencies

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`
- Modify: `.gitignore`

- [ ] **Step 1: Bootstrap Next.js 15 project**

From the repo root (`/Users/jappy/code/jappyjan/minifold`):

```bash
pnpm create next-app@latest . --ts --app --src-dir --tailwind --no-eslint --import-alias "@/*" --use-pnpm
```

When it asks about the non-empty directory, proceed. The generator preserves existing files (`.git`, `.gitignore`, `docs/`, `.superpowers/`).

- [ ] **Step 2: Install runtime + dev dependencies**

```bash
pnpm add @trpc/server@^11 @trpc/client@^11 @trpc/react-query@^11 @tanstack/react-query@^5 better-sqlite3@^11 superjson
pnpm add -D @types/better-sqlite3 vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom @testing-library/user-event happy-dom prettier prettier-plugin-tailwindcss eslint eslint-config-next @eslint/eslintrc
```

- [ ] **Step 3: Overwrite `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Overwrite `next.config.ts`**

```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingIncludes: {
    "/api/**/*": ["./src/server/db/migrations/**/*.sql"],
  },
  experimental: {
    typedRoutes: true,
  },
};

export default config;
```

`serverExternalPackages` keeps the native SQLite module out of the webpack bundle. `outputFileTracingIncludes` ensures the migrations folder is copied into `.next/standalone/` so `process.cwd()`-relative resolution works at runtime.

- [ ] **Step 5: Overwrite `eslint.config.mjs`**

```js
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat();

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
```

- [ ] **Step 6: Write `.prettierrc.json` and `.prettierignore`**

`.prettierrc.json`:
```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

`.prettierignore`:
```
.next
node_modules
pnpm-lock.yaml
.superpowers
data
```

- [ ] **Step 7: Update `package.json` scripts**

Replace the `scripts` block with:
```json
{
  "scripts": {
    "dev": "next dev --turbo",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "format": "prettier --write ."
  }
}
```

- [ ] **Step 8: Update `.gitignore`**

Ensure it contains (append missing entries):
```
node_modules
.next
.env*.local
/data
*.tsbuildinfo
coverage
```

- [ ] **Step 9: Verify clean baseline**

```bash
pnpm install
pnpm typecheck
pnpm lint
```

Expected: both pass with zero errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: initialize Next.js 15 + TypeScript project"
```

---

## Task 2: Vitest setup + smoke test

**Files:**
- Create: `vitest.config.ts`, `tests/smoke.test.ts`

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 2: Write `tests/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests to verify**

```bash
pnpm test
```

Expected: `1 passed`.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts tests/smoke.test.ts
git commit -m "test: add Vitest setup and smoke test"
```

---

## Task 3: SQLite client with WAL mode (TDD)

**Files:**
- Create: `src/server/db/client.ts`, `tests/server/db/client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/db/client.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "@/server/db/client";

describe("createDatabase", () => {
  let tmp: string | null = null;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  });

  it("opens a SQLite file and enables WAL mode", () => {
    tmp = mkdtempSync(join(tmpdir(), "minifold-db-"));
    const db = createDatabase(join(tmp, "test.db"));
    const row = db.pragma("journal_mode", { simple: false }) as Array<{
      journal_mode: string;
    }>;
    expect(row[0].journal_mode).toBe("wal");
    db.close();
  });

  it("enables foreign keys", () => {
    tmp = mkdtempSync(join(tmpdir(), "minifold-db-"));
    const db = createDatabase(join(tmp, "test.db"));
    const fk = db.pragma("foreign_keys", { simple: true });
    expect(fk).toBe(1);
    db.close();
  });

  it("creates parent directories as needed", () => {
    tmp = mkdtempSync(join(tmpdir(), "minifold-db-"));
    const db = createDatabase(join(tmp, "nested", "deep", "test.db"));
    expect(db.open).toBe(true);
    db.close();
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/server/db/client.test.ts
```

Expected: FAIL (module `@/server/db/client` not found).

- [ ] **Step 3: Write the implementation**

Create `src/server/db/client.ts`:

```ts
import Database, { type Database as DB } from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

export function createDatabase(path: string): DB {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  return db;
}
```

- [ ] **Step 4: Run — should pass**

```bash
pnpm test tests/server/db/client.test.ts
```

Expected: `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/client.ts tests/server/db/client.test.ts
git commit -m "feat: add SQLite client with WAL mode"
```

---

## Task 4: Migration runner (TDD)

**Files:**
- Create: `src/server/db/migrate.ts`, `tests/server/db/migrate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/db/migrate.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";

function setup() {
  const tmp = mkdtempSync(join(tmpdir(), "minifold-mig-"));
  const migrationsDir = join(tmp, "migrations");
  mkdirSync(migrationsDir);
  const db = createDatabase(join(tmp, "test.db"));
  return { tmp, migrationsDir, db };
}

describe("runMigrations", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("creates schema_migrations table on first run", () => {
    const { tmp, migrationsDir, db } = setup();
    cleanup = () => {
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    };

    runMigrations(db, migrationsDir);

    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
      )
      .get();
    expect(table).toBeDefined();
  });

  it("applies migrations in filename order and records them", () => {
    const { tmp, migrationsDir, db } = setup();
    cleanup = () => {
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    };

    writeFileSync(
      join(migrationsDir, "001_a.sql"),
      "CREATE TABLE a (id INTEGER PRIMARY KEY);",
    );
    writeFileSync(
      join(migrationsDir, "002_b.sql"),
      "CREATE TABLE b (id INTEGER PRIMARY KEY);",
    );

    runMigrations(db, migrationsDir);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('a','b') ORDER BY name",
      )
      .all();
    expect(tables).toEqual([{ name: "a" }, { name: "b" }]);

    const applied = db
      .prepare("SELECT name FROM schema_migrations ORDER BY name")
      .all();
    expect(applied).toEqual([{ name: "001_a.sql" }, { name: "002_b.sql" }]);
  });

  it("is idempotent — already-applied migrations are skipped", () => {
    const { tmp, migrationsDir, db } = setup();
    cleanup = () => {
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    };

    writeFileSync(
      join(migrationsDir, "001_a.sql"),
      "CREATE TABLE a (id INTEGER PRIMARY KEY);",
    );

    runMigrations(db, migrationsDir);
    // Second run must not re-execute the CREATE TABLE (which would throw).
    expect(() => runMigrations(db, migrationsDir)).not.toThrow();
  });

  it("rolls back a failing migration in a transaction", () => {
    const { tmp, migrationsDir, db } = setup();
    cleanup = () => {
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    };

    writeFileSync(
      join(migrationsDir, "001_bad.sql"),
      "CREATE TABLE ok (id INTEGER); CREATE TABLE broken (;",
    );

    expect(() => runMigrations(db, migrationsDir)).toThrow();
    const ok = db
      .prepare("SELECT name FROM sqlite_master WHERE name='ok'")
      .get();
    expect(ok).toBeUndefined();
    const applied = db
      .prepare("SELECT name FROM schema_migrations WHERE name='001_bad.sql'")
      .get();
    expect(applied).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/server/db/migrate.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/server/db/migrate.ts`:

```ts
import type { Database } from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function runMigrations(db: Database, migrationsDir: string): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`,
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const isApplied = db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?");
  const record = db.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
  );

  for (const file of files) {
    if (isApplied.get(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const tx = db.transaction(() => {
      db.exec(sql);
      record.run(file, Date.now());
    });
    tx();
  }
}
```

- [ ] **Step 4: Run — should pass**

```bash
pnpm test tests/server/db/migrate.test.ts
```

Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/migrate.ts tests/server/db/migrate.test.ts
git commit -m "feat: add SQLite migration runner with transactional apply"
```

---

## Task 5: Initial schema migration (settings table)

**Files:**
- Create: `src/server/db/migrations/001_init.sql`, `tests/server/db/migrations.test.ts`

- [ ] **Step 1: Write the migration**

Create `src/server/db/migrations/001_init.sql`:

```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Rationale: subsequent phases add `users`, `sessions`, `providers`, `dir_cache` as their own migrations. Phase 1 only needs `settings` because DB lifecycle work lives here and future `session_secret`/`app_name`/etc. persist into this table.

- [ ] **Step 2: Write a test that runs the real bundled migrations**

Create `tests/server/db/migrations.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";

describe("bundled migrations", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("applies 001_init and creates the settings table", () => {
    const tmp = mkdtempSync(join(tmpdir(), "minifold-init-"));
    const db = createDatabase(join(tmp, "test.db"));
    cleanup = () => {
      db.close();
      rmSync(tmp, { recursive: true, force: true });
    };

    const dir = resolve(process.cwd(), "src/server/db/migrations");
    runMigrations(db, dir);

    const cols = db.prepare("PRAGMA table_info(settings)").all() as Array<{
      name: string;
    }>;
    expect(cols.map((c) => c.name).sort()).toEqual(["key", "value"]);
  });
});
```

- [ ] **Step 3: Run test**

```bash
pnpm test tests/server/db/migrations.test.ts
```

Expected: `1 passed`.

- [ ] **Step 4: Commit**

```bash
git add src/server/db/migrations/001_init.sql tests/server/db/migrations.test.ts
git commit -m "feat: add initial settings table migration"
```

---

## Task 6: DB singleton + bootstrap (lazy migrations) (TDD)

**Files:**
- Create: `src/server/db/index.ts`, `tests/server/db/bootstrap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/db/bootstrap.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("getDatabase (singleton)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "minifold-boot-"));
    vi.stubEnv("DATABASE_PATH", join(tmp, "minifold.db"));
    vi.resetModules();
  });

  afterEach(async () => {
    const mod = await import("@/server/db");
    mod.__resetDatabase();
    rmSync(tmp, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("returns the same instance across calls", async () => {
    const { getDatabase } = await import("@/server/db");
    const a = getDatabase();
    const b = getDatabase();
    expect(a).toBe(b);
  });

  it("applies bundled migrations on first call", async () => {
    const { getDatabase } = await import("@/server/db");
    const db = getDatabase();
    const cols = db
      .prepare("PRAGMA table_info(settings)")
      .all() as Array<{ name: string }>;
    expect(cols.length).toBeGreaterThan(0);
  });

  it("respects DATABASE_PATH env var", async () => {
    const { getDatabase } = await import("@/server/db");
    const db = getDatabase();
    expect(db.name).toBe(join(tmp, "minifold.db"));
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/server/db/bootstrap.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the bootstrap**

Create `src/server/db/index.ts`:

```ts
import type { Database } from "better-sqlite3";
import { resolve } from "node:path";
import { createDatabase } from "./client";
import { runMigrations } from "./migrate";

let instance: Database | null = null;

const DEFAULT_DB_PATH = resolve(process.cwd(), "data/minifold.db");
const MIGRATIONS_DIR = resolve(process.cwd(), "src/server/db/migrations");

export function getDatabase(): Database {
  if (instance) return instance;
  const path = process.env.DATABASE_PATH ?? DEFAULT_DB_PATH;
  const db = createDatabase(path);
  runMigrations(db, MIGRATIONS_DIR);
  instance = db;
  return db;
}

// Test-only: allow tests to reset the singleton between runs.
export function __resetDatabase(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
```

Note: paths resolve from `process.cwd()`. In dev and test runs that's the repo root. In the Next.js standalone production build, `process.cwd()` is `/app` (the Docker `WORKDIR`), and `outputFileTracingIncludes` (configured in Task 1) ensures `src/server/db/migrations/*.sql` is copied there.

- [ ] **Step 4: Run — should pass**

```bash
pnpm test tests/server/db/bootstrap.test.ts
```

Expected: `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/index.ts tests/server/db/bootstrap.test.ts
git commit -m "feat: add lazy DB singleton with auto-migrations"
```

---

## Task 7: tRPC server skeleton + health router (TDD)

**Files:**
- Create: `src/server/trpc/trpc.ts`, `src/server/trpc/router.ts`, `src/server/trpc/routers/health.ts`, `tests/server/trpc/health.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/trpc/health.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { appRouter } from "@/server/trpc/router";

describe("health router", () => {
  it("returns status: ok", async () => {
    const caller = appRouter.createCaller({});
    const result = await caller.health.check();
    expect(result).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/server/trpc/health.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write tRPC init**

Create `src/server/trpc/trpc.ts`:

```ts
import { initTRPC } from "@trpc/server";
import superjson from "superjson";

export type TRPCContext = {
  // Future phases add: userId, db, request headers, etc.
};

export async function createTRPCContext(): Promise<TRPCContext> {
  return {};
}

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
```

- [ ] **Step 4: Write the health router**

Create `src/server/trpc/routers/health.ts`:

```ts
import { publicProcedure, router } from "../trpc";

export const healthRouter = router({
  check: publicProcedure.query(() => {
    return { status: "ok" as const };
  }),
});
```

- [ ] **Step 5: Write the root router**

Create `src/server/trpc/router.ts`:

```ts
import { router } from "./trpc";
import { healthRouter } from "./routers/health";

export const appRouter = router({
  health: healthRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 6: Run — should pass**

```bash
pnpm test tests/server/trpc/health.test.ts
```

Expected: `1 passed`.

- [ ] **Step 7: Commit**

```bash
git add src/server/trpc tests/server/trpc
git commit -m "feat: add tRPC server with health router"
```

---

## Task 8: tRPC Next.js route handler

**Files:**
- Create: `src/app/api/trpc/[trpc]/route.ts`

- [ ] **Step 1: Write the handler**

Create `src/app/api/trpc/[trpc]/route.ts`:

```ts
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: createTRPCContext,
  });

export { handler as GET, handler as POST };
```

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm typecheck
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/trpc/\[trpc\]/route.ts
git commit -m "feat: mount tRPC fetch handler in Next.js"
```

---

## Task 9: tRPC React Query client + provider

**Files:**
- Create: `src/trpc/client.ts`, `src/trpc/Provider.tsx`

- [ ] **Step 1: Write the typed client**

Create `src/trpc/client.ts`:

```ts
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@/server/trpc/router";

export const trpc = createTRPCReact<AppRouter>();
```

- [ ] **Step 2: Write the provider**

Create `src/trpc/Provider.tsx`:

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { useState, type ReactNode } from "react";
import { trpc } from "./client";

export function TRPCProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000 },
        },
      }),
  );
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
```

- [ ] **Step 3: Verify typecheck passes**

```bash
pnpm typecheck
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/trpc
git commit -m "feat: add tRPC React Query client and provider"
```

---

## Task 10: Sidebar component (TDD)

**Files:**
- Create: `src/components/shell/Sidebar.tsx`, `tests/components/shell/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/shell/Sidebar.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Sidebar } from "@/components/shell/Sidebar";

describe("Sidebar", () => {
  it("renders the app name", () => {
    render(<Sidebar />);
    expect(screen.getByText("Minifold")).toBeInTheDocument();
  });

  it("has an admin link at the bottom", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /admin/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/components/shell/Sidebar.test.tsx
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the component**

Create `src/components/shell/Sidebar.tsx`:

```tsx
import Link from "next/link";

export function Sidebar() {
  return (
    <aside className="flex h-full w-64 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex h-14 items-center px-4 text-lg font-semibold">
        Minifold
      </div>
      <nav className="flex-1 overflow-y-auto px-2">
        {/* Provider list + folders populated in Phase 3+ */}
      </nav>
      <div className="border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <Link
          href="/admin"
          className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          Admin
        </Link>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run — should pass**

```bash
pnpm test tests/components/shell/Sidebar.test.tsx
```

Expected: `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/Sidebar.tsx tests/components/shell/Sidebar.test.tsx
git commit -m "feat: add sidebar shell component"
```

---

## Task 11: TopBar component with hamburger toggle (TDD)

**Files:**
- Create: `src/components/shell/TopBar.tsx`, `tests/components/shell/TopBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/shell/TopBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { TopBar } from "@/components/shell/TopBar";

describe("TopBar", () => {
  it("shows the app name", () => {
    render(<TopBar onToggleMenu={() => {}} />);
    expect(screen.getByText("Minifold")).toBeInTheDocument();
  });

  it("calls onToggleMenu when the hamburger is clicked", async () => {
    const onToggle = vi.fn();
    render(<TopBar onToggleMenu={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/components/shell/TopBar.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Write the component**

Create `src/components/shell/TopBar.tsx`:

```tsx
"use client";

type Props = {
  onToggleMenu: () => void;
};

export function TopBar({ onToggleMenu }: Props) {
  return (
    <header className="flex h-14 items-center border-b border-neutral-200 bg-white px-4 md:hidden dark:border-neutral-800 dark:bg-neutral-950">
      <button
        type="button"
        aria-label="Menu"
        onClick={onToggleMenu}
        className="mr-3 rounded p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <path
            d="M3 5h14M3 10h14M3 15h14"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <span className="font-semibold">Minifold</span>
    </header>
  );
}
```

- [ ] **Step 4: Run — should pass**

```bash
pnpm test tests/components/shell/TopBar.test.tsx
```

Expected: `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/TopBar.tsx tests/components/shell/TopBar.test.tsx
git commit -m "feat: add mobile top bar with hamburger toggle"
```

---

## Task 12: AppShell composition (sidebar + drawer + content)

**Files:**
- Create: `src/components/shell/AppShell.tsx`

- [ ] **Step 1: Write the composition**

Create `src/components/shell/AppShell.tsx`:

```tsx
"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setDrawerOpen(false)}
        >
          <div className="h-full w-64" onClick={(e) => e.stopPropagation()}>
            <Sidebar />
          </div>
        </div>
      )}

      <div className="flex min-h-screen flex-1 flex-col">
        <TopBar onToggleMenu={() => setDrawerOpen((v) => !v)} />
        <main className="flex-1 overflow-auto p-4">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm typecheck
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/shell/AppShell.tsx
git commit -m "feat: compose app shell with mobile drawer"
```

---

## Task 13: Wire root layout + home page

**Files:**
- Modify: `src/app/layout.tsx`, `src/app/page.tsx`

- [ ] **Step 1: Replace `src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import "./globals.css";
import { TRPCProvider } from "@/trpc/Provider";
import { AppShell } from "@/components/shell/AppShell";

export const metadata: Metadata = {
  title: "Minifold",
  description: "Self-hosted file browser",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-50">
        <TRPCProvider>
          <AppShell>{children}</AppShell>
        </TRPCProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Replace `src/app/page.tsx`**

```tsx
export default function Home() {
  return (
    <div className="flex h-full items-center justify-center text-neutral-500">
      <p>Welcome to Minifold.</p>
    </div>
  );
}
```

- [ ] **Step 3: Leave `src/app/globals.css` untouched**

`create-next-app` populates it with the Tailwind v4 import (`@import "tailwindcss";`). That's sufficient for this phase.

- [ ] **Step 4: Start dev server and verify manually**

```bash
pnpm dev
```

Open `http://localhost:3000` — expected:
- Desktop (≥768px viewport): sidebar on the left with "Minifold" header and "Admin" link at the bottom; main area shows "Welcome to Minifold."
- Mobile (<768px via browser devtools responsive mode): top bar with hamburger; tapping it opens a drawer containing the sidebar.

Visit `http://localhost:3000/api/trpc/health.check?batch=1&input=%7B%220%22%3A%7B%7D%7D` — expected: JSON response whose `result.data.json.status` equals `"ok"` (superjson wraps it).

Kill the dev server (`Ctrl-C`).

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx src/app/page.tsx
git commit -m "feat: wire root layout with tRPC provider and app shell"
```

---

## Task 14: Full lint + typecheck + test + build sweep

This is a gate before touching Docker. Do not skip.

- [ ] **Step 1: Run the full sweep**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: every command passes. `pnpm build` must emit `.next/standalone/server.js` and `.next/standalone/src/server/db/migrations/001_init.sql` (verify the migration was traced into standalone).

- [ ] **Step 2: Verify migration tracing**

```bash
ls .next/standalone/src/server/db/migrations/
```

Expected: `001_init.sql` listed. If missing, re-check `outputFileTracingIncludes` in `next.config.ts` (Task 1 step 4).

- [ ] **Step 3: Fix any failures before continuing**

If any step fails, stop here, diagnose the root cause, fix it, commit the fix, and re-run the sweep. Do not proceed with a red tree.

---

## Task 15: Dockerfile (multi-stage standalone build)

**Files:**
- Create: `Dockerfile`, `.dockerignore`

- [ ] **Step 1: Write `.dockerignore`**

```
node_modules
.next
.git
.github
tests
docs
.superpowers
*.md
.env*
coverage
Dockerfile
docker-compose*.yml
data
```

- [ ] **Step 2: Write `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
RUN corepack enable

# ---- deps ----
FROM base AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM base AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- runner ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_PATH=/app/data/minifold.db

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs \
 && mkdir -p /app/data \
 && chown -R nextjs:nodejs /app

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

Notes for the engineer:
- `better-sqlite3` ships prebuilt binaries for `linux-x64-glibc`, which `bookworm-slim` satisfies. The build-stage deps (`python3 make g++`) are a safety net in case `pnpm install` falls back to source.
- Migrations are bundled into `.next/standalone/src/server/db/migrations/` via `outputFileTracingIncludes`, so no explicit COPY is needed.
- `/app/data` is owned by `nextjs` so the runtime user can create `minifold.db`.

- [ ] **Step 3: Build the image**

```bash
docker build -t minifold:local .
```

Expected: successful build. Final image size should be under 300 MB (`docker images minifold:local`).

- [ ] **Step 4: Run it**

```bash
docker run --rm -p 3000:3000 -v minifold-data:/app/data minifold:local
```

In another shell:

```bash
curl -s 'http://localhost:3000/api/trpc/health.check?batch=1&input=%7B%220%22%3A%7B%7D%7D'
```

Expected: JSON containing `"status":"ok"`.

Open `http://localhost:3000` in a browser — expected: the same shell as the dev server.

Kill the container with `Ctrl-C` in the first shell.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: add multi-stage Dockerfile for standalone build"
```

---

## Task 16: docker-compose.yml

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  minifold:
    build: .
    image: minifold:local
    ports:
      - "3000:3000"
    environment:
      DATABASE_PATH: /app/data/minifold.db
    volumes:
      - minifold-data:/app/data
    restart: unless-stopped

volumes:
  minifold-data:
```

- [ ] **Step 2: Smoke test**

```bash
docker compose up --build -d
sleep 5
curl -s 'http://localhost:3000/api/trpc/health.check?batch=1&input=%7B%220%22%3A%7B%7D%7D' | grep -q '"status":"ok"'
echo "health check exit: $?"
docker compose down
```

Expected: `health check exit: 0`.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add docker-compose for local deployment"
```

---

## Task 17: Final verification gate

This task produces no code. It verifies that Phase 1 is complete and Phase 2 can begin.

- [ ] **Step 1: Run the full local gauntlet**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: every step passes.

- [ ] **Step 2: Run the containerized gauntlet**

```bash
docker compose build --no-cache
docker compose up -d
sleep 5
curl -sf 'http://localhost:3000/' > /dev/null
curl -s 'http://localhost:3000/api/trpc/health.check?batch=1&input=%7B%220%22%3A%7B%7D%7D' | grep -q '"status":"ok"'
docker compose down
```

Expected: both `curl` commands succeed.

- [ ] **Step 3: Confirm exit criteria (below)**

If any criterion is unmet, file a fix task, do not proceed to Phase 2.

---

## Foundation phase exit criteria

Before moving to Phase 2 (Auth + Setup Wizard), confirm all of the following:

- ✅ `pnpm test` passes with 14+ tests green (smoke + client 3 + migrate 4 + migrations 1 + bootstrap 3 + health 1 + sidebar 2 + topbar 2).
- ✅ `pnpm typecheck` passes.
- ✅ `pnpm lint` passes.
- ✅ `pnpm build` emits `.next/standalone/server.js` and `.next/standalone/src/server/db/migrations/001_init.sql`.
- ✅ Docker image builds and runs; app shell renders and `/api/trpc/health.check` returns `{status: "ok"}`.
- ✅ `getDatabase()` returns a singleton with WAL mode enabled and foreign keys on; `DATABASE_PATH` env var is respected.
- ✅ The migration runner is idempotent and transactional; `001_init.sql` creates the `settings` table.
- ✅ Layout renders on desktop (sidebar visible, top bar hidden) and mobile (top bar visible, sidebar opens as a drawer).

---

## Self-Review Notes

**Spec coverage (Phase 1 scope only):**
- §2 Architecture stack (Next.js 15, TS, tRPC v11, SQLite via better-sqlite3) — Tasks 1, 3, 7
- §2 Environment variable `DATABASE_PATH` — Task 6 (`PORT` handled by Next.js default + Dockerfile env)
- §2 Container (standalone build, `/data` volume) — Tasks 14, 15, 16
- §10 App shell (sidebar, top bar, mobile drawer) — Tasks 10-13
- §13 SQLite WAL mode — Task 3
- §15 `settings` table — Task 5

**Out of scope, deferred (confirmed):**
- `users`, `sessions`, `providers`, `dir_cache` tables → Phases 2, 3, 6
- `SESSION_SECRET` auto-generation → Phase 2 (needs setup wizard)
- Accent color CSS variable → Phase 8 (needs settings UI)
- All file-browsing, thumbnail, viewer, access-control features → Phases 3-9
