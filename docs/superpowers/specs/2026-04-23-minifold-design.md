# Minifold — Design Spec

**Date:** 2026-04-23  
**Status:** Approved  
**Summary:** A simple, self-hosted file browser for 3D print files (STL, 3MF), documents (Markdown, PDF), and arbitrary folder structures. The lightweight alternative to Manyfold — adding a file to disk and reloading the page is all it takes to make it visible.

---

## 1. Goals & Non-Goals

**Goals:**
- Browse STL, 3MF, Markdown, and PDF files via a clean web UI
- File structure on disk = URL structure in the browser (1:1 mapping)
- Interactive 3D viewer + lazy server-side thumbnails for STL/3MF
- Multiple storage backends (local FS + S3-compatible), configurable via UI
- Per-path access control (public / signed-in / specific users)
- Mobile-first, installable as a PWA
- Performant at thousands of files / gigabytes of data
- Simple to self-host via Docker

**Non-Goals:**
- Active file indexing / background scanning (filesystem IS the index)
- Social features (comments, likes, follows)
- File upload / editing via the UI (read-only browser)
- Granular role/permission system beyond admin + user

---

## 2. Architecture

### Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | Next.js 15 (App Router) | SSR + RSC + API routes in one container |
| Language | TypeScript throughout | Type safety end-to-end |
| API | tRPC v11 | Fully typed client–server contract, no REST boilerplate |
| Database | SQLite via `better-sqlite3` | Zero infrastructure, single file |
| Auth | NextAuth.js v5 + CredentialsProvider | Provider-abstracted, easy OIDC upgrade path |
| 3D rendering | Three.js | Client viewer + headless thumbnail generation |
| Thumbnail worker | Puppeteer + Three.js (headless) | Server-side render → WebP dot-files |
| Job queue | `p-queue` (concurrency: 2, in-process) | No Redis, no external workers |
| PWA cache | Service Worker + IndexedDB | Offline shell + directory listing cache |

### Environment Variables

Only two env vars are recognised — everything else lives in the database:

```
DATABASE_PATH   Path to SQLite file          default: ./data/minifold.db
PORT            HTTP port                    default: 3000
```

`SESSION_SECRET` is auto-generated on first boot and persisted to the DB. No other env vars.

### Container

Single Docker image. Standalone Next.js build (`output: 'standalone'`).

Volumes:
- `/data` — SQLite database
- `/files` — local file storage (only needed if using the local FS provider)

---

## 3. First-Time Setup Wizard

On first boot, if the DB contains no admin user, the app intercepts all routes and serves a setup wizard instead of the normal UI. Steps:

1. **Create admin account** — name, email, password
2. **Add first storage provider** — name, type (local / S3), type-specific config
3. **Set access default** — public / signed-in / private

After completion the wizard is never shown again. Pattern: Gitea, Nextcloud, Umami.

---

## 4. Storage Providers

### StorageProvider Interface

All file access goes through one interface. No part of the application touches `fs` or AWS SDK directly.

```ts
interface StorageProvider {
  list(path: string): Promise<Entry[]>
  stat(path: string): Promise<Entry>
  read(path: string): Promise<ReadableStream>
  write(path: string, data: Buffer): Promise<void>
  exists(path: string): Promise<boolean>
}

interface Entry {
  name: string
  type: 'file' | 'directory'
  size: number          // bytes, 0 for directories
  modifiedAt: Date
  etag?: string         // S3 only
}
```

### Implementations

| Type | Config fields |
|---|---|
| `local` | `rootPath` — absolute path on the host filesystem |
| `s3` | `endpoint`, `bucket`, `region`, `accessKeyId`, `secretAccessKey`, `pathStyle` |

### Multiple Providers

Multiple providers can be configured simultaneously via the admin UI. Each has:
- `slug` — URL-safe identifier (e.g., `nas`, `backblaze`)
- `name` — display name (e.g., "NAS Files")
- `type` — `local` | `s3`
- `config` — type-specific fields, stored AES-encrypted in SQLite

Providers appear as top-level roots in the sidebar and file tree.

### URL ↔ Path Mapping

URLs map 1:1 to filesystem paths:

```
/nas/prints/benchy/anchor.stl
 ↕
provider slug "nas" + path "prints/benchy/anchor.stl"
```

Deep links, bookmarks, and shares all work without any translation layer.

---

## 5. File Browsing

### Directory Listing

`StorageProvider.list(path)` is called on every directory request. The filesystem is always the source of truth — no database index. Adding a file and reloading the page makes it visible immediately.

Results are sorted: folders first, then files alphabetically.

### Special Description Files

If a directory contains any of the following (case-insensitive), that file is treated as the folder's description and rendered as HTML above the file grid. It is hidden from the grid itself.

- `index.md`
- `readme.md`
- `model.md`
- `collection.md`

### File-Level Descriptions

On a file's detail page, the app looks for a sibling markdown file with the same base name (e.g., `anchor.md` alongside `anchor.stl`) and renders it as the description. Frontmatter `tags` are parsed and displayed as pills.

### Supported File Types

| Type | Grid | Detail |
|---|---|---|
| `.stl` | Thumbnail card | Interactive Three.js viewer + description |
| `.3mf` | Thumbnail card | Interactive Three.js viewer + description |
| `.md` | Document icon card | Rendered Markdown |
| `.pdf` | Document icon card | Inline PDF viewer (PDF.js) |
| Other | Generic icon card | Download link |
| Directory | Folder icon or thumbnail collage | Opens the directory |

---

## 6. Thumbnail Pipeline

### Generation

Thumbnails are generated **lazily on first request** — no background scanning.

Request flow for `GET /api/thumb?path=nas/prints/anchor.stl`:

1. Check for sibling dot-file `.minifold_thumb_anchor.stl.webp` via `StorageProvider.exists()`
2. If exists → stream it directly → done
3. If not → enqueue a generation job in `p-queue` (concurrency: 2)
4. Job: launch Puppeteer with a minimal Three.js HTML page, load the model, render a frame, export as WebP
5. Save via `StorageProvider.write('.minifold_thumb_anchor.stl.webp', data)`
6. Return the generated WebP

Subsequent requests hit step 2 and return instantly.

### Client-Side Loading

Thumbnail `<img>` elements use an **Intersection Observer** — the `src` is only set when the element enters the viewport. This means a directory with 500 files only requests the thumbnails currently visible on screen.

### Interactive 3D Viewer

On detail pages, Three.js is initialised client-side with the full model file. Controls: orbit (drag / one-finger), zoom (scroll / pinch), reset, wireframe toggle. Touch-optimised for mobile.

---

## 7. Hash-Based Directory Caching

### Server Side

On every `browse` request, the server computes a **directory hash**:
- **Local FS:** hash of `{name, size, mtime}` for each direct child, sorted alphabetically
- **S3:** hash of `{name, size, etag}` for each object in the immediate prefix

The hash and `computed_at` timestamp are stored in the SQLite `dir_cache` table.

### API Contract

Exposed as a tRPC query (consistent with the rest of the API layer):

```ts
// input
{ path: string; knownHash?: string }

// output (unchanged)
{ changed: false; hash: string }

// output (changed or no knownHash)
{ changed: true; hash: string; entries: Entry[] }
```

### Client Side

Directory listings are stored in **IndexedDB** keyed by path: `{ hash, entries, cachedAt }`.

On folder navigation:
1. **Immediately render** from IndexedDB (instant, zero network)
2. Fire hash-check in background
3. If `changed: true` → update listing + refresh IndexedDB
4. If `changed: false` → nothing to do

**PWA offline:** IndexedDB entries are available without network. Previously visited directories load instantly even offline.

---

## 8. Access Control

### Permission Levels

| Level | Who can access |
|---|---|
| `public` | Anyone on the internet, no login required |
| `signed-in` | Any authenticated user |
| `user-list` | Specific user IDs only |
| `private` | Admins only |

### Resolution (most specific wins)

```
file override → parent directory override → grandparent → ... → provider default → global default
```

Global default and per-provider defaults are set in admin settings. Per-path overrides are stored in SQLite (`access_rules` table: `path`, `level`, `user_ids[]`).

### Behaviour

- Unauthenticated users hitting a `signed-in` or `user-list` path → login page (not 404)
- Unauthenticated users hitting a `private` path → 404 (existence not revealed)
- Admin users bypass all access rules

### UI

Right-click (desktop) or long-press (mobile) on any file or folder → "Set access" popover with level selector and user picker. Mirrors Google Drive's sharing model.

---

## 9. Authentication & User Management

### Auth

- **NextAuth.js v5** with a custom `CredentialsProvider` backed by the SQLite `users` table
- Passwords hashed with bcrypt
- Sessions stored in SQLite, 30-day rolling expiry (each authenticated request extends the session by another 30 days)
- Sessions invalidated on password change or manual admin revocation
- **Upgrade path:** adding OIDC is a new NextAuth provider — no changes to auth logic

### Users

- **Roles:** `admin` and `user`
- Admin creates accounts (no self-registration by default, toggleable)
- First login after creation: forced password change
- Admin UI (sidebar → Admin → Users): table with name, email, role, last login, status; add / deactivate / delete

---

## 10. UI & Views

### App Shell

| Viewport | Layout |
|---|---|
| Desktop (≥768px) | Persistent left sidebar: app logo, provider list, top-level folders, admin link at bottom |
| Mobile (<768px) | Top bar with hamburger → full-screen drawer for sidebar contents |

Breadcrumb navigation in the main content area header. View toggle (grid / column) and search in the top-right of the content area.

### Grid View (default)

Thumbnail cards in a responsive grid. Each card: thumbnail (lazy-loaded) or type icon, file/folder name. Double-click/tap a folder to enter it. Single click/tap a file opens its detail page. Folder description rendered as a banner above the grid if a special markdown file is present.

### Column / Finder View

macOS Finder-style columns. Clicking a folder loads its contents in the next column. Clicking a file shows a detail strip at the bottom. Available via toolbar toggle — not the default. Tablet and desktop only (≥768px); on smaller viewports the toolbar toggle is hidden and grid view is always used.

### Detail Page

Side-by-side layout on desktop (viewer left, info right). Collapses to stacked on mobile (viewer full-width on top, info scrolls below).

Info panel contains: file name, type, size, modified date, description (rendered Markdown from sibling `.md`), tags (from frontmatter), download button.

---

## 11. Customisation

Configured via admin settings page, stored in DB:

| Setting | Description |
|---|---|
| App name | Replaces "Minifold" in the UI and PWA manifest |
| Logo | Upload or URL; shown in sidebar header |
| Accent colour | Single colour picker; used for highlights, active states, links |

**Guardrails:** The accent colour is validated against WCAG AA contrast ratios at save time, against both light mode and dark mode backgrounds. If contrast is insufficient in either mode, the colour is clamped to the nearest accessible value and a warning is shown.

Font, layout, spacing, and border radii are not configurable — the design system is fixed.

---

## 12. PWA

- `manifest.json` served dynamically (includes current app name and accent colour from DB)
- Service worker: offline shell (app loads and renders cached listings without network)
- "Add to Home Screen" prompt shown after 30 seconds on first visit
- Offline state uses IndexedDB directory cache (see §7)

---

## 13. Performance Considerations

- No database index of files — filesystem is always the source of truth
- Directory listings are O(1) network round-trips for cached/unchanged directories
- Thumbnails only fetched when in viewport (Intersection Observer)
- Thumbnail generation is queued with concurrency 2 — server never overwhelmed
- `p-queue` prevents thundering herd on initial browse of a large uncached directory
- SQLite with WAL mode for concurrent reads during thumbnail writes

---

## 14. Deployment

### Docker

Single image, standalone Next.js build. Published to GitHub Container Registry as `ghcr.io/jappyjan/minifold`.

### Templates

| File | Target |
|---|---|
| `docker-compose.yml` | Generic, works anywhere |
| `docker-compose.coolify.yml` | Coolify (`SERVICE_FQDN_MINIFOLD`, `SERVICE_PASSWORD_ADMIN` magic vars, Coolify labels) |
| `docker-compose.traefik.yml` | Traefik reverse proxy (labels pre-wired) |
| `unraid-template.xml` | Unraid Community Applications |
| `render.yaml` | Render one-click deploy |

README includes a **Deploy to Render** badge.

---

## 15. Data Model (SQLite)

```sql
-- Users
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,           -- bcrypt hash
  role        TEXT NOT NULL DEFAULT 'user',  -- 'admin' | 'user'
  must_change_password INTEGER DEFAULT 1,
  deactivated INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL,
  last_login  INTEGER
);

-- Sessions
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Storage providers
CREATE TABLE providers (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,           -- 'local' | 's3'
  config      TEXT NOT NULL,           -- AES-encrypted JSON
  position    INTEGER NOT NULL DEFAULT 0
);

-- Access control overrides
CREATE TABLE access_rules (
  path        TEXT PRIMARY KEY,        -- '{provider-slug}/{...path}'
  level       TEXT NOT NULL,           -- 'public' | 'signed-in' | 'user-list' | 'private'
  user_ids    TEXT                     -- JSON array, only for 'user-list'
);

-- App settings (key-value)
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL
);
-- Keys: app_name, logo_url, accent_color, session_secret,
--       global_default_access, allow_registration

-- Directory hash cache
CREATE TABLE dir_cache (
  path        TEXT PRIMARY KEY,        -- '{provider-slug}/{...path}'
  hash        TEXT NOT NULL,
  computed_at INTEGER NOT NULL
);
```

---

## 16. Open Questions

None — all design decisions resolved.
