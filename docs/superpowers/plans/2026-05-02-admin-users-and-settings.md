# Phase 8 — Admin Users & Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/admin/users` (full lifecycle: add / deactivate / activate / delete / promote / demote / reset-password), `/admin/settings` (app name, logo upload-or-URL, accent colour with WCAG AA clamp + suggestion), and `/change-password` (forced + voluntary), so operators never need `docker exec` for routine tasks. Land settings infrastructure (DB-backed `app_name` + `accent_color` as a CSS variable) that Phase 9 (PWA) will consume.

**Architecture:** Same pattern as `/admin/providers` — RSC pages load via `getDatabase()`, render thin client shells, mutations go through Server Actions with Zod validation. New domain modules — `src/server/auth/users-admin.ts` (last-admin guards), `src/server/auth/contrast.ts` (WCAG ratios + nearest-accessible suggestion), `src/server/db/settings.ts` (extended) — are pure functions consumed by the actions. The accent colour reaches components via a `--accent` CSS variable on `<html>`, exposed as Tailwind's `accent-*` utilities through the existing `@theme inline` block in `src/app/globals.css`.

**Tech Stack:** Next.js 16 App Router, React 19 (`useActionState`), TypeScript with `noUncheckedIndexedAccess: true`, better-sqlite3, Tailwind v4 (CSS-first config), Vitest + happy-dom + `@testing-library/react`, bcryptjs, Zod, `chroma-js` (new dep).

**Spec:** `docs/superpowers/specs/2026-05-02-admin-users-and-settings-design.md`

---

## Conventions & Reminders

- **Indexed access is `T | undefined`** (`noUncheckedIndexedAccess`): always guard `arr[i]`, `obj[k]`.
- **Username storage:** lowercased on write, lowercased on lookup (existing `createUser` does this). Validate `[a-z0-9_-]{3,64}`.
- **Server Actions return shape:** `{ success?: true; ... } | { error?: string; fieldErrors?: Record<string,string> }`. Match the `/admin/providers/actions.ts` pattern.
- **Test isolation pattern** (proven in `tests/app/admin/providers/actions.test.ts`): mock `next/cache` + `next/navigation`, seed a real DB at a temp path via `vi.stubEnv("DATABASE_PATH", ...)`, `vi.resetModules()` before each import to pick up the env, call `__resetDatabase()` from `@/server/db` in `afterEach`.
- **Commits:** small, conventional-commit style (`feat(users)`, `feat(settings)`, `test(contrast)`, `chore(deps)`).
- **Run after each code-touching task:** `npm test -- <changed-test-files>` and ensure pass before committing.
- **Run before final task:** `npm run typecheck` and ensure pass.

## Deviation from spec

The spec section §3.3 mentioned "**Refactor scope:** existing CLI commands move to call into this module." **This task is dropped** because `bin/cli.mjs` is a self-contained `.mjs` script that runs unbuilt JavaScript directly — importing TypeScript modules from `src/` would require a build step that changes the deployment story. The duplication (last-admin guard logic, ~10 lines repeated in two places) is small and well-localised; risk of drift is low. The CLI continues using its inline implementations.

Also: `src/server/db/settings.ts` already exists with `getSetting` and `setSetting`. Task 2 only adds `getAllSettings`, not the whole module.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `src/server/db/migrations/006_seed_phase_8_settings.sql` | Seed `app_name`, `logo_url`, `accent_color` keys |
| `src/server/auth/contrast.ts` | `wcagContrast`, `validateAccent`, `nearestAccessible`, `LIGHT_BG`, `DARK_BG` |
| `src/server/auth/users-admin.ts` | Last-admin-guarded user ops + password generation |
| `src/server/auth/random-password.ts` | 16-char Crockford-base32 generator (factored for reuse) |
| `src/server/settings/logo-storage.ts` | File-system writes for `/data/logo.<ext>` |
| `src/app/admin/users/page.tsx` | RSC: load users, render client shell |
| `src/app/admin/users/actions.ts` | 7 Server Actions |
| `src/app/admin/settings/page.tsx` | RSC: load settings, render client shell |
| `src/app/admin/settings/actions.ts` | 4 Server Actions |
| `src/app/change-password/page.tsx` | Form page |
| `src/app/change-password/actions.ts` | `changePassword` |
| `src/app/api/logo/route.ts` | GET handler streaming `/data/logo.<ext>` |
| `src/components/SettingsContext.tsx` | Client context: `appName`, `accent`, `logoUrl` |
| `src/components/admin/AdminNav.tsx` | Tabbed nav |
| `src/components/admin/UsersPageClient.tsx` | List + slide-over open/close + delete & reset modals |
| `src/components/admin/AddUserSlideOver.tsx` | Two-screen state machine |
| `src/components/admin/UserRowActions.tsx` | `⋯` dropdown |
| `src/components/admin/SettingsPageClient.tsx` | Three-card wrapper |
| `src/components/admin/AppNameForm.tsx` | App-name card |
| `src/components/admin/LogoForm.tsx` | Logo card |
| `src/components/admin/AccentColorForm.tsx` | Accent picker + contrast UI |

**New test files:**

| Path |
|---|
| `tests/server/auth/contrast.test.ts` |
| `tests/server/auth/users-admin.test.ts` |
| `tests/server/auth/random-password.test.ts` |
| `tests/server/settings/logo-storage.test.ts` |
| `tests/server/db/settings.test.ts` (extended — file exists) |
| `tests/server/db/migrate.test.ts` (extended — file exists) |
| `tests/app/admin/users/actions.test.ts` |
| `tests/app/admin/settings/actions.test.ts` |
| `tests/app/change-password/actions.test.ts` |
| `tests/app/api/logo/route.test.ts` |
| `tests/components/admin/AddUserSlideOver.test.tsx` |
| `tests/components/admin/AccentColorForm.test.tsx` |
| `tests/components/admin/AdminNav.test.tsx` |

**Modified files:**

| Path | Change |
|---|---|
| `src/server/db/settings.ts` | Add `getAllSettings` |
| `src/app/globals.css` | Add `--accent` CSS var + `--color-accent` in `@theme inline` |
| `src/app/layout.tsx` | Make async, read settings, inject `--accent` style, dynamic `<title>`, redirect-to-`/change-password` gate, provide `SettingsContext` |
| `src/app/admin/layout.tsx` | Add `<AdminNav>` above children |
| `src/components/shell/Sidebar.tsx` | Read `appName` from context (or props) for header; show "Change password" link |
| `package.json` | Add `chroma-js` |

---

## Task 1: Add chroma-js dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install chroma-js**

Run:
```bash
npm install chroma-js
npm install -D @types/chroma-js
```

Expected: package.json gains `"chroma-js": "^3.x"` and `"@types/chroma-js": "^3.x"`.

- [ ] **Step 2: Verify install**

Run:
```bash
node -e "console.log(require('chroma-js')('#3b82f6').oklch())"
```
Expected: an array of three numbers printed (something like `[0.55, 0.21, 263]`).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add chroma-js for accent colour OKLCH math"
```

---

## Task 2: Migration 006 — seed Phase 8 settings keys

**Files:**
- Create: `src/server/db/migrations/006_seed_phase_8_settings.sql`
- Modify: `tests/server/db/migrate.test.ts` (file exists; add an assertion)

- [ ] **Step 1: Write the failing migration test**

Open `tests/server/db/migrate.test.ts` and add a new test inside the existing `describe` block (verify the existing top-of-file imports include `getSetting` from `@/server/db/settings`; if missing, add it). Append:

```ts
it("006 seeds phase 8 settings (app_name, logo_url, accent_color)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "minifold-mig-006-"));
  const db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
  expect(getSetting(db, "app_name")).toBe("Minifold");
  expect(getSetting(db, "logo_url")).toBe("");
  expect(getSetting(db, "accent_color")).toBe("#3b82f6");
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

it("006 is idempotent (re-running migrations does not overwrite changed values)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "minifold-mig-006b-"));
  const db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
  // Operator has changed the app name; re-running migrations should not revert it.
  setSetting(db, "app_name", "MyFiles");
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
  expect(getSetting(db, "app_name")).toBe("MyFiles");
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});
```

If `setSetting` isn't imported at the top of the file, add it: `import { getSetting, setSetting } from "@/server/db/settings";`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/server/db/migrate.test.ts`
Expected: FAIL — `app_name` returns `null` because migration 006 doesn't exist yet.

- [ ] **Step 3: Create the migration file**

Create `src/server/db/migrations/006_seed_phase_8_settings.sql`:

```sql
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('app_name',     'Minifold'),
  ('logo_url',     ''),
  ('accent_color', '#3b82f6');
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/server/db/migrate.test.ts`
Expected: PASS for both new cases.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/migrations/006_seed_phase_8_settings.sql tests/server/db/migrate.test.ts
git commit -m "feat(db): seed phase 8 settings (app_name, logo_url, accent_color)"
```

---

## Task 3: Extend settings module with `getAllSettings`

**Files:**
- Modify: `src/server/db/settings.ts`
- Modify: `tests/server/db/settings.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/server/db/settings.test.ts` inside the `describe("settings repository", ...)` block:

```ts
it("getAllSettings returns an object with every key/value", () => {
  setSetting(db, "alpha", "1");
  setSetting(db, "beta", "two");
  const all = getAllSettings(db);
  expect(all.alpha).toBe("1");
  expect(all.beta).toBe("two");
});

it("getAllSettings returns an empty object when no settings exist", () => {
  // The seeded keys (config_encryption_key, global_default_access, app_name, logo_url, accent_color)
  // are present after migrations. Just verify the shape is Record<string,string>.
  const all = getAllSettings(db);
  for (const v of Object.values(all)) expect(typeof v).toBe("string");
});
```

Update the import at the top:

```ts
import { getSetting, setSetting, getAllSettings } from "@/server/db/settings";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/server/db/settings.test.ts`
Expected: FAIL — `getAllSettings` not exported.

- [ ] **Step 3: Implement `getAllSettings`**

Append to `src/server/db/settings.ts`:

```ts
export function getAllSettings(db: Database): Record<string, string> {
  const rows = db
    .prepare("SELECT key, value FROM settings")
    .all() as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/server/db/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/settings.ts tests/server/db/settings.test.ts
git commit -m "feat(settings): add getAllSettings repository helper"
```

---

## Task 4: Random password generator (Crockford base32)

**Files:**
- Create: `src/server/auth/random-password.ts`
- Create: `tests/server/auth/random-password.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/auth/random-password.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generatePassword } from "@/server/auth/random-password";

describe("generatePassword", () => {
  it("returns a 16-character string by default", () => {
    expect(generatePassword()).toHaveLength(16);
  });

  it("uses the Crockford base32 alphabet (no 0/O/I/L/U)", () => {
    // 1000 samples — accumulate the union of all characters seen.
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      for (const c of generatePassword()) seen.add(c);
    }
    // None of the confusing characters should appear.
    for (const banned of ["0", "O", "I", "L", "U", "o", "i", "l", "u"]) {
      expect(seen.has(banned)).toBe(false);
    }
  });

  it("returns different values across calls (high entropy)", () => {
    const s = new Set<string>();
    for (let i = 0; i < 100; i++) s.add(generatePassword());
    expect(s.size).toBe(100);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/server/auth/random-password.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the generator**

Create `src/server/auth/random-password.ts`:

```ts
import { randomBytes } from "node:crypto";

// Crockford base32: 0-9 + A-Z minus I, L, O, U. 32 symbols.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generatePassword(length = 16): string {
  if (length <= 0) throw new Error("generatePassword: length must be > 0");
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    const byte = bytes[i] ?? 0;
    out += ALPHABET[byte % 32];
  }
  return out;
}
```

Note: the alphabet's "0" character is required by Crockford's spec, but it appears identical to "O" — Crockford excludes "O", not "0". The test bans BOTH; we must drop "0" from the alphabet too. Update the alphabet to exclude "0" as well (matches the spec text "no confusing 0/O/l/1"):

```ts
const ALPHABET = "123456789ABCDEFGHJKMNPQRSTVWXYZ"; // 31 chars (no 0, I, L, O, U)
```

Adjust the modulo accordingly:

```ts
out += ALPHABET[byte % ALPHABET.length] ?? "";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/server/auth/random-password.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/random-password.ts tests/server/auth/random-password.test.ts
git commit -m "feat(auth): random-password generator with no-confusion alphabet"
```

---

## Task 5: Contrast module

**Files:**
- Create: `src/server/auth/contrast.ts`
- Create: `tests/server/auth/contrast.test.ts`

**Threshold:** 3:1 (WCAG 1.4.11 Non-text Contrast — see spec §6 for rationale). Accent colour is used for UI components (buttons, focus rings, active-state highlights), not normal text. A 4.5:1 ratio against both `#ffffff` and `#0a0a0a` is mathematically unsatisfiable.

- [ ] **Step 1: Write the failing tests for `wcagContrast`**

Create `tests/server/auth/contrast.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  wcagContrast,
  validateAccent,
  nearestAccessible,
  LIGHT_BG,
  DARK_BG,
} from "@/server/auth/contrast";

describe("wcagContrast", () => {
  it("computes 21:1 for black on white (max contrast)", () => {
    expect(wcagContrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("computes 1:1 for the same colour on itself", () => {
    expect(wcagContrast("#777777", "#777777")).toBeCloseTo(1, 1);
  });

  it("returns a contrast ratio greater than 1 for distinct colours", () => {
    expect(wcagContrast("#595959", "#ffffff")).toBeGreaterThan(5);
  });
});

describe("validateAccent (3:1 threshold)", () => {
  it("passes light bg, fails dark bg for black", () => {
    // black on white: ~21 (passes); black on #0a0a0a: ~1 (fails).
    const r = validateAccent("#000000");
    expect(r.light.passes).toBe(true);
    expect(r.dark.passes).toBe(false);
    expect(r.passes).toBe(false);
  });

  it("passes both backgrounds for the seeded default #3b82f6 at 3:1", () => {
    // #3b82f6 has ~3.7:1 on white (passes) and ~5.4:1 on #0a0a0a (passes) — both ≥ 3.
    const r = validateAccent("#3b82f6");
    expect(r.light.passes).toBe(true);
    expect(r.dark.passes).toBe(true);
    expect(r.passes).toBe(true);
  });

  it("includes the actual ratios in the report", () => {
    const r = validateAccent("#3b82f6");
    expect(r.light.ratio).toBeGreaterThan(3);
    expect(r.dark.ratio).toBeGreaterThan(3);
  });

  it("fails for a colour too close to white in luminance", () => {
    // #f0f0f0 is very light — fails on white.
    const r = validateAccent("#f0f0f0");
    expect(r.light.passes).toBe(false);
    expect(r.passes).toBe(false);
  });
});

describe("nearestAccessible", () => {
  it("returns the input unchanged when already passing", () => {
    expect(nearestAccessible("#3b82f6")).toBe("#3b82f6");
  });

  it("returns a passing colour for a failing input — bright red", () => {
    const out = nearestAccessible("#ff5555");
    expect(validateAccent(out).passes).toBe(true);
  });

  it("returns a passing colour for a failing input — light yellow", () => {
    const out = nearestAccessible("#ffff77");
    expect(validateAccent(out).passes).toBe(true);
  });

  it("returns a passing colour for a failing input — near-white", () => {
    const out = nearestAccessible("#f0f0f0");
    expect(validateAccent(out).passes).toBe(true);
  });
});

describe("background constants", () => {
  it("exports LIGHT_BG and DARK_BG matching the design", () => {
    expect(LIGHT_BG).toBe("#ffffff");
    expect(DARK_BG).toBe("#0a0a0a");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/server/auth/contrast.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the contrast module**

Create `src/server/auth/contrast.ts`:

```ts
import chroma from "chroma-js";

export const LIGHT_BG = "#ffffff";
export const DARK_BG = "#0a0a0a";
// 3:1 — WCAG 1.4.11 Non-text Contrast (UI components / AA Large).
// Accent colour is used for buttons, focus rings, etc. — not normal text.
// 4.5:1 against both bgs is mathematically unsatisfiable; see spec §6.
const AA_THRESHOLD = 3.0;
const FALLBACK = "#3b82f6";

export function wcagContrast(foreground: string, background: string): number {
  return chroma.contrast(foreground, background);
}

export type ContrastReport = {
  light: { ratio: number; passes: boolean };
  dark: { ratio: number; passes: boolean };
  passes: boolean;
};

export function validateAccent(color: string): ContrastReport {
  const lightRatio = wcagContrast(color, LIGHT_BG);
  const darkRatio = wcagContrast(color, DARK_BG);
  const lightPasses = lightRatio >= AA_THRESHOLD;
  const darkPasses = darkRatio >= AA_THRESHOLD;
  return {
    light: { ratio: lightRatio, passes: lightPasses },
    dark: { ratio: darkRatio, passes: darkPasses },
    passes: lightPasses && darkPasses,
  };
}

/**
 * Walks OKLCH lightness in both directions, returning the passing candidate
 * closest to the original by Euclidean distance in OKLCH space.
 * Falls back to FALLBACK if no value within the full range passes both backgrounds.
 */
export function nearestAccessible(color: string): string {
  const original = chroma(color);
  if (validateAccent(color).passes) return original.hex();

  const [oL, oC, oH] = original.oklch();
  const STEP = 0.02;
  const MAX_ITERS = 100;

  let best: { hex: string; dist: number } | null = null;

  for (const direction of [-1, 1]) {
    for (let i = 1; i <= MAX_ITERS; i++) {
      const newL = oL + direction * STEP * i;
      if (newL < 0 || newL > 1) break;
      // chroma-js OKLCH may produce NaN hue for very desaturated colours; default to 0.
      const candidate = chroma.oklch(newL, oC, Number.isNaN(oH) ? 0 : oH);
      if (!validateAccent(candidate.hex()).passes) continue;
      const [cL, cC, cH] = candidate.oklch();
      const dh = Number.isNaN(cH) || Number.isNaN(oH) ? 0 : cH - oH;
      const dist = Math.sqrt((cL - oL) ** 2 + (cC - oC) ** 2 + (dh / 360) ** 2);
      if (best === null || dist < best.dist) {
        best = { hex: candidate.hex(), dist };
      }
      break; // first passing in this direction is closest in this direction
    }
  }

  return best?.hex ?? FALLBACK;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/server/auth/contrast.test.ts`
Expected: PASS for all six cases.

If the W3C example test (#595959 on white) doesn't match, adjust the expected value to whatever `chroma.contrast` actually returns — chroma uses the same WCAG formula but float precision may differ slightly. The test value `7.0` is approximate; if it's `4.76` instead (different fixture), update accordingly.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/contrast.ts tests/server/auth/contrast.test.ts
git commit -m "feat(auth): WCAG contrast module + nearest-accessible suggestion"
```

---

## Task 6: Users-admin module (last-admin guards + reset)

**Files:**
- Create: `src/server/auth/users-admin.ts`
- Create: `tests/server/auth/users-admin.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/server/auth/users-admin.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createUser, findUserById, findUserByUsername } from "@/server/db/users";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import {
  addUser,
  deactivateUserAdmin,
  activateUserAdmin,
  deleteUserAdmin,
  promoteUserAdmin,
  demoteUserAdmin,
  resetUserPasswordAdmin,
  LastAdminError,
} from "@/server/auth/users-admin";

let tmp: string;
let db: Database;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-users-admin-"));
  db = createDatabase(join(tmp, "test.db"));
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

async function seedAdmin(username: string) {
  return createUser(db, {
    name: username,
    username,
    passwordHash: await hashPassword("seed"),
    role: "admin",
    mustChangePassword: false,
  });
}

async function seedUser(username: string) {
  return createUser(db, {
    name: username,
    username,
    passwordHash: await hashPassword("seed"),
    role: "user",
    mustChangePassword: false,
  });
}

describe("addUser", () => {
  it("creates a user with the supplied password (manual mode)", async () => {
    const result = await addUser(db, {
      name: "Alice",
      username: "alice",
      mode: "manual",
      password: "supersecret",
    });
    expect(result.user.username).toBe("alice");
    expect(result.user.must_change_password).toBe(1);
    expect(result.generatedPassword).toBeUndefined();
    expect(await verifyPassword("supersecret", result.user.password)).toBe(true);
  });

  it("creates a user with a generated password (generate mode)", async () => {
    const result = await addUser(db, {
      name: "Alice",
      username: "alice",
      mode: "generate",
    });
    expect(result.generatedPassword).toBeDefined();
    expect(result.generatedPassword).toHaveLength(16);
    expect(result.user.must_change_password).toBe(1);
    expect(await verifyPassword(result.generatedPassword!, result.user.password)).toBe(true);
  });

  it("lowercases the username", async () => {
    const result = await addUser(db, {
      name: "Alice",
      username: "Alice",
      mode: "generate",
    });
    expect(result.user.username).toBe("alice");
  });
});

describe("deactivateUserAdmin", () => {
  it("sets deactivated=1 and deletes the user's sessions", async () => {
    const u = await seedUser("alice");
    createSession(db, u.id);
    deactivateUserAdmin(db, u.id);
    const after = findUserById(db, u.id)!;
    expect(after.deactivated).toBe(1);
    const n = db.prepare("SELECT COUNT(*) as n FROM sessions WHERE user_id = ?").get(u.id) as { n: number };
    expect(n.n).toBe(0);
  });

  it("refuses to deactivate the last active admin", async () => {
    const u = await seedAdmin("admin");
    expect(() => deactivateUserAdmin(db, u.id)).toThrow(LastAdminError);
  });

  it("allows deactivating an admin when another active admin exists", async () => {
    const a = await seedAdmin("alice");
    await seedAdmin("bob");
    deactivateUserAdmin(db, a.id);
    expect(findUserById(db, a.id)?.deactivated).toBe(1);
  });
});

describe("activateUserAdmin", () => {
  it("clears deactivated", async () => {
    const u = await seedUser("alice");
    deactivateUserAdmin(db, u.id);
    activateUserAdmin(db, u.id);
    expect(findUserById(db, u.id)?.deactivated).toBe(0);
  });
});

describe("deleteUserAdmin", () => {
  it("removes a non-admin user", async () => {
    const u = await seedUser("alice");
    deleteUserAdmin(db, u.id);
    expect(findUserById(db, u.id)).toBeNull();
  });

  it("refuses to delete the last active admin", async () => {
    const u = await seedAdmin("admin");
    expect(() => deleteUserAdmin(db, u.id)).toThrow(LastAdminError);
  });
});

describe("promoteUserAdmin / demoteUserAdmin", () => {
  it("promotes a user to admin", async () => {
    const u = await seedUser("alice");
    promoteUserAdmin(db, u.id);
    expect(findUserById(db, u.id)?.role).toBe("admin");
  });

  it("refuses to demote the last active admin", async () => {
    const u = await seedAdmin("admin");
    expect(() => demoteUserAdmin(db, u.id)).toThrow(LastAdminError);
  });

  it("demotes an admin when another active admin exists", async () => {
    const a = await seedAdmin("alice");
    await seedAdmin("bob");
    demoteUserAdmin(db, a.id);
    expect(findUserById(db, a.id)?.role).toBe("user");
  });
});

describe("resetUserPasswordAdmin", () => {
  it("generates a new password, deletes the user's sessions, sets must_change_password=1", async () => {
    const u = await seedUser("alice");
    createSession(db, u.id);
    const result = await resetUserPasswordAdmin(db, u.id);
    expect(result.generatedPassword).toHaveLength(16);
    const after = findUserById(db, u.id)!;
    expect(after.must_change_password).toBe(1);
    expect(await verifyPassword(result.generatedPassword, after.password)).toBe(true);
    const n = db.prepare("SELECT COUNT(*) as n FROM sessions WHERE user_id = ?").get(u.id) as { n: number };
    expect(n.n).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/server/auth/users-admin.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `src/server/auth/users-admin.ts`:

```ts
import type { Database } from "better-sqlite3";
import {
  createUser as dbCreateUser,
  deleteUser as dbDeleteUser,
  findUserById,
  updateUserPassword,
  updateUserRole,
  type UserRow,
} from "@/server/db/users";
import { destroySessionsForUser } from "@/server/auth/session";
import { hashPassword } from "@/server/auth/password";
import { generatePassword } from "@/server/auth/random-password";

export class LastAdminError extends Error {
  constructor(action: string) {
    super(`Refusing to ${action}: would orphan the last active admin`);
    this.name = "LastAdminError";
  }
}

function countActiveAdmins(db: Database): number {
  const row = db
    .prepare("SELECT COUNT(*) as n FROM users WHERE role = 'admin' AND deactivated = 0")
    .get() as { n: number };
  return row.n;
}

function setDeactivated(db: Database, id: string, value: 0 | 1): void {
  db.prepare("UPDATE users SET deactivated = ? WHERE id = ?").run(value, id);
}

export type AddUserInput =
  | { name: string; username: string; mode: "manual"; password: string }
  | { name: string; username: string; mode: "generate" };

export async function addUser(
  db: Database,
  input: AddUserInput,
): Promise<{ user: UserRow; generatedPassword?: string }> {
  let plain: string;
  let generated: string | undefined;
  if (input.mode === "manual") {
    plain = input.password;
  } else {
    generated = generatePassword();
    plain = generated;
  }
  const passwordHash = await hashPassword(plain);
  const user = dbCreateUser(db, {
    name: input.name,
    username: input.username,
    passwordHash,
    role: "user",
    mustChangePassword: true,
  });
  return { user, generatedPassword: generated };
}

export function deactivateUserAdmin(db: Database, id: string): void {
  const user = findUserById(db, id);
  if (!user) return;
  if (user.role === "admin" && user.deactivated === 0 && countActiveAdmins(db) <= 1) {
    throw new LastAdminError("deactivate");
  }
  setDeactivated(db, id, 1);
  destroySessionsForUser(db, id);
}

export function activateUserAdmin(db: Database, id: string): void {
  setDeactivated(db, id, 0);
}

export function deleteUserAdmin(db: Database, id: string): void {
  const user = findUserById(db, id);
  if (!user) return;
  if (user.role === "admin" && user.deactivated === 0 && countActiveAdmins(db) <= 1) {
    throw new LastAdminError("delete");
  }
  dbDeleteUser(db, id);
}

export function promoteUserAdmin(db: Database, id: string): void {
  updateUserRole(db, id, "admin");
}

export function demoteUserAdmin(db: Database, id: string): void {
  const user = findUserById(db, id);
  if (!user) return;
  if (user.role === "admin" && user.deactivated === 0 && countActiveAdmins(db) <= 1) {
    throw new LastAdminError("demote");
  }
  updateUserRole(db, id, "user");
}

export async function resetUserPasswordAdmin(
  db: Database,
  id: string,
): Promise<{ generatedPassword: string }> {
  const generated = generatePassword();
  const passwordHash = await hashPassword(generated);
  updateUserPassword(db, id, passwordHash, { mustChangePassword: true });
  destroySessionsForUser(db, id);
  return { generatedPassword: generated };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/server/auth/users-admin.test.ts`
Expected: PASS for all cases.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/users-admin.ts tests/server/auth/users-admin.test.ts
git commit -m "feat(auth): users-admin module with last-admin guards"
```

---

## Task 7: Logo storage helper

**Files:**
- Create: `src/server/settings/logo-storage.ts`
- Create: `tests/server/settings/logo-storage.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/server/settings/logo-storage.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeLogo,
  clearLogo,
  resolveLogoPath,
  sniffImageType,
  type LogoExt,
} from "@/server/settings/logo-storage";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-logo-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function webpBuffer(): Buffer {
  // RIFF....WEBP
  const buf = Buffer.alloc(16);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(8, 4);
  buf.write("WEBP", 8, "ascii");
  return buf;
}

describe("sniffImageType", () => {
  it("recognises PNG magic", () => {
    expect(sniffImageType(PNG_MAGIC)).toBe("png");
  });

  it("recognises WebP magic", () => {
    expect(sniffImageType(webpBuffer())).toBe("webp");
  });

  it("recognises SVG (whitespace-tolerant)", () => {
    expect(sniffImageType(Buffer.from('<?xml version="1.0"?><svg></svg>'))).toBe("svg");
    expect(sniffImageType(Buffer.from('   <svg width="1"></svg>'))).toBe("svg");
    expect(sniffImageType(Buffer.from('<SVG></SVG>'))).toBe("svg");
  });

  it("returns null for unrecognised content (e.g. text)", () => {
    expect(sniffImageType(Buffer.from("hello world"))).toBeNull();
  });
});

describe("writeLogo", () => {
  it("writes the file to /<dir>/logo.<ext> based on the sniffed type", async () => {
    await writeLogo(tmp, PNG_MAGIC);
    expect(existsSync(join(tmp, "logo.png"))).toBe(true);
  });

  it("returns the extension that was sniffed", async () => {
    const result = await writeLogo(tmp, webpBuffer());
    expect(result).toBe("webp");
  });

  it("rejects unrecognised content", async () => {
    await expect(writeLogo(tmp, Buffer.from("not an image"))).rejects.toThrow(/unsupported/i);
  });

  it("removes any sibling logo with a different extension", async () => {
    writeFileSync(join(tmp, "logo.svg"), "<svg></svg>");
    await writeLogo(tmp, PNG_MAGIC);
    expect(existsSync(join(tmp, "logo.png"))).toBe(true);
    expect(existsSync(join(tmp, "logo.svg"))).toBe(false);
  });
});

describe("clearLogo", () => {
  it("deletes any logo.<ext> in the directory", async () => {
    writeFileSync(join(tmp, "logo.png"), "x");
    writeFileSync(join(tmp, "logo.svg"), "x");
    clearLogo(tmp);
    expect(existsSync(join(tmp, "logo.png"))).toBe(false);
    expect(existsSync(join(tmp, "logo.svg"))).toBe(false);
  });

  it("is a no-op when no logo exists", () => {
    expect(() => clearLogo(tmp)).not.toThrow();
  });
});

describe("resolveLogoPath", () => {
  it("returns the file path for an existing extension", () => {
    writeFileSync(join(tmp, "logo.png"), "x");
    expect(resolveLogoPath(tmp, "png")).toBe(join(tmp, "logo.png"));
  });

  it("returns null when the file does not exist", () => {
    expect(resolveLogoPath(tmp, "png")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/server/settings/logo-storage.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `src/server/settings/logo-storage.ts`:

```ts
import { writeFile, unlink } from "node:fs/promises";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export type LogoExt = "png" | "svg" | "webp";
export const LOGO_EXTS: readonly LogoExt[] = ["png", "svg", "webp"];

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(buf: Buffer): boolean {
  if (buf.length < PNG_MAGIC.length) return false;
  return PNG_MAGIC.every((b, i) => buf[i] === b);
}

function isWebp(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  return (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  );
}

function isSvg(buf: Buffer): boolean {
  // Tolerate leading whitespace + BOM. Check first ~64 bytes.
  const head = buf.toString("utf8", 0, Math.min(64, buf.length)).trimStart();
  const lower = head.toLowerCase();
  return lower.startsWith("<?xml") || lower.startsWith("<svg");
}

export function sniffImageType(buf: Buffer): LogoExt | null {
  if (isPng(buf)) return "png";
  if (isWebp(buf)) return "webp";
  if (isSvg(buf)) return "svg";
  return null;
}

export async function writeLogo(dir: string, buf: Buffer): Promise<LogoExt> {
  const ext = sniffImageType(buf);
  if (!ext) throw new Error("Unsupported image type (must be PNG, SVG, or WebP)");
  // Remove any sibling logos first.
  for (const e of LOGO_EXTS) {
    if (e === ext) continue;
    const p = join(dir, `logo.${e}`);
    if (existsSync(p)) await unlink(p);
  }
  await writeFile(join(dir, `logo.${ext}`), buf);
  return ext;
}

export function clearLogo(dir: string): void {
  for (const e of LOGO_EXTS) {
    const p = join(dir, `logo.${e}`);
    if (existsSync(p)) unlinkSync(p);
  }
}

export function resolveLogoPath(dir: string, ext: LogoExt): string | null {
  const p = join(dir, `logo.${ext}`);
  return existsSync(p) ? p : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/server/settings/logo-storage.test.ts`
Expected: PASS for all cases.

- [ ] **Step 5: Commit**

```bash
git add src/server/settings/logo-storage.ts tests/server/settings/logo-storage.test.ts
git commit -m "feat(settings): logo-storage helper with magic-byte sniffing"
```

---

## Task 8: User Server Actions

**Files:**
- Create: `src/app/admin/users/actions.ts`
- Create: `tests/app/admin/users/actions.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/app/admin/users/actions.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createUser, findUserById, findUserByUsername, listUsers } from "@/server/db/users";
import { hashPassword } from "@/server/auth/password";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-users-actions-"));
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

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

async function seedAdmin(username: string) {
  const { getDatabase } = await import("@/server/db");
  return createUser(getDatabase(), {
    name: username,
    username,
    passwordHash: await hashPassword("seed"),
    role: "admin",
    mustChangePassword: false,
  });
}

async function seedUser(username: string) {
  const { getDatabase } = await import("@/server/db");
  return createUser(getDatabase(), {
    name: username,
    username,
    passwordHash: await hashPassword("seed"),
    role: "user",
    mustChangePassword: false,
  });
}

describe("addUser action", () => {
  it("returns fieldErrors when name is empty", async () => {
    const { addUser } = await import("@/app/admin/users/actions");
    const state = await addUser({}, makeFormData({ name: "", username: "alice", mode: "generate" }));
    expect(state.fieldErrors?.name).toBeTruthy();
  });

  it("returns fieldErrors for a username with bad characters", async () => {
    const { addUser } = await import("@/app/admin/users/actions");
    const state = await addUser({}, makeFormData({ name: "Alice", username: "Bad Name!", mode: "generate" }));
    expect(state.fieldErrors?.username).toBeTruthy();
  });

  it("returns fieldErrors when manual password is too short", async () => {
    const { addUser } = await import("@/app/admin/users/actions");
    const state = await addUser({}, makeFormData({ name: "Alice", username: "alice", mode: "manual", password: "short" }));
    expect(state.fieldErrors?.password).toBeTruthy();
  });

  it("creates a user (generate) and returns generatedPassword on success", async () => {
    const { addUser } = await import("@/app/admin/users/actions");
    const state = await addUser({}, makeFormData({ name: "Alice", username: "alice", mode: "generate" }));
    expect(state.success).toBe(true);
    expect(state.generatedPassword).toHaveLength(16);
    const { getDatabase } = await import("@/server/db");
    expect(findUserByUsername(getDatabase(), "alice")).not.toBeNull();
  });

  it("creates a user (manual) without returning a password", async () => {
    const { addUser } = await import("@/app/admin/users/actions");
    const state = await addUser({}, makeFormData({ name: "Alice", username: "alice", mode: "manual", password: "supersecret" }));
    expect(state.success).toBe(true);
    expect(state.generatedPassword).toBeUndefined();
  });

  it("returns fieldErrors when username is already taken", async () => {
    await seedUser("alice");
    vi.resetModules();
    const { addUser } = await import("@/app/admin/users/actions");
    const state = await addUser({}, makeFormData({ name: "Alice", username: "alice", mode: "generate" }));
    expect(state.fieldErrors?.username).toBeTruthy();
  });
});

describe("deactivateUser / activateUser actions", () => {
  it("deactivate sets deactivated=1", async () => {
    const u = await seedUser("alice");
    vi.resetModules();
    const { deactivateUser } = await import("@/app/admin/users/actions");
    const state = await deactivateUser({}, makeFormData({ id: u.id }));
    expect(state.success).toBe(true);
    const { getDatabase } = await import("@/server/db");
    expect(findUserById(getDatabase(), u.id)?.deactivated).toBe(1);
  });

  it("deactivate of last admin returns {error}", async () => {
    const u = await seedAdmin("admin");
    vi.resetModules();
    const { deactivateUser } = await import("@/app/admin/users/actions");
    const state = await deactivateUser({}, makeFormData({ id: u.id }));
    expect(state.error).toMatch(/last/i);
  });

  it("activate clears deactivated", async () => {
    const u = await seedUser("alice");
    vi.resetModules();
    const { deactivateUser, activateUser } = await import("@/app/admin/users/actions");
    await deactivateUser({}, makeFormData({ id: u.id }));
    await activateUser({}, makeFormData({ id: u.id }));
    const { getDatabase } = await import("@/server/db");
    expect(findUserById(getDatabase(), u.id)?.deactivated).toBe(0);
  });
});

describe("deleteUser action", () => {
  it("removes a non-admin", async () => {
    const u = await seedUser("alice");
    vi.resetModules();
    const { deleteUser } = await import("@/app/admin/users/actions");
    const state = await deleteUser({}, makeFormData({ id: u.id }));
    expect(state.success).toBe(true);
    const { getDatabase } = await import("@/server/db");
    expect(findUserById(getDatabase(), u.id)).toBeNull();
  });

  it("refuses to delete the last admin", async () => {
    const u = await seedAdmin("admin");
    vi.resetModules();
    const { deleteUser } = await import("@/app/admin/users/actions");
    const state = await deleteUser({}, makeFormData({ id: u.id }));
    expect(state.error).toMatch(/last/i);
  });
});

describe("promoteUser / demoteUser actions", () => {
  it("promotes a user", async () => {
    const u = await seedUser("alice");
    vi.resetModules();
    const { promoteUser } = await import("@/app/admin/users/actions");
    const state = await promoteUser({}, makeFormData({ id: u.id }));
    expect(state.success).toBe(true);
    const { getDatabase } = await import("@/server/db");
    expect(findUserById(getDatabase(), u.id)?.role).toBe("admin");
  });

  it("demote refuses last admin", async () => {
    const u = await seedAdmin("admin");
    vi.resetModules();
    const { demoteUser } = await import("@/app/admin/users/actions");
    const state = await demoteUser({}, makeFormData({ id: u.id }));
    expect(state.error).toMatch(/last/i);
  });
});

describe("resetUserPassword action", () => {
  it("returns generatedPassword and updates the user", async () => {
    const u = await seedUser("alice");
    vi.resetModules();
    const { resetUserPassword } = await import("@/app/admin/users/actions");
    const state = await resetUserPassword({}, makeFormData({ id: u.id }));
    expect(state.success).toBe(true);
    expect(state.generatedPassword).toHaveLength(16);
    const { getDatabase } = await import("@/server/db");
    expect(findUserById(getDatabase(), u.id)?.must_change_password).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/app/admin/users/actions.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the actions**

Create `src/app/admin/users/actions.ts`:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getDatabase } from "@/server/db";
import { findUserByUsername } from "@/server/db/users";
import {
  addUser as addUserCore,
  deactivateUserAdmin,
  activateUserAdmin,
  deleteUserAdmin,
  promoteUserAdmin,
  demoteUserAdmin,
  resetUserPasswordAdmin,
  LastAdminError,
} from "@/server/auth/users-admin";

// ── Form-state types ─────────────────────────────────────────────────────────

export type AddUserFormState = {
  success?: true;
  generatedPassword?: string;
  error?: string;
  fieldErrors?: Partial<Record<"name" | "username" | "password" | "mode" | "form", string>>;
};

export type SimpleFormState = { success?: true; error?: string };

export type ResetFormState = {
  success?: true;
  generatedPassword?: string;
  error?: string;
};

// ── Zod schemas ──────────────────────────────────────────────────────────────

const usernameField = z
  .string()
  .trim()
  .min(3, "Username: 3-64 chars, [a-z0-9_-]")
  .max(64, "Username: 3-64 chars, [a-z0-9_-]")
  .regex(/^[a-z0-9_-]+$/i, "Username: 3-64 chars, [a-z0-9_-]");

const baseAddUser = {
  name: z.string().trim().min(1, "Name is required").max(200),
  username: usernameField,
};
const manualSchema = z.object({
  ...baseAddUser,
  mode: z.literal("manual"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
const generateSchema = z.object({
  ...baseAddUser,
  mode: z.literal("generate"),
});
const addUserSchema = z.discriminatedUnion("mode", [manualSchema, generateSchema]);

const idField = z.string().uuid().or(z.string().min(1));
const idOnlySchema = z.object({ id: idField });

// ── Helpers ──────────────────────────────────────────────────────────────────

function fieldErrorsFromZod<K extends string>(
  err: z.ZodError,
): Partial<Record<K, string>> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out as Partial<Record<K, string>>;
}

function errorState(e: unknown): { error: string } {
  if (e instanceof LastAdminError) return { error: e.message };
  return { error: e instanceof Error ? e.message : "Unexpected error" };
}

// ── Actions ──────────────────────────────────────────────────────────────────

export async function addUser(
  _prev: AddUserFormState,
  formData: FormData,
): Promise<AddUserFormState> {
  const raw = {
    name: formData.get("name"),
    username: formData.get("username"),
    mode: formData.get("mode") ?? "generate",
    password: formData.get("password") ?? undefined,
  };
  const parsed = addUserSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const db = getDatabase();
  if (findUserByUsername(db, parsed.data.username.toLowerCase())) {
    return { fieldErrors: { username: "Username already in use" } };
  }
  try {
    const result = await addUserCore(db, parsed.data);
    revalidatePath("/admin/users");
    return { success: true, generatedPassword: result.generatedPassword };
  } catch (e) {
    return errorState(e);
  }
}

export async function deactivateUser(
  _prev: SimpleFormState,
  formData: FormData,
): Promise<SimpleFormState> {
  const parsed = idOnlySchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "Missing user id" };
  try {
    deactivateUserAdmin(getDatabase(), parsed.data.id);
    revalidatePath("/admin/users");
    return { success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function activateUser(
  _prev: SimpleFormState,
  formData: FormData,
): Promise<SimpleFormState> {
  const parsed = idOnlySchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "Missing user id" };
  try {
    activateUserAdmin(getDatabase(), parsed.data.id);
    revalidatePath("/admin/users");
    return { success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function deleteUser(
  _prev: SimpleFormState,
  formData: FormData,
): Promise<SimpleFormState> {
  const parsed = idOnlySchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "Missing user id" };
  try {
    deleteUserAdmin(getDatabase(), parsed.data.id);
    revalidatePath("/admin/users");
    return { success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function promoteUser(
  _prev: SimpleFormState,
  formData: FormData,
): Promise<SimpleFormState> {
  const parsed = idOnlySchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "Missing user id" };
  try {
    promoteUserAdmin(getDatabase(), parsed.data.id);
    revalidatePath("/admin/users");
    return { success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function demoteUser(
  _prev: SimpleFormState,
  formData: FormData,
): Promise<SimpleFormState> {
  const parsed = idOnlySchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "Missing user id" };
  try {
    demoteUserAdmin(getDatabase(), parsed.data.id);
    revalidatePath("/admin/users");
    return { success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function resetUserPassword(
  _prev: ResetFormState,
  formData: FormData,
): Promise<ResetFormState> {
  const parsed = idOnlySchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "Missing user id" };
  try {
    const { generatedPassword } = await resetUserPasswordAdmin(getDatabase(), parsed.data.id);
    revalidatePath("/admin/users");
    return { success: true, generatedPassword };
  } catch (e) {
    return errorState(e);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/app/admin/users/actions.test.ts`
Expected: PASS for all cases.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/users/actions.ts tests/app/admin/users/actions.test.ts
git commit -m "feat(users): server actions with Zod + last-admin guards"
```

---

## Task 9: Settings Server Actions

**Files:**
- Create: `src/app/admin/settings/actions.ts`
- Create: `tests/app/admin/settings/actions.test.ts`

**Note:** the data-dir for the logo defaults to `dirname(DATABASE_PATH)`. Tests stub `DATABASE_PATH` so the logo lands in the test temp dir.

- [ ] **Step 1: Write the failing tests**

Create `tests/app/admin/settings/actions.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { getSetting } from "@/server/db/settings";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-settings-actions-"));
  dbPath = join(tmp, "test.db");
  const db = createDatabase(dbPath);
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
  db.close();
  vi.stubEnv("DATABASE_PATH", dbPath);
  vi.resetModules();
});

afterEach(async () => {
  const { __resetDatabase } = await import("@/server/db");
  __resetDatabase();
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

function fd(fields: Record<string, string | Blob>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("saveAppName", () => {
  it("rejects empty name", async () => {
    const { saveAppName } = await import("@/app/admin/settings/actions");
    const s = await saveAppName({}, fd({ value: "" }));
    expect(s.fieldErrors?.value).toBeTruthy();
  });

  it("rejects names over 60 chars", async () => {
    const { saveAppName } = await import("@/app/admin/settings/actions");
    const s = await saveAppName({}, fd({ value: "x".repeat(61) }));
    expect(s.fieldErrors?.value).toBeTruthy();
  });

  it("saves a valid name", async () => {
    const { saveAppName } = await import("@/app/admin/settings/actions");
    const s = await saveAppName({}, fd({ value: "MyFiles" }));
    expect(s.success).toBe(true);
    const { getDatabase } = await import("@/server/db");
    expect(getSetting(getDatabase(), "app_name")).toBe("MyFiles");
  });
});

describe("saveLogo (URL mode)", () => {
  it("rejects malformed URL", async () => {
    const { saveLogo } = await import("@/app/admin/settings/actions");
    const s = await saveLogo({}, fd({ source: "url", url: "not a url" }));
    expect(s.fieldErrors?.url).toBeTruthy();
  });

  it("accepts an http URL", async () => {
    const { saveLogo } = await import("@/app/admin/settings/actions");
    const s = await saveLogo({}, fd({ source: "url", url: "https://cdn.example.com/x.png" }));
    expect(s.success).toBe(true);
    const { getDatabase } = await import("@/server/db");
    expect(getSetting(getDatabase(), "logo_url")).toBe("https://cdn.example.com/x.png");
  });

  it("accepts a relative URL", async () => {
    const { saveLogo } = await import("@/app/admin/settings/actions");
    const s = await saveLogo({}, fd({ source: "url", url: "/static/logo.png" }));
    expect(s.success).toBe(true);
  });
});

describe("saveLogo (Upload mode)", () => {
  it("rejects oversized files", async () => {
    const big = Buffer.concat([PNG_MAGIC, Buffer.alloc(300_000)]);
    const blob = new Blob([big], { type: "image/png" });
    const file = new File([blob], "logo.png", { type: "image/png" });
    const { saveLogo } = await import("@/app/admin/settings/actions");
    const s = await saveLogo({}, fd({ source: "upload", file }));
    expect(s.fieldErrors?.file).toMatch(/256|size/i);
  });

  it("rejects content with the wrong magic bytes", async () => {
    const blob = new Blob([Buffer.from("not an image at all")], { type: "image/png" });
    const file = new File([blob], "fake.png", { type: "image/png" });
    const { saveLogo } = await import("@/app/admin/settings/actions");
    const s = await saveLogo({}, fd({ source: "upload", file }));
    expect(s.fieldErrors?.file).toMatch(/unsupported|type/i);
  });

  it("writes a valid PNG and stores internal:png", async () => {
    const blob = new Blob([PNG_MAGIC], { type: "image/png" });
    const file = new File([blob], "logo.png", { type: "image/png" });
    const { saveLogo } = await import("@/app/admin/settings/actions");
    const s = await saveLogo({}, fd({ source: "upload", file }));
    expect(s.success).toBe(true);
    const { getDatabase } = await import("@/server/db");
    expect(getSetting(getDatabase(), "logo_url")).toBe("internal:png");
    expect(existsSync(join(dirname(dbPath), "logo.png"))).toBe(true);
  });
});

describe("clearLogo", () => {
  it("clears the setting and removes the file", async () => {
    const blob = new Blob([PNG_MAGIC], { type: "image/png" });
    const file = new File([blob], "logo.png", { type: "image/png" });
    const { saveLogo, clearLogo } = await import("@/app/admin/settings/actions");
    await saveLogo({}, fd({ source: "upload", file }));
    await clearLogo();
    const { getDatabase } = await import("@/server/db");
    expect(getSetting(getDatabase(), "logo_url")).toBe("");
    expect(existsSync(join(dirname(dbPath), "logo.png"))).toBe(false);
  });
});

describe("saveAccentColor", () => {
  it("rejects a colour that fails 3:1 against either background", async () => {
    // #aaaaaa: ~2.3:1 on white (fails), ~8.5:1 on #0a0a0a (passes).
    const { saveAccentColor } = await import("@/app/admin/settings/actions");
    const s = await saveAccentColor({}, fd({ value: "#aaaaaa" }));
    expect(s.fieldErrors?.value).toBeTruthy();
  });

  it("rejects malformed hex", async () => {
    const { saveAccentColor } = await import("@/app/admin/settings/actions");
    const s = await saveAccentColor({}, fd({ value: "not-a-colour" }));
    expect(s.fieldErrors?.value).toBeTruthy();
  });

  it("saves a passing colour", async () => {
    const { saveAccentColor } = await import("@/app/admin/settings/actions");
    const s = await saveAccentColor({}, fd({ value: "#3b82f6" }));
    expect(s.success).toBe(true);
    const { getDatabase } = await import("@/server/db");
    expect(getSetting(getDatabase(), "accent_color")).toBe("#3b82f6");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/app/admin/settings/actions.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the actions**

Create `src/app/admin/settings/actions.ts`:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { dirname } from "node:path";
import { getDatabase } from "@/server/db";
import { setSetting } from "@/server/db/settings";
import { validateAccent } from "@/server/auth/contrast";
import {
  writeLogo,
  clearLogo as clearLogoFile,
} from "@/server/settings/logo-storage";

const MAX_LOGO_BYTES = 256 * 1024;

export type SimpleFormState<K extends string = string> = {
  success?: true;
  error?: string;
  fieldErrors?: Partial<Record<K, string>>;
};

function dataDir(): string {
  const dbPath = process.env.DATABASE_PATH ?? "/app/data/minifold.db";
  return dirname(dbPath);
}

// ── App name ─────────────────────────────────────────────────────────────────

const appNameSchema = z.object({
  value: z.string().trim().min(1, "Name is required").max(60, "Name must be 60 chars or fewer"),
});

export async function saveAppName(
  _prev: SimpleFormState<"value">,
  formData: FormData,
): Promise<SimpleFormState<"value">> {
  const parsed = appNameSchema.safeParse({ value: formData.get("value") });
  if (!parsed.success) {
    return { fieldErrors: { value: parsed.error.issues[0]?.message ?? "Invalid" } };
  }
  setSetting(getDatabase(), "app_name", parsed.data.value);
  revalidatePath("/", "layout");
  return { success: true };
}

// ── Logo ─────────────────────────────────────────────────────────────────────

const logoUrlSchema = z.object({
  source: z.literal("url"),
  url: z
    .string()
    .trim()
    .min(1, "URL is required")
    .refine(
      (s) => /^(https?:\/\/|\/)/.test(s),
      "Must start with http://, https://, or /",
    ),
});

const logoUploadSchema = z.object({
  source: z.literal("upload"),
});

const logoSchema = z.discriminatedUnion("source", [logoUrlSchema, logoUploadSchema]);

export async function saveLogo(
  _prev: SimpleFormState<"url" | "file">,
  formData: FormData,
): Promise<SimpleFormState<"url" | "file">> {
  const source = formData.get("source");
  if (source === "url") {
    const parsed = logoUrlSchema.safeParse({
      source,
      url: formData.get("url"),
    });
    if (!parsed.success) {
      return { fieldErrors: { url: parsed.error.issues[0]?.message ?? "Invalid URL" } };
    }
    setSetting(getDatabase(), "logo_url", parsed.data.url);
    revalidatePath("/", "layout");
    revalidatePath("/api/logo");
    return { success: true };
  }

  if (source !== "upload") return { error: "Invalid source" };

  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof Blob)) {
    return { fieldErrors: { file: "No file provided" } };
  }
  if (fileEntry.size > MAX_LOGO_BYTES) {
    return { fieldErrors: { file: `Max size is ${MAX_LOGO_BYTES} bytes (256 KB)` } };
  }
  const buf = Buffer.from(await fileEntry.arrayBuffer());
  let ext: "png" | "svg" | "webp";
  try {
    ext = await writeLogo(dataDir(), buf);
  } catch (e) {
    return { fieldErrors: { file: e instanceof Error ? e.message : "Unsupported type" } };
  }
  setSetting(getDatabase(), "logo_url", `internal:${ext}`);
  revalidatePath("/", "layout");
  revalidatePath("/api/logo");
  return { success: true };
}

export async function clearLogo(): Promise<void> {
  clearLogoFile(dataDir());
  setSetting(getDatabase(), "logo_url", "");
  revalidatePath("/", "layout");
  revalidatePath("/api/logo");
}

// ── Accent colour ────────────────────────────────────────────────────────────

const HEX_RE = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
const accentSchema = z.object({
  value: z
    .string()
    .trim()
    .regex(HEX_RE, "Must be a hex colour like #3b82f6"),
});

export async function saveAccentColor(
  _prev: SimpleFormState<"value">,
  formData: FormData,
): Promise<SimpleFormState<"value">> {
  const parsed = accentSchema.safeParse({ value: formData.get("value") });
  if (!parsed.success) {
    return { fieldErrors: { value: parsed.error.issues[0]?.message ?? "Invalid colour" } };
  }
  if (!validateAccent(parsed.data.value).passes) {
    return {
      fieldErrors: {
        value: "Colour fails WCAG AA contrast on light or dark background",
      },
    };
  }
  setSetting(getDatabase(), "accent_color", parsed.data.value);
  revalidatePath("/", "layout");
  return { success: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/app/admin/settings/actions.test.ts`
Expected: PASS for all cases.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/settings/actions.ts tests/app/admin/settings/actions.test.ts
git commit -m "feat(settings): server actions for app name, logo, accent"
```

---

## Task 10: Change-password action + page

**Files:**
- Create: `src/app/change-password/page.tsx`
- Create: `src/app/change-password/actions.ts`
- Create: `tests/app/change-password/actions.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/app/change-password/actions.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createUser, findUserById } from "@/server/db/users";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...args: unknown[]) => redirectMock(...args) }));

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-cp-actions-"));
  dbPath = join(tmp, "test.db");
  const db = createDatabase(dbPath);
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
  db.close();
  vi.stubEnv("DATABASE_PATH", dbPath);
  vi.resetModules();
  redirectMock.mockReset();
});

afterEach(async () => {
  const { __resetDatabase } = await import("@/server/db");
  __resetDatabase();
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

async function seedUserAndSession(username: string, password: string) {
  const { getDatabase } = await import("@/server/db");
  const db = getDatabase();
  const user = createUser(db, {
    name: username,
    username,
    passwordHash: await hashPassword(password),
    role: "user",
    mustChangePassword: true,
  });
  const { token } = createSession(db, user.id);
  return { user, token };
}

// Mock the cookie helper to return our seeded token.
function stubCookie(token: string) {
  vi.doMock("@/server/auth/cookies", () => ({
    readSessionCookie: () => Promise.resolve(token),
  }));
}

describe("changePassword", () => {
  it("rejects when the current password is wrong", async () => {
    const { token } = await seedUserAndSession("alice", "current-pw");
    stubCookie(token);
    vi.resetModules();
    const { changePassword } = await import("@/app/change-password/actions");
    const s = await changePassword({}, fd({ currentPassword: "wrong", newPassword: "longenough", confirmPassword: "longenough" }));
    expect(s.fieldErrors?.currentPassword).toBeTruthy();
  });

  it("rejects when confirmPassword does not match", async () => {
    const { token } = await seedUserAndSession("alice", "current-pw");
    stubCookie(token);
    vi.resetModules();
    const { changePassword } = await import("@/app/change-password/actions");
    const s = await changePassword({}, fd({ currentPassword: "current-pw", newPassword: "longenough", confirmPassword: "different" }));
    expect(s.fieldErrors?.confirmPassword).toBeTruthy();
  });

  it("rejects when newPassword equals currentPassword", async () => {
    const { token } = await seedUserAndSession("alice", "current-pw-long");
    stubCookie(token);
    vi.resetModules();
    const { changePassword } = await import("@/app/change-password/actions");
    const s = await changePassword({}, fd({ currentPassword: "current-pw-long", newPassword: "current-pw-long", confirmPassword: "current-pw-long" }));
    expect(s.fieldErrors?.newPassword).toBeTruthy();
  });

  it("rejects when newPassword is too short", async () => {
    const { token } = await seedUserAndSession("alice", "current-pw");
    stubCookie(token);
    vi.resetModules();
    const { changePassword } = await import("@/app/change-password/actions");
    const s = await changePassword({}, fd({ currentPassword: "current-pw", newPassword: "short", confirmPassword: "short" }));
    expect(s.fieldErrors?.newPassword).toBeTruthy();
  });

  it("on success: updates hash, clears must_change_password, deletes other sessions, keeps current", async () => {
    const { user, token } = await seedUserAndSession("alice", "current-pw");
    const { getDatabase } = await import("@/server/db");
    const db = getDatabase();
    // Seed a second session for the same user.
    createSession(db, user.id);
    expect(db.prepare("SELECT COUNT(*) as n FROM sessions WHERE user_id = ?").get(user.id) as { n: number }).toEqual({ n: 2 });

    stubCookie(token);
    vi.resetModules();
    const { changePassword } = await import("@/app/change-password/actions");
    await changePassword({}, fd({ currentPassword: "current-pw", newPassword: "longenough!", confirmPassword: "longenough!" }));

    const after = findUserById(db, user.id)!;
    expect(after.must_change_password).toBe(0);
    expect(await verifyPassword("longenough!", after.password)).toBe(true);
    const remaining = db.prepare("SELECT COUNT(*) as n FROM sessions WHERE user_id = ?").get(user.id) as { n: number };
    expect(remaining.n).toBe(1); // current session kept; the other deleted.
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/app/change-password/actions.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the action**

Create `src/app/change-password/actions.ts`:

```ts
"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { getDatabase } from "@/server/db";
import { getCurrentUser } from "@/server/auth/current-user";
import { readSessionCookie } from "@/server/auth/cookies";
import { findUserById, updateUserPassword } from "@/server/db/users";
import { hashPassword, verifyPassword } from "@/server/auth/password";

export type ChangePasswordState = {
  success?: true;
  error?: string;
  fieldErrors?: Partial<Record<"currentPassword" | "newPassword" | "confirmPassword", string>>;
};

const schema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "New password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    path: ["newPassword"],
    message: "New password must differ from current",
  });

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const parsed = schema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? "form");
      if (!fieldErrors[k]) fieldErrors[k] = issue.message;
    }
    return { fieldErrors };
  }

  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };

  const fresh = findUserById(getDatabase(), user.id);
  if (!fresh) return { error: "Not authenticated" };

  if (!(await verifyPassword(parsed.data.currentPassword, fresh.password))) {
    return { fieldErrors: { currentPassword: "Current password is incorrect" } };
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  const db = getDatabase();
  updateUserPassword(db, fresh.id, newHash, { mustChangePassword: false });

  // Delete sessions other than the current one.
  const currentToken = await readSessionCookie();
  if (currentToken) {
    db.prepare(
      "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?",
    ).run(fresh.id, hashToken(currentToken));
  } else {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(fresh.id);
  }

  redirect("/");
}
```

- [ ] **Step 4: Create the page**

Create `src/app/change-password/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current-user";
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";

export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="mb-2 text-xl font-semibold">Change password</h1>
      {user.must_change_password === 1 ? (
        <p className="mb-4 text-sm text-amber-700 dark:text-amber-300">
          You must change your password before continuing.
        </p>
      ) : null}
      <ChangePasswordForm />
    </div>
  );
}
```

- [ ] **Step 5: Create the form component**

Create `src/components/auth/ChangePasswordForm.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { changePassword, type ChangePasswordState } from "@/app/change-password/actions";

const INITIAL: ChangePasswordState = {};

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, INITIAL);
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="text-sm">Current password</span>
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.currentPassword ? (
          <span className="text-xs text-red-600">{state.fieldErrors.currentPassword}</span>
        ) : null}
      </label>
      <label className="block">
        <span className="text-sm">New password</span>
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.newPassword ? (
          <span className="text-xs text-red-600">{state.fieldErrors.newPassword}</span>
        ) : null}
      </label>
      <label className="block">
        <span className="text-sm">Confirm new password</span>
        <input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.confirmPassword ? (
          <span className="text-xs text-red-600">{state.fieldErrors.confirmPassword}</span>
        ) : null}
      </label>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50"
      >
        {pending ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- tests/app/change-password/actions.test.ts`
Expected: PASS for all cases.

- [ ] **Step 7: Commit**

```bash
git add src/app/change-password tests/app/change-password src/components/auth/ChangePasswordForm.tsx
git commit -m "feat(auth): change-password page and action"
```

---

## Task 11: `/api/logo` route

**Files:**
- Create: `src/app/api/logo/route.ts`
- Create: `tests/app/api/logo/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/app/api/logo/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { setSetting } from "@/server/db/settings";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-logo-route-"));
  dbPath = join(tmp, "test.db");
  const db = createDatabase(dbPath);
  runMigrations(db, resolve(process.cwd(), "src/server/db/migrations"));
  db.close();
  vi.stubEnv("DATABASE_PATH", dbPath);
  vi.resetModules();
});

afterEach(async () => {
  const { __resetDatabase } = await import("@/server/db");
  __resetDatabase();
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

describe("GET /api/logo", () => {
  it("404 when logo_url is empty", async () => {
    const { GET } = await import("@/app/api/logo/route");
    const r = await GET();
    expect(r.status).toBe(404);
  });

  it("404 when logo_url is internal but file is missing", async () => {
    const { getDatabase } = await import("@/server/db");
    setSetting(getDatabase(), "logo_url", "internal:png");
    const { GET } = await import("@/app/api/logo/route");
    const r = await GET();
    expect(r.status).toBe(404);
  });

  it("404 when logo_url is an external URL (route is internal-only)", async () => {
    const { getDatabase } = await import("@/server/db");
    setSetting(getDatabase(), "logo_url", "https://cdn.example.com/x.png");
    const { GET } = await import("@/app/api/logo/route");
    const r = await GET();
    expect(r.status).toBe(404);
  });

  it("streams the file with the correct Content-Type when present", async () => {
    writeFileSync(join(dirname(dbPath), "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { getDatabase } = await import("@/server/db");
    setSetting(getDatabase(), "logo_url", "internal:png");
    const { GET } = await import("@/app/api/logo/route");
    const r = await GET();
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    const buf = Buffer.from(await r.arrayBuffer());
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/app/api/logo/route.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the route**

Create `src/app/api/logo/route.ts`:

```ts
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getDatabase } from "@/server/db";
import { getSetting } from "@/server/db/settings";
import {
  resolveLogoPath,
  type LogoExt,
} from "@/server/settings/logo-storage";

const CONTENT_TYPES: Record<LogoExt, string> = {
  png: "image/png",
  webp: "image/webp",
  svg: "image/svg+xml",
};

function dataDir(): string {
  return dirname(process.env.DATABASE_PATH ?? "/app/data/minifold.db");
}

export async function GET(): Promise<Response> {
  const value = getSetting(getDatabase(), "logo_url");
  if (!value || !value.startsWith("internal:")) {
    return new Response("Not found", { status: 404 });
  }
  const ext = value.slice("internal:".length) as LogoExt;
  if (!(ext in CONTENT_TYPES)) {
    return new Response("Not found", { status: 404 });
  }
  const path = resolveLogoPath(dataDir(), ext);
  if (!path) return new Response("Not found", { status: 404 });
  const buf = await readFile(path);
  return new Response(buf, {
    status: 200,
    headers: {
      "content-type": CONTENT_TYPES[ext],
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/app/api/logo/route.test.ts`
Expected: PASS for all cases.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/logo tests/app/api/logo
git commit -m "feat(api): /api/logo serves uploaded logos from /data"
```

---

## Task 12: SettingsContext + globals.css `--accent`

**Files:**
- Create: `src/components/SettingsContext.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add `--accent` to globals.css**

Open `src/app/globals.css`. Locate the `:root` block and the `@theme inline` block. Modify them as follows:

```css
:root {
  --background: #ffffff;
  --foreground: #171717;
  --accent: #3b82f6;     /* default; overridden at runtime by layout.tsx style */
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-accent: var(--accent);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}
```

(Do NOT touch the dark-mode `@media` block — the accent variable is the same regardless of the mode preference; the validation logic ensures it works on both.)

- [ ] **Step 2: Verify CSS still compiles**

Run: `npm run typecheck`
Expected: PASS (CSS won't be parsed by typecheck, but this is the cheapest sanity gate).

- [ ] **Step 3: Create SettingsContext**

Create `src/components/SettingsContext.tsx`:

```tsx
"use client";

import { createContext, useContext, type ReactNode } from "react";

export type AppSettings = {
  appName: string;
  accent: string;
  logoUrl: string;
};

const Ctx = createContext<AppSettings>({
  appName: "Minifold",
  accent: "#3b82f6",
  logoUrl: "",
});

export function SettingsProvider({
  value,
  children,
}: {
  value: AppSettings;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): AppSettings {
  return useContext(Ctx);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css src/components/SettingsContext.tsx
git commit -m "feat(settings): --accent CSS var + SettingsContext"
```

---

## Task 13: Root layout — settings, title, accent, must-change-password gate

**Files:**
- Create: `src/middleware.ts` (sets `x-pathname` header)
- Modify: `src/app/layout.tsx`

The standard pattern in Next.js for "let the layout know which path is being rendered" is a tiny middleware that copies the request URL's pathname into a custom header. The middleware runs on Edge (no DB access), the layout reads the header server-side. This is the documented workaround.

- [ ] **Step 1: Read current layout**

Open `src/app/layout.tsx`. The current implementation is sync, has a static `metadata` export, and renders `<TRPCProvider><AppShell sidebar={<Sidebar />}>{children}</AppShell></TRPCProvider>`.

- [ ] **Step 2: Create the middleware**

Create `src/middleware.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Match all routes except Next.js internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 3: Replace the root layout with the async version**

Replace the entire contents of `src/app/layout.tsx` with:

```tsx
import "./globals.css";
import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { TRPCProvider } from "@/trpc/Provider";
import { AppShell } from "@/components/shell/AppShell";
import { Sidebar } from "@/components/shell/Sidebar";
import { SettingsProvider } from "@/components/SettingsContext";
import { getDatabase } from "@/server/db";
import { getAllSettings } from "@/server/db/settings";
import { getCurrentUser } from "@/server/auth/current-user";

export async function generateMetadata() {
  const settings = getAllSettings(getDatabase());
  return {
    title: settings.app_name || "Minifold",
    description: "Self-hosted file browser",
  };
}

const BYPASS_PATHS = ["/change-password", "/logout", "/login", "/api/"];

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = getAllSettings(getDatabase());
  const appName = settings.app_name || "Minifold";
  const accent = settings.accent_color || "#3b82f6";
  const logoUrl = settings.logo_url || "";

  // Forced-change gate.
  const user = await getCurrentUser();
  if (user && user.must_change_password === 1) {
    const h = await headers();
    const pathname = h.get("x-pathname") ?? "";
    const isBypass = BYPASS_PATHS.some((p) => pathname === p || pathname.startsWith(p));
    if (!isBypass) {
      redirect("/change-password");
    }
  }

  return (
    <html lang="en" style={{ "--accent": accent } as CSSProperties}>
      <body className="bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-50">
        <TRPCProvider>
          <SettingsProvider value={{ appName, accent, logoUrl }}>
            <AppShell sidebar={<Sidebar />}>{children}</AppShell>
          </SettingsProvider>
        </TRPCProvider>
      </body>
    </html>
  );
}
```

API routes (`/api/*`) are also bypassed because they're not user-facing pages — `/api/file` and `/api/thumb` need to keep working even for users with stale passwords.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the existing layout-related tests (if any)**

Run: `npm test`
Expected: PASS overall. Some tests that mock `getCurrentUser` or render the layout may need adjustment if they don't already mock `getDatabase`. If anything fails, the fix is usually adding a `vi.mock("@/server/auth/current-user", () => ({ getCurrentUser: () => Promise.resolve(null) }))` to those test files. If broken, fix only the breaking files.

- [ ] **Step 6: Commit**

```bash
git add src/middleware.ts src/app/layout.tsx
git commit -m "feat(shell): root layout reads settings, gates must-change-password via middleware-set x-pathname"
```

---

## Task 14: AdminNav + admin layout integration

**Files:**
- Create: `src/components/admin/AdminNav.tsx`
- Create: `tests/components/admin/AdminNav.test.tsx`
- Modify: `src/app/admin/layout.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/admin/AdminNav.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminNav } from "@/components/admin/AdminNav";

const pathnameMock = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

beforeEach(() => {
  pathnameMock.mockReset();
});

describe("AdminNav", () => {
  it("renders three tabs", () => {
    pathnameMock.mockReturnValue("/admin/users");
    render(<AdminNav />);
    expect(screen.getByRole("link", { name: "Providers" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("marks the matching tab as active via aria-current", () => {
    pathnameMock.mockReturnValue("/admin/settings");
    render(<AdminNav />);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Users" })).not.toHaveAttribute("aria-current");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/components/admin/AdminNav.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement AdminNav**

Create `src/components/admin/AdminNav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/providers", label: "Providers" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/settings", label: "Settings" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-neutral-200 dark:border-neutral-800">
      <ul className="flex gap-4 px-4">
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`inline-block px-2 py-3 text-sm ${
                  active
                    ? "border-b-2 border-accent text-accent"
                    : "text-neutral-700 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/components/admin/AdminNav.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire AdminNav into the admin layout**

Open `src/app/admin/layout.tsx`. The existing layout returns `<>{children}</>`. Replace it with:

```tsx
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current-user";
import { AdminNav } from "@/components/admin/AdminNav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");
  return (
    <div>
      <AdminNav />
      <div className="p-4">{children}</div>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/AdminNav.tsx tests/components/admin/AdminNav.test.tsx src/app/admin/layout.tsx
git commit -m "feat(admin): tabbed nav for Providers/Users/Settings"
```

---

## Task 15: `/admin/users` page + UsersPageClient

**Files:**
- Create: `src/app/admin/users/page.tsx`
- Create: `src/components/admin/UsersPageClient.tsx`
- Create: `src/components/admin/UserRowActions.tsx`

- [ ] **Step 1: Implement the RSC**

Create `src/app/admin/users/page.tsx`:

```tsx
import { getDatabase } from "@/server/db";
import { listUsers } from "@/server/db/users";
import { getCurrentUser } from "@/server/auth/current-user";
import { UsersPageClient } from "@/components/admin/UsersPageClient";

export default async function AdminUsersPage() {
  const users = listUsers(getDatabase());
  const me = await getCurrentUser();
  return <UsersPageClient users={users} currentUserId={me?.id ?? null} />;
}
```

- [ ] **Step 2: Implement UserRowActions**

Create `src/components/admin/UserRowActions.tsx`:

```tsx
"use client";

import { useState, useRef, useEffect } from "react";
import type { UserRow } from "@/server/db/users";

export type UserRowActionsProps = {
  user: UserRow;
  isSelf: boolean;
  isLastActiveAdmin: boolean;
  onAction: (action: ActionKind) => void;
};

export type ActionKind =
  | "reset-password"
  | "deactivate"
  | "activate"
  | "promote"
  | "demote"
  | "delete";

export function UserRowActions(props: UserRowActionsProps) {
  const { user, isSelf, isLastActiveAdmin, onAction } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const items: { kind: ActionKind; label: string; show: boolean }[] = [
    { kind: "reset-password", label: "Reset password", show: !isSelf },
    { kind: "deactivate", label: "Deactivate", show: !isSelf && user.deactivated === 0 && !(user.role === "admin" && isLastActiveAdmin) },
    { kind: "activate", label: "Activate", show: user.deactivated === 1 },
    { kind: "promote", label: "Promote to admin", show: user.role === "user" },
    { kind: "demote", label: "Demote to user", show: user.role === "admin" && !(isLastActiveAdmin) },
    { kind: "delete", label: "Delete", show: !isSelf && !(user.role === "admin" && isLastActiveAdmin) },
  ];

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Row actions"
        className="rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        ⋯
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-48 rounded border border-neutral-200 bg-white shadow-md dark:border-neutral-800 dark:bg-neutral-900"
        >
          {items.filter((i) => i.show).map((i) => (
            <button
              key={i.kind}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onAction(i.kind);
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              {i.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Implement UsersPageClient**

Create `src/components/admin/UsersPageClient.tsx`:

```tsx
"use client";

import { useState, type ReactNode } from "react";
import { useActionState } from "react";
import type { UserRow } from "@/server/db/users";
import {
  deactivateUser,
  activateUser,
  promoteUser,
  demoteUser,
  deleteUser,
  resetUserPassword,
  type SimpleFormState,
  type ResetFormState,
} from "@/app/admin/users/actions";
import { UserRowActions, type ActionKind } from "@/components/admin/UserRowActions";
import { AddUserSlideOver } from "@/components/admin/AddUserSlideOver";

function formatRelative(ts: number | null): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  const min = 60_000, hour = 60 * min, day = 24 * hour;
  if (diff < min) return "just now";
  if (diff < hour) return `${Math.floor(diff / min)} min ago`;
  if (diff < day) return `${Math.floor(diff / hour)} h ago`;
  return new Date(ts).toLocaleDateString();
}

export function UsersPageClient({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string | null;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [confirm, setConfirm] = useState<{
    user: UserRow;
    kind: ActionKind;
  } | null>(null);
  const [generated, setGenerated] = useState<string | null>(null);

  const activeAdminCount = users.filter((u) => u.role === "admin" && u.deactivated === 0).length;

  return (
    <div>
      <div className="flex items-center justify-between pb-4">
        <h1 className="text-xl font-semibold">Users</h1>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white"
        >
          + Add user
        </button>
      </div>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-neutral-500">
          <tr>
            <th className="py-2">Name</th>
            <th>Username</th>
            <th>Role</th>
            <th>Last login</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            const isLastActiveAdmin = u.role === "admin" && u.deactivated === 0 && activeAdminCount <= 1;
            return (
              <tr key={u.id} className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="py-2">{u.name}</td>
                <td className="font-mono text-xs">{u.username}</td>
                <td>{u.role}</td>
                <td>{formatRelative(u.last_login)}</td>
                <td>{u.deactivated === 1 ? "disabled" : "active"}</td>
                <td className="text-right">
                  <UserRowActions
                    user={u}
                    isSelf={isSelf}
                    isLastActiveAdmin={isLastActiveAdmin}
                    onAction={(kind) => setConfirm({ user: u, kind })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {addOpen ? (
        <AddUserSlideOver
          onClose={() => setAddOpen(false)}
          onCreatedWithGenerated={(pw) => setGenerated(pw)}
        />
      ) : null}

      {confirm ? (
        <ConfirmModal
          confirm={confirm}
          onResolve={(generatedPassword) => {
            setConfirm(null);
            if (generatedPassword) setGenerated(generatedPassword);
          }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}

      {generated ? (
        <PasswordOnceModal password={generated} onClose={() => setGenerated(null)} />
      ) : null}
    </div>
  );
}

// ── Modals ────────────────────────────────────────────────────────────────────

function ConfirmModal({
  confirm,
  onResolve,
  onCancel,
}: {
  confirm: { user: UserRow; kind: ActionKind };
  onResolve: (generatedPassword?: string) => void;
  onCancel: () => void;
}) {
  const { user, kind } = confirm;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const isDelete = kind === "delete";
  const titleMap: Record<ActionKind, string> = {
    "reset-password": `Reset password for ${user.username}?`,
    deactivate: `Deactivate ${user.username}?`,
    activate: `Activate ${user.username}`,
    promote: `Promote ${user.username} to admin?`,
    demote: `Demote ${user.username} to user?`,
    delete: `Delete ${user.username}?`,
  };

  async function go() {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.append("id", user.id);
    let result: SimpleFormState | ResetFormState;
    switch (kind) {
      case "reset-password":
        result = await resetUserPassword({}, fd);
        break;
      case "deactivate":
        result = await deactivateUser({}, fd);
        break;
      case "activate":
        result = await activateUser({}, fd);
        break;
      case "promote":
        result = await promoteUser({}, fd);
        break;
      case "demote":
        result = await demoteUser({}, fd);
        break;
      case "delete":
        result = await deleteUser({}, fd);
        break;
    }
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onResolve("generatedPassword" in result ? result.generatedPassword : undefined);
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded bg-white p-4 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold">{titleMap[kind]}</h2>
        {isDelete ? (
          <div className="mt-3 text-sm">
            Type <span className="font-mono font-bold">{user.username}</span> to confirm:
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="mt-2 block w-full rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>
        ) : null}
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={go}
            disabled={pending || (isDelete && confirmText !== user.username)}
            className="rounded bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {pending ? "…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PasswordOnceModal({ password, onClose }: { password: string; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded bg-white p-4 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold">New password</h2>
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
          This password will not be shown again. The user must change it on first login.
        </p>
        <code className="mt-3 block rounded bg-neutral-100 p-3 font-mono text-base dark:bg-neutral-800">
          {password}
        </code>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(password)}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add a placeholder AddUserSlideOver**

Create `src/components/admin/AddUserSlideOver.tsx` (placeholder; Task 16 fully implements it):

```tsx
"use client";

export function AddUserSlideOver({
  onClose,
  onCreatedWithGenerated,
}: {
  onClose: () => void;
  onCreatedWithGenerated: (pw: string) => void;
}) {
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-sm bg-white p-4 dark:bg-neutral-900">
        <p>Coming soon</p>
        <button type="button" onClick={onClose}>Close</button>
        {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
        <span style={{ display: "none" }}>{onCreatedWithGenerated.toString()}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev` (background)

Visit `http://localhost:3000/admin/users` while logged in as an admin. Verify the page renders with the user table; the row actions menu opens; clicking actions opens the confirm modal; clicking "Add user" opens the placeholder slide-over.

Stop the dev server.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/users/page.tsx src/components/admin/UsersPageClient.tsx src/components/admin/UserRowActions.tsx src/components/admin/AddUserSlideOver.tsx
git commit -m "feat(users): page + table + row-action menu + confirm/password modals"
```

---

## Task 16: AddUserSlideOver — full implementation

**Files:**
- Modify: `src/components/admin/AddUserSlideOver.tsx`
- Create: `tests/components/admin/AddUserSlideOver.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/components/admin/AddUserSlideOver.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddUserSlideOver } from "@/components/admin/AddUserSlideOver";

const addUserMock = vi.fn();
vi.mock("@/app/admin/users/actions", () => ({
  addUser: (...args: unknown[]) => addUserMock(...args),
}));

beforeEach(() => {
  addUserMock.mockReset();
});

describe("AddUserSlideOver", () => {
  it("submits with mode=generate by default", async () => {
    addUserMock.mockResolvedValue({ success: true, generatedPassword: "ABCDEFGHJKMNPQRS" });
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<AddUserSlideOver onClose={onClose} onCreatedWithGenerated={onCreated} />);

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Alice" } });
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "alice" } });
    fireEvent.click(screen.getByRole("button", { name: /create user/i }));

    await waitFor(() => expect(addUserMock).toHaveBeenCalled());
    const fd = addUserMock.mock.calls[0]![1] as FormData;
    expect(fd.get("mode")).toBe("generate");
    expect(fd.get("name")).toBe("Alice");
    expect(fd.get("username")).toBe("alice");
  });

  it("on success with generated password, calls onCreatedWithGenerated and closes", async () => {
    addUserMock.mockResolvedValue({ success: true, generatedPassword: "ABCDEFGHJKMNPQRS" });
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<AddUserSlideOver onClose={onClose} onCreatedWithGenerated={onCreated} />);

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Alice" } });
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "alice" } });
    fireEvent.click(screen.getByRole("button", { name: /create user/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("ABCDEFGHJKMNPQRS"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("on success without generated password (manual mode), only calls onClose", async () => {
    addUserMock.mockResolvedValue({ success: true });
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<AddUserSlideOver onClose={onClose} onCreatedWithGenerated={onCreated} />);

    // Switch to manual mode
    fireEvent.click(screen.getByLabelText(/set password manually/i));

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Alice" } });
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "supersecret" } });
    fireEvent.click(screen.getByRole("button", { name: /create user/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("displays fieldErrors when action returns them", async () => {
    addUserMock.mockResolvedValue({ fieldErrors: { username: "taken" } });
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<AddUserSlideOver onClose={onClose} onCreatedWithGenerated={onCreated} />);

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Alice" } });
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "alice" } });
    fireEvent.click(screen.getByRole("button", { name: /create user/i }));

    expect(await screen.findByText("taken")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/components/admin/AddUserSlideOver.test.tsx`
Expected: FAIL — placeholder component does not match assertions.

- [ ] **Step 3: Implement the full slide-over**

Replace `src/components/admin/AddUserSlideOver.tsx` with:

```tsx
"use client";

import { useState, useEffect } from "react";
import { addUser, type AddUserFormState } from "@/app/admin/users/actions";

type Mode = "generate" | "manual";

export function AddUserSlideOver({
  onClose,
  onCreatedWithGenerated,
}: {
  onClose: () => void;
  onCreatedWithGenerated: (pw: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("generate");
  const [state, setState] = useState<AddUserFormState>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setState({});
    const fd = new FormData(e.currentTarget);
    fd.set("mode", mode);
    const result: AddUserFormState = await addUser(state, fd);
    setPending(false);
    setState(result);
    if (result.success) {
      if (result.generatedPassword) onCreatedWithGenerated(result.generatedPassword);
      onClose();
    }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add user</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-2xl leading-none">×</button>
        </div>

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <label className="block">
            <span className="text-sm">Name</span>
            <input
              name="name"
              type="text"
              required
              maxLength={200}
              className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {state.fieldErrors?.name ? (
              <span className="text-xs text-red-600">{state.fieldErrors.name}</span>
            ) : null}
          </label>

          <label className="block">
            <span className="text-sm">Username</span>
            <input
              name="username"
              type="text"
              autoComplete="username"
              required
              minLength={3}
              maxLength={64}
              pattern="[a-z0-9_\-]+"
              className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 font-mono dark:border-neutral-700 dark:bg-neutral-900"
            />
            {state.fieldErrors?.username ? (
              <span className="text-xs text-red-600">{state.fieldErrors.username}</span>
            ) : null}
          </label>

          <fieldset className="space-y-1">
            <legend className="text-sm">Password</legend>
            <label className="block text-sm">
              <input
                type="radio"
                name="mode-radio"
                checked={mode === "generate"}
                onChange={() => setMode("generate")}
              />{" "}
              Generate password
            </label>
            <label className="block text-sm">
              <input
                type="radio"
                name="mode-radio"
                checked={mode === "manual"}
                onChange={() => setMode("manual")}
              />{" "}
              Set password manually
            </label>
          </fieldset>

          {mode === "manual" ? (
            <label className="block">
              <span className="text-sm">Password</span>
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
              />
              {state.fieldErrors?.password ? (
                <span className="text-xs text-red-600">{state.fieldErrors.password}</span>
              ) : null}
            </label>
          ) : null}

          {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {pending ? "Creating…" : "Create user"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/components/admin/AddUserSlideOver.test.tsx`
Expected: PASS for all four cases.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/AddUserSlideOver.tsx tests/components/admin/AddUserSlideOver.test.tsx
git commit -m "feat(users): AddUserSlideOver with manual/generate password modes"
```

---

## Task 17: `/admin/settings` page + SettingsPageClient + AppNameForm

**Files:**
- Create: `src/app/admin/settings/page.tsx`
- Create: `src/components/admin/SettingsPageClient.tsx`
- Create: `src/components/admin/AppNameForm.tsx`

- [ ] **Step 1: Implement the RSC**

Create `src/app/admin/settings/page.tsx`:

```tsx
import { getDatabase } from "@/server/db";
import { getAllSettings } from "@/server/db/settings";
import { SettingsPageClient } from "@/components/admin/SettingsPageClient";

export default async function AdminSettingsPage() {
  const settings = getAllSettings(getDatabase());
  return (
    <SettingsPageClient
      appName={settings.app_name || "Minifold"}
      logoUrl={settings.logo_url || ""}
      accentColor={settings.accent_color || "#3b82f6"}
    />
  );
}
```

- [ ] **Step 2: Implement SettingsPageClient**

Create `src/components/admin/SettingsPageClient.tsx`:

```tsx
"use client";

import { AppNameForm } from "@/components/admin/AppNameForm";
import { LogoForm } from "@/components/admin/LogoForm";
import { AccentColorForm } from "@/components/admin/AccentColorForm";

export function SettingsPageClient({
  appName,
  logoUrl,
  accentColor,
}: {
  appName: string;
  logoUrl: string;
  accentColor: string;
}) {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <SectionCard title="App name" description="Shown in the UI and PWA manifest">
        <AppNameForm initialValue={appName} />
      </SectionCard>
      <SectionCard title="Logo" description="PNG, SVG, or WebP up to 256 KB. Or paste a URL.">
        <LogoForm initialValue={logoUrl} />
      </SectionCard>
      <SectionCard title="Accent colour" description="Used for highlights, links, active states.">
        <AccentColorForm initialValue={accentColor} />
      </SectionCard>
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-neutral-500">{description}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}
```

- [ ] **Step 3: Implement AppNameForm**

Create `src/components/admin/AppNameForm.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import {
  saveAppName,
  type SimpleFormState,
} from "@/app/admin/settings/actions";

const INITIAL: SimpleFormState<"value"> = {};

export function AppNameForm({ initialValue }: { initialValue: string }) {
  const [state, action, pending] = useActionState(saveAppName, INITIAL);
  return (
    <form action={action} className="flex items-start gap-2">
      <label className="flex-1">
        <input
          name="value"
          type="text"
          defaultValue={initialValue}
          maxLength={60}
          required
          className="block w-full rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.value ? (
          <span className="text-xs text-red-600">{state.fieldErrors.value}</span>
        ) : null}
        {state.success ? <span className="text-xs text-green-600">Saved.</span> : null}
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Add placeholders for LogoForm and AccentColorForm**

Create `src/components/admin/LogoForm.tsx`:

```tsx
"use client";

export function LogoForm({ initialValue }: { initialValue: string }) {
  return (
    <p className="text-sm text-neutral-500">
      Logo form coming soon. Current value: <code>{initialValue || "(none)"}</code>
    </p>
  );
}
```

Create `src/components/admin/AccentColorForm.tsx`:

```tsx
"use client";

export function AccentColorForm({ initialValue }: { initialValue: string }) {
  return (
    <p className="text-sm text-neutral-500">
      Accent colour form coming soon. Current value: <code>{initialValue}</code>
    </p>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/settings src/components/admin/SettingsPageClient.tsx src/components/admin/AppNameForm.tsx src/components/admin/LogoForm.tsx src/components/admin/AccentColorForm.tsx
git commit -m "feat(settings): page + SettingsPageClient + AppNameForm; LogoForm/AccentColorForm placeholders"
```

---

## Task 18: LogoForm — full implementation

**Files:**
- Modify: `src/components/admin/LogoForm.tsx`

This task does not add component-level tests — the action's behaviour is fully covered by Task 9's server-action tests. The form is a thin wrapper.

- [ ] **Step 1: Replace LogoForm with the full implementation**

Replace `src/components/admin/LogoForm.tsx` with:

```tsx
"use client";

import { useState } from "react";
import {
  saveLogo,
  clearLogo,
  type SimpleFormState,
} from "@/app/admin/settings/actions";

type Source = "url" | "upload";

function deriveSource(value: string): Source {
  return value.startsWith("internal:") ? "upload" : "url";
}

function deriveDisplayUrl(value: string): string {
  if (!value) return "";
  if (value.startsWith("internal:")) return "/api/logo";
  return value;
}

export function LogoForm({ initialValue }: { initialValue: string }) {
  const [source, setSource] = useState<Source>(deriveSource(initialValue));
  const [state, setState] = useState<SimpleFormState<"url" | "file">>({});
  const [pending, setPending] = useState(false);
  const display = deriveDisplayUrl(initialValue);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setState({});
    const fd = new FormData(e.currentTarget);
    fd.set("source", source);
    const result = await saveLogo(state, fd);
    setPending(false);
    setState(result);
    if (result.success) {
      // Reload to pick up the new logo and trigger context refresh.
      window.location.reload();
    }
  }

  async function onClear() {
    setPending(true);
    await clearLogo();
    setPending(false);
    window.location.reload();
  }

  return (
    <div className="space-y-3">
      {display ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">Current:</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={display} alt="Current logo" className="h-12 w-12 rounded border border-neutral-200 object-contain dark:border-neutral-800" />
        </div>
      ) : null}

      <fieldset className="space-y-1">
        <legend className="text-sm">Source</legend>
        <label className="block text-sm">
          <input type="radio" checked={source === "url"} onChange={() => setSource("url")} /> URL
        </label>
        <label className="block text-sm">
          <input type="radio" checked={source === "upload"} onChange={() => setSource("upload")} /> Upload
        </label>
      </fieldset>

      <form onSubmit={onSubmit} className="space-y-2">
        {source === "url" ? (
          <label className="block">
            <span className="text-sm">URL</span>
            <input
              name="url"
              type="text"
              defaultValue={initialValue.startsWith("internal:") ? "" : initialValue}
              placeholder="https://… or /static/logo.png"
              className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {state.fieldErrors?.url ? (
              <span className="text-xs text-red-600">{state.fieldErrors.url}</span>
            ) : null}
          </label>
        ) : (
          <label className="block">
            <span className="text-sm">File (PNG / SVG / WebP, ≤256 KB)</span>
            <input
              name="file"
              type="file"
              accept=".png,.svg,.webp,image/png,image/svg+xml,image/webp"
              className="mt-1 block w-full text-sm"
            />
            {state.fieldErrors?.file ? (
              <span className="text-xs text-red-600">{state.fieldErrors.file}</span>
            ) : null}
          </label>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          {initialValue ? (
            <button
              type="button"
              onClick={onClear}
              disabled={pending}
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
            >
              Clear logo
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual smoke test**

Run dev server, visit `/admin/settings`, try uploading a small PNG, verify it appears at `/api/logo` and renders in the preview after page reload. Try the "Clear logo" button. Try the URL mode with `https://example.com/x.png`.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/LogoForm.tsx
git commit -m "feat(settings): LogoForm with URL/Upload modes and clear"
```

---

## Task 19: AccentColorForm — full implementation

**Files:**
- Modify: `src/components/admin/AccentColorForm.tsx`
- Create: `tests/components/admin/AccentColorForm.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/components/admin/AccentColorForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccentColorForm } from "@/components/admin/AccentColorForm";

vi.mock("@/app/admin/settings/actions", () => ({
  saveAccentColor: vi.fn().mockResolvedValue({ success: true }),
}));

describe("AccentColorForm", () => {
  it("disables Save when initial colour fails contrast", () => {
    render(<AccentColorForm initialValue="#aaaaaa" />);
    const save = screen.getByRole("button", { name: /save/i });
    expect(save).toBeDisabled();
  });

  it("enables Save for a passing colour", () => {
    render(<AccentColorForm initialValue="#3b82f6" />);
    const save = screen.getByRole("button", { name: /save/i });
    expect(save).not.toBeDisabled();
  });

  it("shows 'Use nearest accessible' button when contrast fails", () => {
    render(<AccentColorForm initialValue="#aaaaaa" />);
    expect(screen.getByRole("button", { name: /use nearest accessible/i })).toBeInTheDocument();
  });

  it("clicking 'Use nearest accessible' updates the input value", () => {
    render(<AccentColorForm initialValue="#ff5555" />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    const oldValue = input.value;
    fireEvent.click(screen.getByRole("button", { name: /use nearest accessible/i }));
    expect(input.value).not.toBe(oldValue);
    expect(input.value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("updates contrast badges as input changes", () => {
    render(<AccentColorForm initialValue="#3b82f6" />);
    // Both passing badges visible initially.
    expect(screen.getAllByText(/aa/i).length).toBeGreaterThanOrEqual(2);
    // Change to failing colour.
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#aaaaaa" } });
    // Now at least one "below AA" should appear.
    expect(screen.getAllByText(/below aa/i).length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/components/admin/AccentColorForm.test.tsx`
Expected: FAIL — placeholder doesn't satisfy assertions.

- [ ] **Step 3: Implement the form**

Replace `src/components/admin/AccentColorForm.tsx` with:

```tsx
"use client";

import { useState, useMemo } from "react";
import {
  validateAccent,
  nearestAccessible,
} from "@/server/auth/contrast";
import { saveAccentColor } from "@/app/admin/settings/actions";

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function AccentColorForm({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  const isValidHex = HEX_RE.test(value);
  const report = useMemo(() => (isValidHex ? validateAccent(value) : null), [value, isValidHex]);
  const suggestion = useMemo(
    () => (isValidHex && report && !report.passes ? nearestAccessible(value) : null),
    [value, report, isValidHex],
  );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setPending(true);
    const fd = new FormData();
    fd.append("value", value);
    const result = await saveAccentColor({}, fd);
    setPending(false);
    if (result.success) {
      setSuccess(true);
      // Reload so the new --accent CSS var takes effect.
      setTimeout(() => window.location.reload(), 600);
      return;
    }
    setError(result.fieldErrors?.value ?? result.error ?? "Could not save");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={isValidHex ? value : "#000000"}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Colour picker"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Hex colour"
          className="w-32 rounded border border-neutral-300 px-2 py-1 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <span
          aria-label="Preview"
          className="inline-block h-8 w-8 rounded"
          style={{ backgroundColor: isValidHex ? value : "transparent" }}
        />
      </div>

      {report ? (
        <ul className="text-sm">
          <li>
            Light bg: {report.light.ratio.toFixed(2)}:1 —{" "}
            <span className={report.light.passes ? "text-green-600" : "text-red-600"}>
              {report.light.passes ? "AA" : "below AA"}
            </span>
          </li>
          <li>
            Dark bg: {report.dark.ratio.toFixed(2)}:1 —{" "}
            <span className={report.dark.passes ? "text-green-600" : "text-red-600"}>
              {report.dark.passes ? "AA" : "below AA"}
            </span>
          </li>
        </ul>
      ) : null}

      {suggestion ? (
        <button
          type="button"
          onClick={() => setValue(suggestion)}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
        >
          Use nearest accessible:&nbsp;
          <span className="inline-block h-4 w-4 align-middle rounded" style={{ backgroundColor: suggestion }} />
          &nbsp;<code className="font-mono">{suggestion}</code>
        </button>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-green-600">Saved.</p> : null}

      <button
        type="submit"
        disabled={pending || !report || !report.passes}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
```

**Note:** importing `validateAccent` and `nearestAccessible` from a `src/server/auth/contrast.ts` module into a client component works because the module is pure (no I/O, no Node-only APIs aside from chroma-js which is browser-safe). If Vite/Next complains, the fix is to mark the contrast module with no `node:` imports — verify by checking the file has no `import "node:..."`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/components/admin/AccentColorForm.test.tsx`
Expected: PASS for all five cases.

- [ ] **Step 5: Manual smoke test**

Run dev server. Visit `/admin/settings`, change accent colour to `#aaaaaa` — Save should disable and "Use nearest accessible" should appear. Click it, then Save. Page reloads with new accent.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/AccentColorForm.tsx tests/components/admin/AccentColorForm.test.tsx
git commit -m "feat(settings): AccentColorForm with live contrast + clamp suggestion"
```

---

## Task 20: Sidebar — read appName from context + Change-password link

**Files:**
- Modify: `src/components/shell/Sidebar.tsx`

Per spec §11: the sidebar header should display the configured app name (so renaming via `/admin/settings` shows up in the sidebar). Also add a "Change password" link to the user/footer area.

- [ ] **Step 1: Read the existing sidebar**

Open `src/components/shell/Sidebar.tsx` and identify:
1. Where the sidebar renders its header / brand text. If "Minifold" is hardcoded as a string anywhere (e.g., a `<h1>` or `<span>`), that's where the appName goes.
2. Whether the sidebar currently has a user/footer area (e.g., login state, logout button). If not, the Change-password link goes in a new footer block at the bottom.

If the sidebar is a server component and reads no client state, switch it to a client component (`"use client"`) at the top — `useSettings` is a client hook. Alternatively, keep the sidebar as a server component and accept `appName` as a prop, with `RootLayout` passing it explicitly. Pick the simpler one given the file's current shape.

- [ ] **Step 2: Replace any hardcoded "Minifold" with the configured name**

Two viable approaches; pick the one that matches the file's current style:

**Approach A — sidebar is a client component:**

Add at the top:
```tsx
"use client";
import { useSettings } from "@/components/SettingsContext";
```

Inside the component, replace any literal `"Minifold"` with `useSettings().appName`.

**Approach B — sidebar stays a server component, receives appName as a prop:**

Change the component signature:
```tsx
export function Sidebar({ appName }: { appName: string }) { ... }
```

Replace any literal `"Minifold"` with `{appName}`. Then update `src/app/layout.tsx` to pass it: `<Sidebar appName={appName} />` instead of `<Sidebar />`.

- [ ] **Step 3: Add the "Change password" link**

In the sidebar's footer area (or add a new footer block at the bottom if none exists), add:

```tsx
import Link from "next/link";

// ...inside the sidebar tree, near the bottom:
<div className="mt-auto border-t border-neutral-200 px-3 py-2 dark:border-neutral-800">
  <Link
    href="/change-password"
    className="block py-1 text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
  >
    Change password
  </Link>
</div>
```

If `Link` is already imported, don't add a duplicate import. The `mt-auto` pushes the footer to the bottom assuming the sidebar's outer container is `flex flex-col`. If it isn't, drop `mt-auto` and just place the link block at the bottom of the JSX.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Verify rendering**

Run dev server, log in, confirm:
1. The sidebar header shows whatever `app_name` is in settings (default: "Minifold").
2. "Change password" link is visible and routes to `/change-password`.

If you change `app_name` via `/admin/settings` and refresh the page, the sidebar header updates.

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/Sidebar.tsx
# Also commit src/app/layout.tsx if Approach B was chosen.
git commit -m "feat(shell): sidebar reads appName from settings + Change password link"
```

---

## Task 21: Final integration — typecheck + full test suite

**Files:** none new

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Lint**

Run: `npm run lint` (if defined; if not, skip).

If lint complains about anything, fix it.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: ALL PASS, including pre-existing tests.

If any pre-existing test fails because of the layout change (Task 13) or sidebar change (Task 20), fix the test (typically by mocking newly-required dependencies). Do NOT skip tests.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: SUCCESS — Next.js production build completes without errors.

- [ ] **Step 5: Manual end-to-end smoke test**

Run dev server, log in as admin, walk through:
1. `/admin/users` — add a user (generate mode), verify password modal shows; log in as them, get redirected to `/change-password`; change password; redirected to `/`.
2. `/admin/users` — add a user (manual mode); confirm password modal does NOT appear.
3. `/admin/users` — try to delete yourself; verify the row action is hidden.
4. `/admin/users` — promote a user, then demote them.
5. `/admin/settings` — change app name, verify `<title>` updates after refresh.
6. `/admin/settings` — upload a logo (PNG), verify it renders in sidebar.
7. `/admin/settings` — change accent colour to `#aaaaaa`, verify Save is disabled, accept suggestion, save; verify CSS variable updates.
8. `/admin/settings` — clear logo.

Stop the dev server.

- [ ] **Step 6: Commit any small follow-up fixes**

If any micro-tweaks are needed from the smoke test, commit them as `fix(...)`.

---

## Done

Phase 8 is complete when:
- All 21 tasks above are committed.
- `npm test` passes (full suite).
- `npm run typecheck` passes.
- `npm run build` succeeds.
- Manual smoke test (Task 21 step 5) walks cleanly.

Phase 9 (PWA + deployment templates) reads from the `app_name`, `logo_url`, and `accent_color` settings this phase establishes.
