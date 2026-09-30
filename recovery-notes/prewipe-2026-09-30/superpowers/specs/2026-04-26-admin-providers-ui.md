# Admin Providers UI — Design Spec

**Date:** 2026-04-26
**Status:** Approved
**Phase:** 3.6 (inserted before Phase 4 to unblock manual testing of file browsing)

---

## 1. Goals & Non-Goals

**Goals:**
- Give admins a web UI to add and remove storage providers (local FS and S3-compatible)
- Fix the setup wizard so S3-only users can complete first-run without touching the CLI
- Unblock manual testing of all file-browsing phases (4–7)

**Non-Goals:**
- User management UI (CLI already covers this; no upcoming phase depends on it)
- App customisation UI (name, logo, accent colour — deferred to Phase 8; only needed when the PWA manifest is served dynamically in Phase 9)
- Provider editing / rename (add + remove is sufficient for now)
- Drag-to-reorder providers (the `position` column exists in the DB but reordering is not needed yet)

---

## 2. Routes

```
/admin              → redirect to /admin/providers
/admin/providers    → provider list + add slide-over
```

The sidebar's existing "Admin" link already points to `/admin`. The redirect makes it immediately useful.

---

## 3. Auth Guard

A shared `src/app/admin/layout.tsx` (React Server Component) wraps all `/admin/*` routes:

1. Call `getCurrentUser()`.
2. If no session → `redirect("/login")`.
3. If `user.role !== "admin"` → `redirect("/")`.
4. Otherwise render `{children}`.

No tRPC involved — the guard is a pure server-side layout check.

---

## 4. `/admin/providers` Page

### 4.1 Server Component (page.tsx)

- Calls `listProviders(getDatabase())` directly (no tRPC for reads).
- Renders the provider list and the "Add provider" button.
- Passes providers as props to the client shell that owns the slide-over open/close state.

### 4.2 Provider List

Each row shows:
- **Name** (bold)
- **Slug** (muted, monospace)
- **Type badge** — `local` or `s3` (small pill)
- **Remove button** — submits a Server Action `deleteProvider`

Remove is destructive with no undo. A `window.confirm()` on the client (via `onClick`) before the form submits is sufficient — no modal needed.

Empty state: a short message ("No providers yet. Add one below.") with a direct link/button to open the slide-over.

### 4.3 Slide-Over

A client component (`AddProviderSlideOver`) owned by a thin client wrapper around the page. State: `open: boolean`, toggled by the "Add provider" button.

- Overlays the page from the right (or bottom on mobile).
- Contains the add-provider form (see §5).
- Closes on successful submission (after `revalidatePath` completes).
- Closing without submitting discards form state — no confirmation needed (nothing was saved).
- Accessible: focus-traps while open, `Escape` closes it, backdrop click closes it.

---

## 5. Add-Provider Form

Lives inside the slide-over. Implemented as a client component using `useActionState` (same pattern as the setup wizard).

### 5.1 Type Toggle

Two pill buttons: **Local** | **S3**. Default: Local. Selecting a type shows only that type's fields. The toggle is controlled state (`useState`) on the client — no server round-trip.

### 5.2 Local Fields

| Field | Required | Notes |
|---|---|---|
| Name | ✓ | Display name, e.g. "NAS Files" |
| Root path | ✓ | Absolute path in the container, e.g. `/files` |
| Slug | — | Optional; auto-generated from name if blank. In `<details>` (advanced, collapsed by default) |

### 5.3 S3 Fields

| Field | Required | Notes |
|---|---|---|
| Name | ✓ | Display name, e.g. "Backblaze B2" |
| Bucket | ✓ | S3 bucket name |
| Region | ✓ | e.g. `us-east-1` |
| Access Key ID | ✓ | |
| Secret Access Key | ✓ | `type="password"` |
| Endpoint URL | — | For MinIO, Backblaze, Cloudflare R2, etc. |
| Path-style URLs | — | Checkbox; needed for some self-hosted S3 |
| Slug | — | Optional; auto-generated from name if blank. In `<details>` (advanced, collapsed by default) |

### 5.4 Server Action — `addProvider`

File: `src/app/admin/providers/actions.ts`

- Validated with Zod (same field shapes as the CLI's validation).
- Calls `generateUniqueSlug(db, name)` if no slug provided; validates slug format and uniqueness if provided.
- Calls `createProvider(db, { slug, name, type, config })` — uses the existing DB function.
- On success: `revalidatePath("/admin/providers")` and `revalidatePath("/", "layout")` (sidebar provider list).
- Returns `{ error?, fieldErrors? }` on failure (same `FormState` pattern as the rest of the app).

### 5.5 `deleteProvider` Server Action

File: `src/app/admin/providers/actions.ts`

- Input: `slug` (from hidden form field).
- Calls `deleteProvider(db, slug)`.
- `revalidatePath("/admin/providers")` and `revalidatePath("/", "layout")`.
- No return value needed (errors bubble as thrown exceptions).

---

## 6. Setup Wizard Update

`src/components/setup/ProviderForm.tsx` and `src/app/setup/actions.ts` are updated to support both types:

- Add the same Local/S3 type toggle to `ProviderForm`.
- `createFirstProvider` action gains the S3 Zod branch (same validation as `addProvider`).
- The "already has provider" guard remains — this action is still setup-only.
- S3 fields are identical to §5.3.

This ensures an S3-only user can complete first-run without the CLI.

---

## 7. Styling

Follows existing conventions:
- Tailwind v4, same class patterns as `LoginForm`, `SetupForm`, `ProviderForm`.
- Slide-over: fixed panel, `z-50`, semi-transparent backdrop, slides in from the right on desktop / up from the bottom on mobile.
- Type toggle buttons: filled/outlined pill pair (same visual weight as the existing button styles).
- No new design tokens or custom CSS needed.

---

## 8. Testing

- New Server Actions (`addProvider`, `deleteProvider`) get unit tests alongside the existing `factory.test.ts` / `cli.test.ts` patterns — input validation, success path, slug collision.
- `ProviderForm` / setup wizard changes covered by extending the existing setup action tests.
- No E2E tests in this phase (no Playwright yet).

---

## 9. Out-of-Scope Follow-Ups (Phase 8)

When Phase 8 arrives, this admin section grows to include:
- User management (list / add / deactivate / delete / role change)
- App customisation (name, logo, accent colour with WCAG contrast guard)
- Drag-to-reorder providers
