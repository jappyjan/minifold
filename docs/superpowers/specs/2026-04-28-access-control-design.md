# Access Control (Enforcement) — Design Spec

**Date:** 2026-04-28
**Status:** Approved
**Phase:** 7
**Amends:** Parent design spec §8 (replaces JSON file format with YAML, drops the `private` level, narrows phase scope to enforcement only).
**Summary:** Server-side enforcement of per-path access permissions sourced from `.minifold_access.yaml` dot-files alongside the data. No editor UI in this phase — the file format is intentionally hand-editable, and the popover editor is deferred to Phase 8 where it shares user-management plumbing. Phase 7 ships only what's load-bearing for security: the resolver, the enforcement points, and the configuration knobs.

---

## 1. Scope

**In scope:**
- YAML access-file format and parser
- Access resolver module with per-request memoization
- Enforcement at all four entry surfaces:
  - tRPC `browse.list` — filter entries the user can't see out of listings
  - RSC route `/[provider]/[[...path]]` — login redirect for unauth, 404 for authed-but-denied, allow for admin
  - `/api/file/[provider]/[...path]` — 404 on any denial
  - `/api/thumb/[provider]/[...path]` — 404 on any denial
- Optional `defaultAccess` field on `LocalConfig` and `S3Config` provider-config types
- Seed `global_default_access = 'signed-in'` setting on migration
- Admin role bypass

**Out of scope (Phase 8):**
- Right-click / long-press popover editor
- `access.get`, `access.set`, `users.list` tRPC endpoints
- Admin UI for `global_default_access` and per-provider `defaultAccess`
- Audit logging of access decisions

**Permanently dropped from parent spec §8:**
- The `private` level. Levels are now `public`, `signed-in`, and explicit user-list. Admins always bypass; "admin-only" is implicit ("nobody else granted access").

---

## 2. File Format

File: `.minifold_access.yaml` (one per directory, optional)

```yaml
# Default for everything in this folder
default: signed-in

# Per-file overrides (optional)
overrides:
  preview.stl: public
  patrons.stl: [alice, bob]
```

### 2.1 Value shape

A level value is **either** a string **or** a YAML list:

| Shape | Meaning |
|---|---|
| `public` | Anyone, no login required |
| `signed-in` | Any authenticated user |
| `[alice, bob]` | Only those usernames (plus admins, by role bypass) |

Users are referenced by **username**, not UUID. Usernames are already unique, lowercased, and there is no rename flow in Minifold; this keeps the file truly hand-editable. Usernames in the YAML list are lowercased before comparison, so `[Alice]` and `[alice]` behave identically.

### 2.2 Keys

- `default` — the directory-level fallback. Required if the file exists.
- `overrides` — optional map. Keys are direct filenames in this directory only. Subdirectories use their own `.minifold_access.yaml`; the parent never grants access to a subdirectory's contents.
- Comments: standard YAML `#`.

### 2.3 Visibility & failure modes

- The file itself is hidden from listings via the existing `.minifold_*` filter.
- **Malformed YAML:** log a warning, treat as if the file doesn't exist (skip this level, walk up). Rationale: a broken access file at one level should not lock out the entire subtree. The parent's default still applies.
- **Unknown usernames** in a list: log a warning, ignore. The list still applies for the usernames that do resolve.
- **Empty user-list (`[]`)**: nobody allowed. Falls through to admin-only via role bypass.
- **Invalid level value** (e.g., `default: secret`): log a warning, treat that key as if it weren't present.

---

## 3. Resolution

For an entry at `<provider>/<path>` accessed by `currentUser`:

1. **Admin bypass** — if `currentUser?.role === 'admin'`, return `allow`.
2. **Initial level** depends on entry kind:
   - **File** (e.g., `a/b/c.stl`) — start at the **containing directory** `a/b/`. If `a/b/.minifold_access.yaml` has `overrides["c.stl"]` → use that level. Else if it has `default` → use that level. Else step up to `a/` and proceed to step 3.
   - **Directory** (e.g., `a/b/`) — start at the directory **itself**. If `a/b/.minifold_access.yaml` has `default` → use that level. Else step up to `a/` and proceed to step 3. (Directories have no `overrides` lookup — their access is set via their own `default`.)
3. **Walk up** toward the provider root. At each parent directory, if its `.minifold_access.yaml` has `default` → use that level. Else step up. Stop at and include the provider root.
4. If walk-up exhausts without a match: use the **provider's** `defaultAccess` (if configured in `LocalConfig`/`S3Config`).
5. If still no match: use the **global** `global_default_access` setting (default `signed-in`).
6. With a level in hand, decide:
   - `public` → allow
   - `signed-in` → allow if `currentUser` is set, else deny-anonymous
   - `[users…]` → allow if `currentUser?.username` is in the list, else deny-authed (or deny-anonymous if no user)

`overrides` lookups happen **only at the file's immediate containing directory** — never inherited by subdirectories. A malformed access file at any level is skipped (treated as if it didn't exist) and walk-up continues; one broken file does not lock out a subtree.

---

## 4. Permission Semantics by Surface

| Surface | Allow | Deny — anonymous on `signed-in` / user-list | Deny — authed user not in list |
|---|---|---|---|
| RSC page `/{provider}/...` | render | redirect to `/login?returnTo=<href>` | `notFound()` (404) |
| tRPC `browse.list` | include in result | filtered out | filtered out |
| `/api/file/[provider]/[...path]` | stream bytes | `Response(null, {status: 404})` | `Response(null, {status: 404})` |
| `/api/thumb/[provider]/[...path]` | stream WebP | `Response(null, {status: 404})` | `Response(null, {status: 404})` |

Two principles:
- **API routes always 404 on denial** — never reveal existence of files the user shouldn't know about.
- **The page route is the only surface that does the login redirect.** API routes are called by the browser on already-rendered pages; by then either the page allowed the user through (so they're fine) or the page itself redirected. A broken-image fallback for stale tabs is acceptable.

For `browse.list`: filtering happens server-side after the storage `list()` call returns, so the wire payload only contains what the user can see. The directory hash (Phase 6) is computed over the unfiltered listing — access changes don't invalidate the directory cache, since the cache is over filesystem state, not access state.

---

## 5. Enforcement Points

| File | Change |
|---|---|
| `src/server/access/resolver.ts` *(new)* | `createAccessResolver(opts)` factory returning a per-request resolver with memoized `.minifold_access.yaml` reads. Method `resolve(providerSlug, path, kind: 'file' \| 'directory'): Promise<Decision>` where `Decision = 'allow' \| 'deny-anonymous' \| 'deny-authed'`. |
| `src/server/access/format.ts` *(new)* | YAML parser + schema validator. Pure function `parseAccessFile(text): { default?: Level, overrides?: Record<string, Level>, warnings: string[] }`. |
| `src/server/access/types.ts` *(new)* | Shared `Level` and `Decision` types. |
| `src/server/trpc/routers/browse.ts` | After `listWithCache`, run each entry through the resolver and drop entries that resolve to anything other than `allow`. |
| `src/app/[provider]/[[...path]]/page.tsx` | Resolve the requested path. On `deny-anonymous` → `redirect('/login?returnTo=...')`. On `deny-authed` → `notFound()`. |
| `src/app/api/file/[provider]/[...path]/route.ts` | Resolve. Any non-`allow` → `Response(null, {status: 404})`. |
| `src/app/api/thumb/[provider]/[...path]/route.ts` | Same as `/api/file`. |
| `src/server/db/providers.ts` | Add `defaultAccess?: 'public' \| 'signed-in'` to `LocalConfig` and `S3Config`. No DB migration — `providers.config` is freeform encrypted JSON. |
| `src/server/db/migrations/005_seed_global_access.sql` *(new)* | Seed `INSERT OR IGNORE INTO settings (key, value) VALUES ('global_default_access', 'signed-in')`. |

---

## 6. Performance

- Resolver memoizes `.minifold_access.yaml` parses by absolute path (provider slug + path) for the lifetime of one request.
- A directory listing of N entries triggers O(depth) reads regardless of N — the parent dir's access file is read once and reused for every entry.
- For local FS this is microseconds.
- For S3, this is O(depth) HEAD-or-GET requests per page render. With per-request memoization a typical browse page fires at most a handful. Acceptable.
- No DB caching of access decisions, no background scanning, no cross-request state. Filesystem-as-source-of-truth principle preserved.
- Revisit only if measurements show a bottleneck.

---

## 7. Schema & Config Changes

### 7.1 Settings table

New seeded row (idempotent INSERT):

```sql
INSERT OR IGNORE INTO settings (key, value)
VALUES ('global_default_access', 'signed-in');
```

Valid values: `public`, `signed-in`. Reading returns `'signed-in'` if the row is somehow missing.

### 7.2 Provider config

```ts
type LocalConfig = {
  rootPath: string;
  defaultAccess?: 'public' | 'signed-in';   // new, optional
};

type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  pathStyle: boolean;
  defaultAccess?: 'public' | 'signed-in';   // new, optional
};
```

Provider-level `defaultAccess` does not support user-list — keeping the provider knob simple and giving operators a single place to put per-user rules (`.minifold_access.yaml` at the provider root).

### 7.3 New dependency

`yaml` (npm) — canonical pure-JS YAML 1.2 parser. ~30 KB minified, MIT.

---

## 8. Test Strategy

| Layer | Tests |
|---|---|
| `format.ts` unit | Parse valid file; parse with comments; parse with `overrides` only; parse with `default` only; reject invalid level; reject invalid YAML; reject non-object root; ignore unknown top-level keys with warning; empty `overrides` accepted. |
| `resolver.ts` unit | Each level type × authed/anonymous/admin; walk-up across two and three levels; provider default fallback; global default fallback; missing access file at intermediate levels; malformed file at intermediate level still resolves via parent; unknown username ignored; empty list denies everyone but admins; per-request memoization (one read for N entries in a directory). |
| `browse.ts` integration | List with mixed-permission entries — anonymous user sees only public; signed-in user sees public + signed-in; user-list entry visible only to listed users; admin sees all; `.minifold_access.yaml` itself never appears in results. |
| `/api/file` integration | 404 for anonymous on signed-in; 404 for non-listed authed user on user-list; 200 for allowed user; 200 for admin on anything. |
| `/api/thumb` integration | Same matrix as `/api/file`. |
| RSC page integration | Anonymous on signed-in path → 307 to `/login?returnTo=...`; authed on user-list-not-in → 404; admin on anything → 200. (Tested via `appRouter.createCaller`-style helpers where possible; full RSC integration via existing component-test helpers.) |

---

## 9. Open Questions

None — all design decisions resolved.
