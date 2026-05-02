# Admin Users & Settings — Design Spec

**Date:** 2026-05-02
**Status:** Approved
**Phase:** 8 (finish — `/admin/providers` already shipped)

---

## 1. Goals & Non-Goals

**Goals:**
- Add `/admin/users` — admin UI for full user lifecycle: add, deactivate/activate, delete, promote, demote, reset password
- Add `/admin/settings` — admin UI for app name, logo (upload or URL), and accent colour with WCAG AA contrast guard
- Add `/change-password` — forced-change page for users with `must_change_password = 1`, also reachable voluntarily
- Reach UI parity with the admin CLI for routine tasks; CLI remains the recovery hatch only
- Land settings infrastructure (DB-backed app name + accent colour as CSS variable) that Phase 9 (PWA) will read from

**Non-Goals:**
- Self-registration / `/register` page — deferred until there's a real demand
- Per-user audit log
- Sessions visibility UI (no `/admin/sessions`)
- Email anything — username-only identity (per project convention)
- PWA manifest wiring — Phase 9 reads the settings this phase creates
- Drag-to-reorder providers (`position` column exists but unused)
- Editing existing users' name/username (delete + re-add is sufficient for the foreseeable scale)
- Migrating existing components from `bg-blue-*` to `bg-accent-*` — Phase 8 publishes the CSS variable; component adoption is a follow-up grep-and-replace

---

## 2. Routes

```
/admin              → already redirects to /admin/providers
/admin/providers    → already exists (Phase 3.6)
/admin/users        → new
/admin/settings     → new
/change-password    → new
/api/logo           → new (serves uploaded logos from /data)
```

The existing `/admin/layout.tsx` already gates the whole tree on `role === "admin"`. Phase 8 extends it with a sidebar nav rendering Providers / Users / Settings tabs.

---

## 3. Data Layer

### 3.1 Migration `006_seed_phase_8_settings.sql`

```sql
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('app_name',     'Minifold'),
  ('logo_url',     ''),
  ('accent_color', '#3b82f6');  -- Tailwind blue-500, passes AA on both bgs
```

The `settings` table itself already exists. No schema changes — only seeded defaults for the three new keys.

### 3.2 New module — `src/server/db/settings.ts`

Plain key-value wrapper:

```ts
export function getSetting(db: Database, key: string): string | null
export function setSetting(db: Database, key: string, value: string): void
export function getAllSettings(db: Database): Record<string, string>  // for page RSCs
```

No type discrimination — callers know what they expect.

### 3.3 New module — `src/server/auth/users-admin.ts`

Pure functions wrapping `better-sqlite3` with last-admin guardrails. **Single source of truth** — both the existing CLI and the new UI call into this module.

```ts
type CreateUserInput =
  | { name: string; username: string; password: string }       // manual
  | { name: string; username: string; generatePassword: true }; // auto

createUser(db, input): { user: User; generatedPassword?: string }
deactivateUser(db, id): void          // sets deactivated=1, deletes all user's sessions
activateUser(db, id): void            // clears deactivated
deleteUser(db, id): void              // refuses if it would orphan the last active admin
promoteUser(db, id): void             // role='admin'
demoteUser(db, id): void              // refuses if it would orphan the last active admin
resetUserPassword(db, id): { generatedPassword: string }
                                      // generates random pw, must_change_password=1, deletes user's sessions
```

The "last admin" check: `SELECT count(*) FROM users WHERE role='admin' AND deactivated=0` ≥ 2 before `delete`/`demote`/`deactivate` of an admin row.

Generated passwords: 16 chars, base32 alphabet (no confusing 0/O/l/1), via `crypto.randomBytes`.

**Refactor scope:** existing CLI commands (`promote`, `demote`, `delete-user`, `reset-admin`) move to call into this module — eliminating the duplication risk that already exists.

### 3.4 Logo storage convention

Files written to `/data/logo.<ext>` where `<ext>` is `png` / `svg` / `webp`.

`settings.logo_url` value semantics:

| Value pattern | Meaning |
|---|---|
| `""` (empty) | No logo; sidebar header shows app name only |
| `internal:png` / `internal:svg` / `internal:webp` | Served via `/api/logo`, which streams `/data/logo.<ext>` |
| `http://...` / `https://...` / `/...` | External URL; used directly in `<img src>` |

On upload: write the new file, `unlink` any sibling `/data/logo.<other-ext>`, set `logo_url = "internal:<ext>"`.
On clear: `unlink` `/data/logo.*`, set `logo_url = ""`.

---

## 4. `/admin/users` UI

### 4.1 Page (RSC)

`src/app/admin/users/page.tsx` calls `listUsers(db)` and renders `<UsersPageClient users={...}>`. Same shape as `/admin/providers`.

### 4.2 User list

Plain HTML table:

| Column | Source |
|---|---|
| Name | `users.name` |
| Username | `users.username` (monospace) |
| Role | `admin` / `user` pill |
| Last login | `users.last_login` formatted as relative time, or "never" |
| Status | `active` / `disabled` pill |
| ⋯ | Row actions menu |

Empty state never reached (the setup wizard guarantees ≥1 admin user).

### 4.3 Row actions menu

The `⋯` opens a dropdown. Available items vary per row:

| Action | Visible when | Confirms? |
|---|---|---|
| Reset password | always (except self) | yes (modal: "Reset password for `<username>`?") |
| Deactivate | active and not self | yes |
| Activate | deactivated | no |
| Promote to admin | role=`user` | yes |
| Demote to user | role=`admin` and not last active admin | yes |
| Delete | not self and not last active admin | yes (modal: type username to confirm) |

Self-row is filtered: an admin cannot deactivate, demote, delete, or reset their own account through this UI. The CLI is the path for those self-actions.

### 4.4 Add user slide-over

Right-side slide-over (matches `AddProviderSlideOver`). Two-screen state machine:

**Screen 1 — Form:**
- `Name` (text, 1–200 chars, required)
- `Username` (text, 3–64 chars, `[a-z0-9_-]`, lowercased on submit, required)
- Toggle: `( ) Set password manually   (•) Generate password` (default = Generate)
- If manual selected: `Password` field (min 8 chars)
- Submit: "Create user"

**Screen 2 — Success:**
- If password was generated:
  - Large monospace block showing the password
  - `[Copy]` button (uses `navigator.clipboard.writeText`)
  - Warning: *"This password will not be shown again. The user must change it on first login."*
  - `[Done]` closes the slide-over
- If password was set manually:
  - Simple confirmation: *"User created. They will be required to change their password on first login."*
  - `[Done]` closes the slide-over

In both cases `revalidatePath("/admin/users")` ensures the table refreshes when the slide-over closes.

### 4.5 Reset-password flow

Same two-screen pattern as Add: confirm modal → server action runs → success screen showing the new password once with copy button → `[Done]` closes.

### 4.6 Server actions

File: `src/app/admin/users/actions.ts`

```ts
addUser(prev, formData):
  { success?: true; generatedPassword?: string } |
  { error?: string; fieldErrors?: Record<string,string> }

resetUserPassword(prev, formData): { success?: true; generatedPassword: string } | { error: string }
deactivateUser(prev, formData): { success?: true } | { error: string }
activateUser(prev, formData):   { success?: true } | { error: string }
promoteUser(prev, formData):    { success?: true } | { error: string }
demoteUser(prev, formData):     { success?: true } | { error: string }
deleteUser(prev, formData):     { success?: true } | { error: string }
```

Each:
- Parses with Zod (same shapes as CLI validation)
- Calls the corresponding `users-admin.ts` function
- Catches `LastAdminError` and returns it as `{error: "..."}`
- `revalidatePath("/admin/users")` on success

---

## 5. `/admin/settings` UI

### 5.1 Page layout

`src/app/admin/settings/page.tsx` calls `getAllSettings(db)` and renders `<SettingsPageClient settings={...}>`, which is three independent section cards stacked vertically. Each card has its own `useActionState` and Server Action — saving one card never affects the others.

### 5.2 App name card (`AppNameForm`)

- Single text field, 1–60 chars (Zod-validated server-side, also `<input maxLength={60}>`)
- Save button
- Server action `saveAppName`: `setSetting(db, 'app_name', value)`, `revalidatePath('/', 'layout')` so the sidebar header and `<title>` re-render

### 5.3 Logo card (`LogoForm`)

- Preview area (top of card): renders the current logo following the same resolution rule as the app shell
- Source toggle: `( ) URL  (•) Upload` — defaults to whichever the current value implies
- **URL mode:** text field (`http(s)://...` or `/...`), server-side validated
- **Upload mode:** `<input type="file" accept=".png,.svg,.webp">` with file-name + size shown after selection
- Two buttons: `[Save]` and `[Clear logo]`

Server action `saveLogo`:
- Branch on URL vs Upload
- URL branch: validate format (relative path or `http(s)`), `setSetting(db, 'logo_url', value)`
- Upload branch:
  - Read the `File` from FormData
  - Size check: ≤256 KB
  - **Magic-byte sniff** (don't trust `Content-Type`):
    - PNG: `89 50 4E 47 0D 0A 1A 0A`
    - WebP: `RIFF....WEBP` (12-byte signature with `WEBP` at offset 8)
    - SVG: starts with `<?xml` or `<svg` (after optional whitespace), case-insensitive
  - Reject if no match
  - Write `/data/logo.<sniffed-ext>`, `unlink` any other-extension siblings
  - `setSetting(db, 'logo_url', 'internal:<ext>')`
- Both branches: `revalidatePath('/', 'layout')` and `revalidatePath('/api/logo')`

Server action `clearLogo`:
- `unlink` `/data/logo.*`
- `setSetting(db, 'logo_url', '')`
- `revalidatePath('/', 'layout')` and `revalidatePath('/api/logo')`

### 5.4 Accent colour card (`AccentColorForm`)

- `<input type="color">` (native picker)
- A separate hex text field syncs both ways
- Live contrast badges (re-computed on every change):
  - Light bg ratio + `AA` / `below AA` label
  - Dark bg ratio + `AA` / `below AA` label
- If either fails:
  - Compute `nearestAccessible(value)` (see §6)
  - Render `[Use nearest accessible: #xxxxxx]` button with that colour as a swatch; clicking it sets the input
  - Save button is **disabled** until both backgrounds pass
- Save action `saveAccentColor`:
  - Server-side re-runs the same `validateAccent` (don't trust client)
  - Rejects if either ratio < 3:1 (WCAG 1.4.11 Non-text Contrast — see §6)
  - `setSetting(db, 'accent_color', value)`
  - `revalidatePath('/', 'layout')`

### 5.5 Light/dark backgrounds for contrast checks

The reference backgrounds match the existing values in `src/app/globals.css`:
- Light mode: `#ffffff`
- Dark mode: `#0a0a0a` (set via `@media (prefers-color-scheme: dark)` — system preference, not a class toggle)

These two constants live in `src/server/auth/contrast.ts` and are used by both server validation and client preview. If `globals.css` ever changes the dark-mode background, this constant updates with it. **The validation always checks BOTH** regardless of which mode the admin is currently viewing — the saved colour must pass for any visitor's system preference.

---

## 6. Contrast module — `src/server/auth/contrast.ts`

Pure functions, no I/O:

```ts
const LIGHT_BG = '#ffffff'
const DARK_BG  = '#0a0a0a'
const THRESHOLD = 3.0   // WCAG 1.4.11 (Non-text Contrast / AA Large)

wcagContrast(foreground: string, background: string): number
  // Standard WCAG 2.1 ratio formula via relative luminance.

validateAccent(color: string): {
  light: { ratio: number; passes: boolean }   // passes if ratio ≥ 3.0
  dark:  { ratio: number; passes: boolean }
  passes: boolean  // both passes
}

nearestAccessible(color: string): string
  // Walks the colour in OKLCH lightness in both directions; returns
  // the closest passing candidate by OKLCH Euclidean distance.
  // Falls back to the seeded default if no value passes both bgs.
```

### Threshold rationale: 3:1, not 4.5:1

The accent colour is used for **UI components** (buttons, focus rings, active-state highlights, icons, dividers) — for which [WCAG 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html) requires 3:1 against the background. The 4.5:1 ratio (WCAG 1.4.3 Contrast Minimum) applies to *normal text*, but accent-coloured text is rare and typically large/bold (links, headings) — which qualifies for the 3:1 "AA Large" threshold either way.

A 4.5:1 ratio against both `#ffffff` AND `#0a0a0a` is **mathematically unsatisfiable** — the required foreground luminance windows do not overlap (need ≤ 0.1833 for white, ≥ 0.1887 for `#0a0a0a`). At 3:1 the window is comfortable (~0.109 to ~0.300), and real palette colours like `#3b82f6` fit naturally.

**Implementation:** uses `chroma-js` (~16 KB minified, MIT-licensed, mature) for hex ⇄ OKLCH conversion.

**Walking algorithm:**
1. Search both directions in OKLCH lightness: step by ±0.02 from the original up to L=0 and L=1, recording any colours that pass `validateAccent` on both backgrounds.
2. Among the passing candidates, return the one closest to the original colour by Euclidean distance in OKLCH.
3. If no candidate within the full lightness range passes (true mid-greys with zero chroma can still miss the window), fall back to the seeded default `#3b82f6`. The UI surfaces this as the suggested colour, same as any other suggestion.

The `LIGHT_BG`/`DARK_BG` constants are exported so client components can import them for live preview without re-deriving them.

---

## 7. Forced password change

### 7.1 Gate

A thin RSC wrapper redirects authenticated users with `must_change_password = 1` to `/change-password`. Implementation: a new layout segment that the auth-gated routes opt into, OR a check inside the existing root layout that excludes `/change-password` and `/logout`.

The chosen mechanism is a check inside `src/app/layout.tsx` (the existing root layout), which:
1. Calls `getCurrentUser()`
2. If user exists, has `must_change_password = 1`, AND the current pathname is not `/change-password` or `/logout`, redirects to `/change-password`

This mirrors the existing layout-level pattern (e.g., `/admin/layout.tsx` redirects non-admins). API routes (`/api/file`, `/api/thumb`) are not affected — read-only file access doesn't depend on the user having a fresh password.

### 7.2 `/change-password` page

`src/app/change-password/page.tsx`:
- Form fields: `Current password`, `New password`, `Confirm new password`
- Submit calls server action `changePassword`

`src/app/change-password/actions.ts` — `changePassword`:
1. Verify current password against bcrypt hash (use existing `verifyPassword` helper)
2. Validate new password: min 8 chars, must differ from current
3. Confirm field equals new field
4. Hash new password, update `users.password`
5. Set `must_change_password = 0`
6. Delete all OTHER sessions for this user (keep current session intact)
7. Redirect to `/`

Errors return `{error?, fieldErrors?}` in the standard form-state shape.

### 7.3 Voluntary access

The user menu (sidebar footer or top bar) gets a `Change password` link pointing at the same `/change-password`. When `must_change_password = 0`, the page is just a regular form with no redirect-on-completion to `/`; it stays on the page with a success toast.

---

## 8. `/api/logo` route

`src/app/api/logo/route.ts`:

1. Read `logo_url` setting
2. If starts with `internal:`:
   - Resolve `<ext>`, build path `/data/logo.<ext>`
   - Stream the file with `Content-Type` derived from `<ext>` (`image/png`, `image/svg+xml`, `image/webp`)
   - `Cache-Control: public, max-age=31536000, immutable` — admin saves call `revalidatePath('/api/logo')` to invalidate
3. Otherwise → 404 (this route only serves internal logos)

---

## 9. App name + accent in the root layout

This project uses Tailwind v4 with CSS-first config (no `tailwind.config.ts`). The accent colour is exposed as a Tailwind colour token by adding it to the existing `@theme inline` block in `src/app/globals.css`:

```css
/* src/app/globals.css */
:root {
  --background: #ffffff;
  --foreground: #171717;
  --accent: #3b82f6;     /* default; runtime override comes from layout.tsx */
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-accent: var(--accent);   /* NEW — makes bg-accent / text-accent / etc. work */
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}
```

`src/app/layout.tsx` is modified to inject the runtime value of `--accent` from settings, overriding the CSS default:

```tsx
const settings = getAllSettings(db);
const appName = settings.app_name || "Minifold";
const accent  = settings.accent_color || "#3b82f6";

return (
  <html lang="en" style={{ "--accent": accent } as CSSProperties}>
    <head>
      <title>{appName}</title>
    </head>
    <body>
      <SettingsContext.Provider value={{ appName, accent, logoUrl: settings.logo_url }}>
        {children}
      </SettingsContext.Provider>
    </body>
  </html>
);
```

Components opt in by writing `bg-accent`, `text-accent`, `ring-accent`, etc. The default `blue-*` usages remain until someone migrates them.

The `SettingsContext` lets client sidebar/header components read the app name and logo URL without prop-drilling. Server components can read settings directly via `getAllSettings(db)`.

---

## 10. Sidebar nav for `/admin/*`

`src/app/admin/layout.tsx` extends to render a top-level admin nav above `{children}`:

```
Providers · Users · Settings
```

Implemented as a thin client component that highlights the active tab via `usePathname()`. The existing auth guard logic stays in this layout.

---

## 11. File map

**New:**

| Path | Responsibility |
|---|---|
| `src/app/admin/users/page.tsx` | RSC: load users, render client shell |
| `src/app/admin/users/actions.ts` | 7 server actions (add, deactivate, activate, promote, demote, delete, resetPassword) |
| `src/app/admin/settings/page.tsx` | RSC: load settings, render client shell |
| `src/app/admin/settings/actions.ts` | `saveAppName`, `saveLogo`, `clearLogo`, `saveAccentColor` |
| `src/app/change-password/page.tsx` | Form page |
| `src/app/change-password/actions.ts` | `changePassword` |
| `src/app/api/logo/route.ts` | Streams `/data/logo.<ext>` |
| `src/components/admin/AdminNav.tsx` | Tabbed nav (Providers / Users / Settings) |
| `src/components/admin/UsersPageClient.tsx` | List + slide-over open/close + reset-confirm modal |
| `src/components/admin/AddUserSlideOver.tsx` | Two-screen state machine: form → password-shown |
| `src/components/admin/UserRowActions.tsx` | Row dropdown |
| `src/components/admin/SettingsPageClient.tsx` | Three-card wrapper |
| `src/components/admin/AppNameForm.tsx` | App-name card |
| `src/components/admin/LogoForm.tsx` | Logo card with URL/Upload toggle |
| `src/components/admin/AccentColorForm.tsx` | Picker + contrast badges + clamp suggestion |
| `src/components/SettingsContext.tsx` | Client context for app name + logo URL + accent |
| `src/server/auth/users-admin.ts` | User CRUD with last-admin guardrails |
| `src/server/auth/contrast.ts` | `wcagContrast`, `validateAccent`, `nearestAccessible` |
| `src/server/db/settings.ts` | `getSetting`, `setSetting`, `getAllSettings` |
| `src/server/db/migrations/006_seed_phase_8_settings.sql` | Seed defaults |

**Modified:**

| Path | Change |
|---|---|
| `src/app/admin/layout.tsx` | Add `<AdminNav>` above children |
| `src/app/layout.tsx` | Read settings, inject `--accent` style, set `<title>`, provide `SettingsContext`, redirect-to-`/change-password` gate |
| `src/app/globals.css` | Add `--accent` variable to `:root` and `--color-accent` to `@theme inline` |
| `src/server/auth/cli/<promote\|demote\|delete-user\|reset-admin>.ts` | Refactor to call into `users-admin.ts` (eliminate duplication) |
| `package.json` | Add `chroma-js` dependency |

---

## 12. Testing

Vitest + happy-dom + `@testing-library/react`, matching existing patterns.

### 12.1 Pure-function tests (highest leverage)

- `tests/server/auth/contrast.test.ts`
  - `wcagContrast` matches W3C-published reference values for ≥3 known pairs
  - `validateAccent` returns `passes: false` for an obviously failing colour, `true` for a passing one
  - `nearestAccessible` returns input unchanged when already passing
  - `nearestAccessible` output passes both backgrounds for ≥3 failing inputs (red, dark green, light yellow)
- `tests/server/auth/users-admin.test.ts`
  - `createUser` (manual) hashes the supplied password
  - `createUser` (generate) returns a 16-char password and stores its hash
  - `deleteUser` of last active admin throws `LastAdminError`
  - `demoteUser` of last active admin throws `LastAdminError`
  - `deactivateUser` of last active admin throws `LastAdminError`
  - `resetUserPassword` deletes that user's sessions, returns plaintext
  - Generated passwords use the configured alphabet (no 0/O/l/1)
- `tests/server/db/settings.test.ts`
  - `setSetting` then `getSetting` round-trip
  - `getAllSettings` returns object with seeded defaults after migration

### 12.2 Server-action tests

- `tests/app/admin/users/actions.test.ts` — for each action: happy path, Zod failure, last-admin failure surfaced as `{error}`, `revalidatePath` called with `/admin/users`
- `tests/app/admin/settings/actions.test.ts`
  - `saveAppName` rejects empty / >60
  - `saveLogo` URL branch rejects malformed URL
  - `saveLogo` Upload branch rejects oversize, rejects file with PNG extension but text content (magic-byte sniff catches it)
  - `clearLogo` deletes file and clears setting
  - `saveAccentColor` rejects sub-AA value
- `tests/app/change-password/actions.test.ts`
  - Wrong current password → error
  - Confirm mismatch → error
  - Same-as-current → error
  - Valid change → updates hash, clears `must_change_password`, deletes sessions other than current, keeps current session

### 12.3 Route tests

- `tests/app/api/logo/route.test.ts`
  - `internal:png` setting + file present → streams with `image/png`
  - `internal:png` setting + file missing → 404
  - External URL setting → 404 (route is internal-only)
  - Empty setting → 404

### 12.4 Component tests (only the non-trivial ones)

- `tests/components/admin/AddUserSlideOver.test.tsx`
  - Generate-password submit → success screen shows password
  - Manual-password submit → success screen does NOT show password
- `tests/components/admin/AccentColorForm.test.tsx`
  - Save disabled when contrast fails
  - "Use nearest accessible" button populates the field
  - Both contrast badges update on change

### 12.5 Integration smoke tests

- `tests/app/admin/users/page.test.tsx` — RSC renders the user list rows
- `tests/app/admin/settings/page.test.tsx` — RSC renders three section cards with current values

### 12.6 Migration test

- Add an assertion to the existing migrations test that `006_seed_phase_8_settings.sql` seeds `app_name`, `logo_url`, `accent_color` keys and is idempotent.

### 12.7 Forced-change gate test

- `tests/app/layout.test.tsx` (or whichever file already covers the root layout):
  - User with `must_change_password=1` on `/` → redirected to `/change-password`
  - User with `must_change_password=1` on `/change-password` → not redirected
  - User with `must_change_password=1` on `/logout` → not redirected
  - User with `must_change_password=0` → never redirected

---

## 13. Dependencies

- **Add:** `chroma-js` (~16 KB minified, MIT) for OKLCH conversion in `nearestAccessible`. Used only server-side and in the accent colour form's live preview.

No other new dependencies.

---

## 14. Out of scope (Phase 9 wires these up)

- PWA manifest reading `app_name` + `accent_color` from settings
- Service worker
- "Add to Home Screen" prompt
- Deployment templates (Unraid, Render)
- Migrating components from `bg-blue-*` to `bg-accent-*`
