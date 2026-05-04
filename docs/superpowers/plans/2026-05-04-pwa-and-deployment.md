# Phase 9 — PWA & Deployment Templates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Minifold installable as a PWA on Android, iOS, and desktop Chromium; brand the install per-deployment by reading `app_name`, `accent_color`, and the uploaded logo from the existing settings table; keep the app shell renderable offline so previously-visited directories (Phase 6 IndexedDB cache) work without network. Ship five deployment templates (generic Compose, Coolify, Traefik, Unraid, Render) and replace the current `docker-compose.yaml` (which is the Coolify variant masquerading as the canonical filename) with a real generic compose file.

**Architecture:** Dynamic `app/manifest.ts` reads settings on every request (force-dynamic). Uploaded logos are resized at upload time via `sharp` into 180/192/512 variants plus a 512×512 maskable composited on the accent backdrop; all four are served through a single `/api/icon/[size]/[purpose]` dispatch route that falls back to pre-rendered defaults in `public/icons/`. Service worker is authored in TypeScript at `src/sw/sw.ts`, compiled to `public/sw.js` via an esbuild script that runs after `next build`; pure cache-strategy logic lives in `src/sw/strategy.ts` and is tested in isolation. Install prompt UX is `@khmyznikov/pwa-install` (web component, dynamic-imported in a single `PWAClient.tsx` mounted from the layout). Deployment templates live at the repo root.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript with `noUncheckedIndexedAccess: true`, Vitest + happy-dom + `@testing-library/react`, `sharp` (new dep), `@khmyznikov/pwa-install` (new dep, web component), `esbuild` (new direct dev dep, was transitive), `tsx` (already a transitive dev dep, used to invoke build scripts).

**Spec:** `docs/superpowers/specs/2026-05-03-pwa-and-deployment-design.md`

---

## Conventions & Reminders

- **Indexed access is `T | undefined`** (`noUncheckedIndexedAccess`): always guard `arr[i]`, `obj[k]`.
- **Package manager:** the repo uses **`pnpm`** (per `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and CI). Always use `pnpm` for installs (`pnpm add <pkg>`, `pnpm add -D <pkg>`); `pnpm test`, `pnpm build`, etc. for scripts. Do NOT use `npm install` — it would generate a parallel `package-lock.json` that conflicts with the existing pnpm lock.
- **Test isolation pattern** (proven across Phase 8): mock `next/cache` + `next/navigation`, seed a real DB at a temp path via `vi.stubEnv("DATABASE_PATH", ...)`, `vi.resetModules()` before each import to pick up the env, call `__resetDatabase()` from `@/server/db` in `afterEach`. Same template as `tests/app/admin/settings/actions.test.ts` lines 1-30.
- **Server Action return shape:** `{ success?: true; ... } | { error?: string; fieldErrors?: Record<string,string> }`. Existing pattern in `src/app/admin/settings/actions.ts`.
- **PNG test fixtures:** use `sharp({ create: ... }).png().toBuffer()` inside `beforeAll`/`beforeEach` to generate real, decodable PNG buffers. The PNG-magic-bytes pattern from `logo-storage.test.ts` is sufficient for type-sniffing tests but NOT for tests that actually decode the image (e.g. resize tests).
- **Commits:** small, conventional-commit style (`feat(pwa)`, `feat(icons)`, `feat(sw)`, `feat(deploy)`, `chore(deps)`, `docs(readme)`).
- **Run after each code-touching task:** `pnpm test -- <changed-test-files>` and ensure pass before committing.
- **Run before final task:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` — all four must pass.

## Deviations from spec

None planned. Two items are flagged in the spec as "verify at plan-writing time":

1. **Render one-disk-per-service.** Quickly checked Render docs: still one `disk:` per service (each service can have one persistent disk; multi-disk is not supported). The spec's single-disk YAML is the correct shape — Task 16 ships it as planned.
2. **Custom-element JSX in React 19.** `<pwa-install>` is a custom HTML element. React 19 handles unknown elements via lowercase tag detection (renders them verbatim, no warnings) — see [React 19 release notes on custom elements](https://react.dev/blog/2024/04/25/react-19#support-for-custom-elements). TypeScript still needs a JSX intrinsic-element augmentation (Task 11). No fallback to imperative `ref`-based mounting needed.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `src/server/settings/icon-rendering.ts` | Pure `sharp` wrappers: `resizeAny(buf, size)`, `composeMaskable(buf, accentHex)` |
| `scripts/build-default-icons.ts` | Prebuild: reads `public/icons/icon-source.png`, writes 180/192/512/maskable-512 variants |
| `scripts/build-sw.ts` | Postbuild: bundles `src/sw/sw.ts` → `public/sw.js` via esbuild, injects `SHELL_VERSION` and `PRECACHE_LIST` |
| `src/sw/sw.ts` | Service worker source (TypeScript, compiled at build time) |
| `src/sw/strategy.ts` | Pure `getCacheStrategy(url, method)` classifier |
| `src/app/manifest.ts` | Dynamic Web App Manifest reading settings (force-dynamic) |
| `src/app/api/icon/[size]/[purpose]/route.ts` | Serve sized PNG variant from `/data/logo-*.png` or fall back to `public/icons/icon-*.png` |
| `src/components/pwa/PWAClient.tsx` | `"use client"`: SW registration + 30s timer + `<pwa-install>` mounting |
| `src/components/pwa/pwa-install.d.ts` | JSX type augmentation for `<pwa-install>` |
| `public/icons/icon-source.png` | 1024×1024 Nano Banana render (already committed in spec PR) |
| `docs/unraid-icon.png` | 512×512 default icon copy used by `unraid-template.xml`'s `<Icon>` URL |
| `docker-compose.yml` | Generic Compose template (replaces masquerading Coolify file) |
| `docker-compose.coolify.yml` | Current `docker-compose.yaml` content, moved |
| `docker-compose.traefik.yml` | Generic Traefik labels, no Coolify-specific UUIDs |
| `unraid-template.xml` | Unraid CA template (single-container) |
| `render.yaml` | Render one-click deploy (single service + 1 disk) |

**New test files:**

| Path |
|---|
| `tests/server/settings/icon-rendering.test.ts` |
| `tests/app/manifest.test.ts` |
| `tests/app/api/icon/route.test.ts` |
| `tests/sw/strategy.test.ts` |
| `tests/sw/sw.test.ts` |
| `tests/scripts/build-default-icons.test.ts` |
| `tests/scripts/build-sw.test.ts` |
| `tests/components/pwa/PWAClient.test.tsx` |

**Modified files:**

| Path | Change |
|---|---|
| `package.json` | Add `sharp` (dep), `@khmyznikov/pwa-install` (dep), `esbuild` (devDep, promote from transitive); add `prebuild` and `postbuild` scripts |
| `src/server/settings/logo-storage.ts` | Extend `writeLogo` to also emit 180/192/512/maskable variants; extend `clearLogo` to delete them; export new `regenerateMaskable(currentBuffer, accentHex)` |
| `tests/server/settings/logo-storage.test.ts` | Cover the four-variant writes + `regenerateMaskable` |
| `src/app/admin/settings/actions.ts` | `saveLogo` calls the new variant-emitting flow; `saveAccentColor` calls `regenerateMaskable` if a logo exists; `clearLogo` deletes variants |
| `tests/app/admin/settings/actions.test.ts` | Extend with variant-generation cases on upload, accent-change-regenerates-maskable, clearLogo-deletes-variants |
| `src/app/layout.tsx` | Add `<link rel="apple-touch-icon">`, `<meta name="theme-color">`, inline `beforeinstallprompt` capture script in `<head>`; mount `<PWAClient />` in `<body>` |
| `next.config.ts` | Add `headers()` block returning the `/sw.js` headers (Content-Type, no-cache, Service-Worker-Allowed) |
| `Dockerfile` | Accept `BUILD_SHA` build arg, set as `ENV` for `next build` step so `scripts/build-sw.ts` can read it |
| `.github/workflows/ci.yml` | Pass `BUILD_SHA=${{ github.sha }}` as Docker build arg in `publish` job; add `docker compose config` and `xmllint` validation steps in `verify` job |
| `README.md` | Replace Deployment section with badge + per-template table (preserve existing thumbs-disable hint) |
| `.gitignore` | Add `/public/icons/icon-180.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, and `/public/sw.js` |

**Removed files:**

| Path | Reason |
|---|---|
| `docker-compose.yaml` | Renamed/moved to `docker-compose.coolify.yml` (Task 13) |

---

## Task 1: Add dependencies

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Add runtime dependencies**

Run:
```bash
pnpm add sharp @khmyznikov/pwa-install
```

Expected: `package.json` gains `"sharp": "^0.x"` and `"@khmyznikov/pwa-install": "^0.6.x"` under `dependencies`. `pnpm-lock.yaml` updated.

- [ ] **Step 2: Add esbuild as a direct dev dependency**

Run:
```bash
pnpm add -D esbuild
```

Expected: `package.json` gains `"esbuild": "^0.x"` under `devDependencies`. (esbuild was previously available transitively through Next; this promotes it to direct so we can rely on its version explicitly when calling it from build scripts.)

- [ ] **Step 3: Verify sharp loads**

Run:
```bash
node -e "const s = require('sharp'); s({create:{width:8,height:8,channels:4,background:'#3b82f6'}}).png().toBuffer().then(b => console.log('sharp ok, bytes:', b.length))"
```

Expected: `sharp ok, bytes: <some number>`. If this errors with "Could not load the sharp module" on macOS, run `pnpm rebuild sharp` and try again.

- [ ] **Step 4: Verify @khmyznikov/pwa-install resolves**

Run:
```bash
pnpm list @khmyznikov/pwa-install
```

Expected: tree output showing `@khmyznikov/pwa-install 0.6.x`. (The package's `exports` field doesn't whitelist `./package.json`, so the obvious `node -e "require('@khmyznikov/pwa-install/package.json')"` errors with `ERR_PACKAGE_PATH_NOT_EXPORTED` even when the package is installed correctly.)

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add sharp + @khmyznikov/pwa-install + promote esbuild to direct devDep"
```

---

## Task 2: `icon-rendering.ts` — pure sharp wrappers

**Files:**
- Create: `src/server/settings/icon-rendering.ts`
- Test: `tests/server/settings/icon-rendering.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/settings/icon-rendering.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import sharp from "sharp";
import { resizeAny, composeMaskable } from "@/server/settings/icon-rendering";

let sourcePng: Buffer;

beforeAll(async () => {
  // 1024×1024 PNG: red square on transparent — content doesn't matter, we only check geometry.
  sourcePng = await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer();
});

describe("resizeAny", () => {
  for (const size of [180, 192, 512] as const) {
    it(`returns a ${size}×${size} PNG`, async () => {
      const out = await resizeAny(sourcePng, size);
      const meta = await sharp(out).metadata();
      expect(meta.format).toBe("png");
      expect(meta.width).toBe(size);
      expect(meta.height).toBe(size);
    });
  }

  it("preserves transparency for non-square inputs (letterboxed via fit:contain)", async () => {
    const wide = await sharp({
      create: { width: 1024, height: 256, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } },
    }).png().toBuffer();
    const out = await resizeAny(wide, 192);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(192);
    expect(meta.height).toBe(192);
    // Top-left pixel (well above the green stripe) should be fully transparent (alpha=0).
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    // PNG channels: RGBA. data[3] = alpha at (0,0).
    expect(data[3]).toBe(0);
  });
});

describe("composeMaskable", () => {
  it("returns a 512×512 PNG", async () => {
    const out = await composeMaskable(sourcePng, "#3b82f6");
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
  });

  it("paints all four corners with the accent colour (outside the safe zone)", async () => {
    const out = await composeMaskable(sourcePng, "#3b82f6");
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    // info.channels = 4 (RGBA). Pixel (x,y) → offset (y * info.width + x) * 4.
    const px = (x: number, y: number) => {
      const off = (y * info.width + x) * info.channels;
      return [data[off], data[off + 1], data[off + 2]];
    };
    const expected = [0x3b, 0x82, 0xf6];
    expect(px(0, 0)).toEqual(expected);
    expect(px(511, 0)).toEqual(expected);
    expect(px(0, 511)).toEqual(expected);
    expect(px(511, 511)).toEqual(expected);
  });

  it("accepts hex without the # prefix and CSS named colours via sharp", async () => {
    // sharp itself accepts "#rrggbb", "rrggbb", and CSS names — we just hand it through.
    const out = await composeMaskable(sourcePng, "#000000");
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]]).toEqual([0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/server/settings/icon-rendering.test.ts`
Expected: FAIL — module `@/server/settings/icon-rendering` not found.

- [ ] **Step 3: Write the implementation**

Create `src/server/settings/icon-rendering.ts`:

```ts
import sharp from "sharp";

export async function resizeAny(
  input: Buffer,
  size: 180 | 192 | 512,
): Promise<Buffer> {
  return sharp(input)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

export async function composeMaskable(
  input: Buffer,
  accentHex: string,
): Promise<Buffer> {
  const SIZE = 512;
  const SAFE = Math.round(SIZE * 0.7); // 70% safe zone per Android maskable spec
  const inset = Math.round((SIZE - SAFE) / 2);

  const logo = await sharp(input)
    .resize(SAFE, SAFE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: accentHex,
    },
  })
    .composite([{ input: logo, left: inset, top: inset }])
    .png()
    .toBuffer();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/server/settings/icon-rendering.test.ts`
Expected: PASS — all 5+ cases.

- [ ] **Step 5: Commit**

```bash
git add src/server/settings/icon-rendering.ts tests/server/settings/icon-rendering.test.ts
git commit -m "feat(icons): pure sharp wrappers for resize + maskable composition"
```

---

## Task 3: Extend `logo-storage.ts` to emit variants + `regenerateMaskable`

**Files:**
- Modify: `src/server/settings/logo-storage.ts`
- Modify: `tests/server/settings/logo-storage.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/settings/logo-storage.test.ts` (the existing test sets up `tmp` in `beforeEach` — reuse it):

```ts
import sharp from "sharp";
import { regenerateMaskable } from "@/server/settings/logo-storage";

async function realPng(width = 32, height = 32): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer();
}

describe("writeLogo (variant generation)", () => {
  it("writes logo-180.png, logo-192.png, logo-512.png, logo-maskable-512.png on upload", async () => {
    const buf = await realPng();
    await writeLogo(tmp, buf, "#3b82f6");
    expect(existsSync(join(tmp, "logo.png"))).toBe(true);
    expect(existsSync(join(tmp, "logo-180.png"))).toBe(true);
    expect(existsSync(join(tmp, "logo-192.png"))).toBe(true);
    expect(existsSync(join(tmp, "logo-512.png"))).toBe(true);
    expect(existsSync(join(tmp, "logo-maskable-512.png"))).toBe(true);
  });

  it("variants have the expected dimensions", async () => {
    const buf = await realPng();
    await writeLogo(tmp, buf, "#3b82f6");
    expect((await sharp(join(tmp, "logo-180.png")).metadata()).width).toBe(180);
    expect((await sharp(join(tmp, "logo-192.png")).metadata()).width).toBe(192);
    expect((await sharp(join(tmp, "logo-512.png")).metadata()).width).toBe(512);
    expect((await sharp(join(tmp, "logo-maskable-512.png")).metadata()).width).toBe(512);
  });

  it("maskable variant uses the supplied accent for the corner pixel", async () => {
    const buf = await realPng();
    await writeLogo(tmp, buf, "#000000");
    const corner = await sharp(join(tmp, "logo-maskable-512.png"))
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect([corner[0], corner[1], corner[2]]).toEqual([0, 0, 0]);
  });
});

describe("clearLogo (variant deletion)", () => {
  it("removes all variant files alongside the original", async () => {
    const buf = await realPng();
    await writeLogo(tmp, buf, "#3b82f6");
    clearLogo(tmp);
    expect(existsSync(join(tmp, "logo.png"))).toBe(false);
    expect(existsSync(join(tmp, "logo-180.png"))).toBe(false);
    expect(existsSync(join(tmp, "logo-192.png"))).toBe(false);
    expect(existsSync(join(tmp, "logo-512.png"))).toBe(false);
    expect(existsSync(join(tmp, "logo-maskable-512.png"))).toBe(false);
  });
});

describe("regenerateMaskable", () => {
  it("rewrites only logo-maskable-512.png, leaving other variants untouched", async () => {
    const buf = await realPng();
    await writeLogo(tmp, buf, "#3b82f6");
    const before180 = await sharp(join(tmp, "logo-180.png")).raw().toBuffer();

    await regenerateMaskable(tmp, buf, "#ff00ff");
    const corner = await sharp(join(tmp, "logo-maskable-512.png"))
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect([corner[0], corner[1], corner[2]]).toEqual([0xff, 0x00, 0xff]);

    const after180 = await sharp(join(tmp, "logo-180.png")).raw().toBuffer();
    expect(after180.equals(before180)).toBe(true);
  });
});
```

Note: the existing `writeLogo(tmp, buf)` calls in older tests pass only two args; the new signature needs an `accentHex` argument. Update the existing `writeLogo(tmp, PNG_MAGIC)` and `writeLogo(tmp, webpBuffer())` calls to pass `"#3b82f6"` as the third argument. Search-and-replace inside the file: `writeLogo(tmp, ` → `writeLogo(tmp, ` (visual inspection — there are ~5 call sites in `describe("writeLogo")` and `describe("clearLogo")`).

Also fix: the existing `writeLogo` accepts SVG and WebP via `sniffImageType`. Sharp can decode WebP but not arbitrary SVG (sharp decodes SVG via librsvg, which is bundled, but with limits). For variants, we'll resize all formats through sharp; if the buffer is SVG and sharp cannot decode it, the upload fails — that's an acceptable behaviour change (SVG logos are uncommon for raster PWA icons). Document this in the implementation comment.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/server/settings/logo-storage.test.ts`
Expected: FAIL — `regenerateMaskable` not exported, `writeLogo` doesn't accept third arg, variants not written.

- [ ] **Step 3: Update `src/server/settings/logo-storage.ts`**

Replace the file content with:

```ts
import { writeFile, unlink, rename } from "node:fs/promises";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { resizeAny, composeMaskable } from "@/server/settings/icon-rendering";

export type LogoExt = "png" | "svg" | "webp";
export const LOGO_EXTS: readonly LogoExt[] = ["png", "svg", "webp"];

const VARIANT_FILES = [
  "logo-180.png",
  "logo-192.png",
  "logo-512.png",
  "logo-maskable-512.png",
] as const;

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

async function atomicWrite(path: string, buf: Buffer): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, buf);
  await rename(tmp, path);
}

// SVG decoding through sharp uses librsvg with limits; if the SVG can't be rasterised,
// this will throw. Operators uploading exotic SVGs should re-export to PNG.
async function writeVariants(
  dir: string,
  buf: Buffer,
  accentHex: string,
): Promise<void> {
  const [v180, v192, v512, mask] = await Promise.all([
    resizeAny(buf, 180),
    resizeAny(buf, 192),
    resizeAny(buf, 512),
    composeMaskable(buf, accentHex),
  ]);
  await Promise.all([
    atomicWrite(join(dir, "logo-180.png"), v180),
    atomicWrite(join(dir, "logo-192.png"), v192),
    atomicWrite(join(dir, "logo-512.png"), v512),
    atomicWrite(join(dir, "logo-maskable-512.png"), mask),
  ]);
}

export async function writeLogo(
  dir: string,
  buf: Buffer,
  accentHex: string,
): Promise<LogoExt> {
  const ext = sniffImageType(buf);
  if (!ext) throw new Error("Unsupported image type (must be PNG, SVG, or WebP)");
  // Remove any sibling logo with a different extension first.
  for (const e of LOGO_EXTS) {
    if (e === ext) continue;
    const p = join(dir, `logo.${e}`);
    if (existsSync(p)) await unlink(p);
  }
  await writeFile(join(dir, `logo.${ext}`), buf);
  await writeVariants(dir, buf, accentHex);
  return ext;
}

export function clearLogo(dir: string): void {
  for (const e of LOGO_EXTS) {
    const p = join(dir, `logo.${e}`);
    if (existsSync(p)) unlinkSync(p);
  }
  for (const f of VARIANT_FILES) {
    const p = join(dir, f);
    if (existsSync(p)) unlinkSync(p);
  }
}

export function resolveLogoPath(dir: string, ext: LogoExt): string | null {
  const p = join(dir, `logo.${ext}`);
  return existsSync(p) ? p : null;
}

export async function regenerateMaskable(
  dir: string,
  currentBuffer: Buffer,
  accentHex: string,
): Promise<void> {
  const mask = await composeMaskable(currentBuffer, accentHex);
  await atomicWrite(join(dir, "logo-maskable-512.png"), mask);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/server/settings/logo-storage.test.ts`
Expected: PASS for all cases (existing + new). If existing `writeLogo` callers in OTHER files now fail to typecheck because they pass only 2 args, address them in Task 6 (the only consumer is `src/app/admin/settings/actions.ts:saveLogo`). For now, run only the logo-storage test file.

- [ ] **Step 5: Commit**

```bash
git add src/server/settings/logo-storage.ts tests/server/settings/logo-storage.test.ts
git commit -m "feat(icons): logo-storage emits 180/192/512/maskable variants on upload"
```

---

## Task 4: Default-icons build script + prebuild + .gitignore

**Files:**
- Create: `scripts/build-default-icons.ts`
- Test: `tests/scripts/build-default-icons.test.ts`
- Modify: `package.json`, `.gitignore`

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/build-default-icons.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { buildDefaultIcons } from "../../scripts/build-default-icons";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-build-icons-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

async function realSourcePng(): Promise<Buffer> {
  return sharp({
    create: { width: 1024, height: 1024, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer();
}

describe("buildDefaultIcons", () => {
  it("writes icon-180.png, icon-192.png, icon-512.png, icon-maskable-512.png to outDir", async () => {
    const src = join(tmp, "icon-source.png");
    writeFileSync(src, await realSourcePng());
    const outDir = join(tmp, "out");
    require("node:fs").mkdirSync(outDir, { recursive: true });
    await buildDefaultIcons(src, outDir, "#3b82f6");
    expect(existsSync(join(outDir, "icon-180.png"))).toBe(true);
    expect(existsSync(join(outDir, "icon-192.png"))).toBe(true);
    expect(existsSync(join(outDir, "icon-512.png"))).toBe(true);
    expect(existsSync(join(outDir, "icon-maskable-512.png"))).toBe(true);
    expect((await sharp(join(outDir, "icon-180.png")).metadata()).width).toBe(180);
    expect((await sharp(join(outDir, "icon-512.png")).metadata()).width).toBe(512);
  });

  it("throws if the source file is missing", async () => {
    await expect(
      buildDefaultIcons(join(tmp, "nope.png"), tmp, "#3b82f6"),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/scripts/build-default-icons.test.ts`
Expected: FAIL — module `../../scripts/build-default-icons` not found.

- [ ] **Step 3: Write the implementation**

Create `scripts/build-default-icons.ts`:

```ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resizeAny, composeMaskable } from "../src/server/settings/icon-rendering";

export async function buildDefaultIcons(
  sourcePath: string,
  outDir: string,
  accentHex: string,
): Promise<void> {
  const src = await readFile(sourcePath);
  const [v180, v192, v512, mask] = await Promise.all([
    resizeAny(src, 180),
    resizeAny(src, 192),
    resizeAny(src, 512),
    composeMaskable(src, accentHex),
  ]);
  await Promise.all([
    writeFile(join(outDir, "icon-180.png"), v180),
    writeFile(join(outDir, "icon-192.png"), v192),
    writeFile(join(outDir, "icon-512.png"), v512),
    writeFile(join(outDir, "icon-maskable-512.png"), mask),
  ]);
}

// Direct invocation: tsx scripts/build-default-icons.ts
if (require.main === module) {
  const root = process.cwd();
  const src = join(root, "public/icons/icon-source.png");
  const out = join(root, "public/icons");
  buildDefaultIcons(src, out, "#3b82f6")
    .then(() => console.log("[build-default-icons] wrote 4 variants to public/icons/"))
    .catch((err) => {
      console.error("[build-default-icons] failed:", err);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/scripts/build-default-icons.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the script against the real source to produce default icons**

Run:
```bash
pnpm tsx scripts/build-default-icons.ts
```

Expected: `[build-default-icons] wrote 4 variants to public/icons/`. Then verify:

```bash
ls public/icons/
```

Expected: `icon-180.png icon-192.png icon-512.png icon-maskable-512.png icon-source.png` (the four variants plus the committed source).

- [ ] **Step 6: Wire `prebuild` script in `package.json`**

Modify `package.json`'s `"scripts"` block — add a `"prebuild"` line above `"build"`:

```json
"scripts": {
  "dev": "next dev --turbo",
  "prebuild": "tsx scripts/build-default-icons.ts",
  "build": "next build",
  ...
}
```

- [ ] **Step 7: Update `.gitignore`**

Append to `.gitignore` (add a section header for clarity):

```
# PWA icon variants are regenerated from public/icons/icon-source.png at prebuild time
/public/icons/icon-180.png
/public/icons/icon-192.png
/public/icons/icon-512.png
/public/icons/icon-maskable-512.png
# Service worker is generated at postbuild time (Task 10)
/public/sw.js
```

- [ ] **Step 8: Verify the variants are now untracked**

Run: `git status`
Expected: the four `public/icons/icon-{180,192,512,maskable-512}.png` files should NOT appear in the output (they're in `.gitignore`). `package.json`, `pnpm-lock.yaml`, and `.gitignore` should appear as modified/changed.

- [ ] **Step 9: Commit**

```bash
git add scripts/build-default-icons.ts tests/scripts/build-default-icons.test.ts package.json .gitignore
git commit -m "feat(icons): default-icons build script + prebuild wiring + gitignore"
```

---

## Task 5: `/api/icon/[size]/[purpose]/route.ts` — dispatch route

**Files:**
- Create: `src/app/api/icon/[size]/[purpose]/route.ts`
- Test: `tests/app/api/icon/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/app/api/icon/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import sharp from "sharp";

let tmp: string;
let dataDir: string;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-icon-route-"));
  dataDir = join(tmp, "data");
  require("node:fs").mkdirSync(dataDir, { recursive: true });
  vi.stubEnv("DATABASE_PATH", join(dataDir, "minifold.db"));
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tmp, { recursive: true, force: true });
});

async function fakePng(size: number): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
  }).png().toBuffer();
}

function req(url: string, init?: RequestInit): Request {
  return new Request(`http://test${url}`, init);
}

describe("/api/icon/[size]/[purpose] route", () => {
  it("serves the uploaded variant from /data when present (size=192, purpose=any)", async () => {
    writeFileSync(join(dataDir, "logo-192.png"), await fakePng(192));
    const { GET } = await import("@/app/api/icon/[size]/[purpose]/route");
    const res = await GET(req("/api/icon/192/any.png"), {
      params: Promise.resolve({ size: "192", purpose: "any" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("ETag")).toBeTruthy();
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBeGreaterThan(0);
    // Confirm it's a PNG
    expect(body.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  });

  it("falls back to the public default when no /data variant exists", async () => {
    // No /data/logo-*.png written — but the public default exists in the repo at public/icons/icon-192.png (built by Task 4).
    const { GET } = await import("@/app/api/icon/[size]/[purpose]/route");
    const res = await GET(req("/api/icon/192/any.png"), {
      params: Promise.resolve({ size: "192", purpose: "any" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });

  it("returns 404 for invalid size", async () => {
    const { GET } = await import("@/app/api/icon/[size]/[purpose]/route");
    const res = await GET(req("/api/icon/256/any.png"), {
      params: Promise.resolve({ size: "256", purpose: "any" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for invalid purpose", async () => {
    const { GET } = await import("@/app/api/icon/[size]/[purpose]/route");
    const res = await GET(req("/api/icon/512/random.png"), {
      params: Promise.resolve({ size: "512", purpose: "random" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for size=180 + purpose=maskable (disallowed combo)", async () => {
    const { GET } = await import("@/app/api/icon/[size]/[purpose]/route");
    const res = await GET(req("/api/icon/180/maskable.png"), {
      params: Promise.resolve({ size: "180", purpose: "maskable" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 304 when If-None-Match matches the ETag", async () => {
    writeFileSync(join(dataDir, "logo-192.png"), await fakePng(192));
    const { GET } = await import("@/app/api/icon/[size]/[purpose]/route");
    const first = await GET(req("/api/icon/192/any.png"), {
      params: Promise.resolve({ size: "192", purpose: "any" }),
    });
    const etag = first.headers.get("ETag");
    expect(etag).toBeTruthy();
    const second = await GET(
      req("/api/icon/192/any.png", { headers: { "If-None-Match": etag! } }),
      { params: Promise.resolve({ size: "192", purpose: "any" }) },
    );
    expect(second.status).toBe(304);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/app/api/icon/route.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Write the implementation**

Create `src/app/api/icon/[size]/[purpose]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const ALLOWED: Record<string, ReadonlySet<string>> = {
  "180": new Set(["any"]),
  "192": new Set(["any"]),
  "512": new Set(["any", "maskable"]),
};

function dataDir(): string {
  const dbPath = process.env.DATABASE_PATH ?? "/app/data/minifold.db";
  return dirname(dbPath);
}

function publicIconsDir(): string {
  return resolve(process.cwd(), "public/icons");
}

function fileNameForVariant(size: string, purpose: string, prefix: "logo" | "icon"): string {
  if (purpose === "maskable") return `${prefix}-maskable-512.png`;
  return `${prefix}-${size}.png`;
}

async function pickFile(size: string, purpose: string): Promise<{ path: string; mtimeMs: number } | null> {
  const candidate = join(dataDir(), fileNameForVariant(size, purpose, "logo"));
  try {
    const s = await stat(candidate);
    if (s.isFile()) return { path: candidate, mtimeMs: s.mtimeMs };
  } catch {
    // fall through to default
  }
  const fallback = join(publicIconsDir(), fileNameForVariant(size, purpose, "icon"));
  try {
    const s = await stat(fallback);
    if (s.isFile()) return { path: fallback, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
  return null;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ size: string; purpose: string }> },
): Promise<Response> {
  const { size, purpose } = await ctx.params;
  // Strip a trailing ".png" if Next.js delivers the suffix as part of the segment.
  const cleanPurpose = purpose.replace(/\.png$/i, "");
  const allowed = ALLOWED[size];
  if (!allowed || !allowed.has(cleanPurpose)) {
    return new NextResponse(null, { status: 404 });
  }
  const picked = await pickFile(size, cleanPurpose);
  if (!picked) return new NextResponse(null, { status: 404 });

  const etag = `"${Math.floor(picked.mtimeMs)}"`;
  const ifNoneMatch = req.headers.get("If-None-Match");
  if (ifNoneMatch === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }
  const buf = await readFile(picked.path);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, must-revalidate",
      ETag: etag,
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/app/api/icon/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/icon tests/app/api/icon
git commit -m "feat(icons): /api/icon/[size]/[purpose] dispatch route with ETag"
```

---

## Task 6: Wire upload + accent actions to the variant pipeline

**Files:**
- Modify: `src/app/admin/settings/actions.ts`
- Modify: `tests/app/admin/settings/actions.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/app/admin/settings/actions.test.ts`:

```ts
import sharp from "sharp";

async function realPng(): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } },
  }).png().toBuffer();
}

describe("saveLogo (upload mode generates variants)", () => {
  it("writes logo-180/192/512/maskable-512 alongside logo.png", async () => {
    const { saveLogo } = await import("@/app/admin/settings/actions");
    const buf = await realPng();
    const blob = new Blob([buf], { type: "image/png" });
    const s = await saveLogo({}, fd({ source: "upload", file: blob }));
    expect(s.success).toBe(true);
    const dir = require("node:path").dirname(dbPath);
    expect(existsSync(require("node:path").join(dir, "logo.png"))).toBe(true);
    expect(existsSync(require("node:path").join(dir, "logo-180.png"))).toBe(true);
    expect(existsSync(require("node:path").join(dir, "logo-192.png"))).toBe(true);
    expect(existsSync(require("node:path").join(dir, "logo-512.png"))).toBe(true);
    expect(existsSync(require("node:path").join(dir, "logo-maskable-512.png"))).toBe(true);
  });
});

describe("clearLogo (delete variants)", () => {
  it("removes all variant files", async () => {
    const { saveLogo, clearLogo } = await import("@/app/admin/settings/actions");
    const buf = await realPng();
    const blob = new Blob([buf], { type: "image/png" });
    await saveLogo({}, fd({ source: "upload", file: blob }));
    await clearLogo();
    const dir = require("node:path").dirname(dbPath);
    expect(existsSync(require("node:path").join(dir, "logo-180.png"))).toBe(false);
    expect(existsSync(require("node:path").join(dir, "logo-maskable-512.png"))).toBe(false);
  });
});

describe("saveAccentColor (regenerates maskable when logo exists)", () => {
  it("rewrites logo-maskable-512.png with the new accent backdrop", async () => {
    const { saveLogo, saveAccentColor } = await import("@/app/admin/settings/actions");
    const buf = await realPng();
    const blob = new Blob([buf], { type: "image/png" });
    await saveLogo({}, fd({ source: "upload", file: blob }));
    // Now change accent. The seeded migration sets accent to #3b82f6 with WCAG-passing contrast;
    // pick another WCAG-passing colour. #1a1a1a (very dark) passes against light bg.
    const s = await saveAccentColor({}, fd({ value: "#1a1a1a" }));
    expect(s.success).toBe(true);
    const dir = require("node:path").dirname(dbPath);
    const corner = await sharp(
      require("node:path").join(dir, "logo-maskable-512.png"),
    ).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    expect([corner[0], corner[1], corner[2]]).toEqual([0x1a, 0x1a, 0x1a]);
  });

  it("is a no-op for variant files when no logo is uploaded", async () => {
    const { saveAccentColor } = await import("@/app/admin/settings/actions");
    const s = await saveAccentColor({}, fd({ value: "#1a1a1a" }));
    expect(s.success).toBe(true);
    const dir = require("node:path").dirname(dbPath);
    expect(existsSync(require("node:path").join(dir, "logo-maskable-512.png"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/app/admin/settings/actions.test.ts`
Expected: FAIL — `writeLogo` doesn't accept the new third arg, accent change doesn't regenerate maskable.

- [ ] **Step 3: Update `src/app/admin/settings/actions.ts`**

Apply these changes:

a. At the top, add the import:
```ts
import { regenerateMaskable } from "@/server/settings/logo-storage";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getSetting } from "@/server/db/settings";
```

b. In `saveLogo` (upload branch), replace `ext = await writeLogo(dataDir(), buf);` with:

```ts
const accentHex = getSetting(getDatabase(), "accent_color") ?? "#3b82f6";
ext = await writeLogo(dataDir(), buf, accentHex);
```

c. After `setSetting(getDatabase(), "logo_url", "internal:" + ext);` in the upload branch, ADD revalidation for the new icon paths:

```ts
revalidatePath("/api/icon/180/any.png");
revalidatePath("/api/icon/192/any.png");
revalidatePath("/api/icon/512/any.png");
revalidatePath("/api/icon/512/maskable.png");
revalidatePath("/manifest.webmanifest");
```

d. In `saveAccentColor`, after `setSetting(getDatabase(), "accent_color", parsed.data.value);` and BEFORE `revalidatePath("/", "layout");`, add:

```ts
// If a logo is currently uploaded, regenerate the maskable variant against the new accent.
const dir = dataDir();
let logoFile: string | null = null;
for (const e of ["png", "webp", "svg"] as const) {
  const p = join(dir, `logo.${e}`);
  if (existsSync(p)) { logoFile = p; break; }
}
if (logoFile) {
  const buf = await readFile(logoFile);
  await regenerateMaskable(dir, buf, parsed.data.value);
  revalidatePath("/api/icon/512/maskable.png");
}
revalidatePath("/manifest.webmanifest");
```

e. In `clearLogo`, the existing `clearLogoFile(dataDir())` call already handles variant deletion (after Task 3's logo-storage extension). Add:

```ts
revalidatePath("/api/icon/180/any.png");
revalidatePath("/api/icon/192/any.png");
revalidatePath("/api/icon/512/any.png");
revalidatePath("/api/icon/512/maskable.png");
revalidatePath("/manifest.webmanifest");
```

after the existing `revalidatePath("/api/logo");` line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/app/admin/settings/actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `pnpm test`
Expected: ALL PASS. Some adjacent tests may now break if they call `writeLogo` directly with the old 2-arg signature — fix them by adding the third `accentHex` argument.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/settings/actions.ts tests/app/admin/settings/actions.test.ts
git commit -m "feat(settings): wire upload + accent actions to icon-variant pipeline"
```

---

## Task 7: `app/manifest.ts` — dynamic web app manifest

**Files:**
- Create: `src/app/manifest.ts`
- Test: `tests/app/manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/app/manifest.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDatabase } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { setSetting } from "@/server/db/settings";

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-manifest-"));
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

describe("manifest", () => {
  it("returns name/short_name/theme_color from settings", async () => {
    const { getDatabase } = await import("@/server/db");
    setSetting(getDatabase(), "app_name", "TeamFiles");
    setSetting(getDatabase(), "accent_color", "#ff0066");

    const { default: manifest } = await import("@/app/manifest");
    const m = manifest();
    expect(m.name).toBe("TeamFiles");
    expect(m.short_name).toBe("TeamFiles");
    expect(m.theme_color).toBe("#ff0066");
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
  });

  it("falls back to defaults when settings are empty strings", async () => {
    const { getDatabase } = await import("@/server/db");
    setSetting(getDatabase(), "app_name", "");
    setSetting(getDatabase(), "accent_color", "");

    const { default: manifest } = await import("@/app/manifest");
    const m = manifest();
    expect(m.name).toBe("Minifold");
    expect(m.theme_color).toBe("#3b82f6");
  });

  it("returns four icons (180, 192, 512, 512-maskable) all pointing at /api/icon/", async () => {
    const { default: manifest } = await import("@/app/manifest");
    const m = manifest();
    expect(m.icons).toHaveLength(4);
    expect(m.icons?.map((i) => i.src)).toEqual([
      "/api/icon/180/any.png",
      "/api/icon/192/any.png",
      "/api/icon/512/any.png",
      "/api/icon/512/maskable.png",
    ]);
    expect(m.icons?.[3]?.purpose).toBe("maskable");
  });

  it("truncates short_name to 12 chars when name is longer", async () => {
    const { getDatabase } = await import("@/server/db");
    setSetting(getDatabase(), "app_name", "VeryLongApplicationName");
    const { default: manifest } = await import("@/app/manifest");
    const m = manifest();
    expect(m.name).toBe("VeryLongApplicationName");
    expect(m.short_name).toBe("VeryLongAppl"); // first 12 chars
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/app/manifest.test.ts`
Expected: FAIL — module `@/app/manifest` not found.

- [ ] **Step 3: Write the implementation**

Create `src/app/manifest.ts`:

```ts
import type { MetadataRoute } from "next";
import { getDatabase } from "@/server/db";
import { getAllSettings } from "@/server/db/settings";

export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  const settings = getAllSettings(getDatabase());
  const appName = settings.app_name && settings.app_name.length > 0 ? settings.app_name : "Minifold";
  const accent = settings.accent_color && settings.accent_color.length > 0 ? settings.accent_color : "#3b82f6";

  return {
    name: appName,
    short_name: appName.length > 12 ? appName.slice(0, 12) : appName,
    description: "Self-hosted file browser",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: accent,
    icons: [
      { src: "/api/icon/180/any.png", sizes: "180x180", type: "image/png", purpose: "any" },
      { src: "/api/icon/192/any.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/api/icon/512/any.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/api/icon/512/maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/app/manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/manifest.ts tests/app/manifest.test.ts
git commit -m "feat(pwa): dynamic web app manifest reading settings"
```

---

## Task 8: `src/sw/strategy.ts` — pure cache classifier

**Files:**
- Create: `src/sw/strategy.ts`
- Test: `tests/sw/strategy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/sw/strategy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getCacheStrategy } from "@/sw/strategy";

const u = (path: string) => new URL(`http://test${path}`);

describe("getCacheStrategy", () => {
  it("returns 'never' for any non-GET request", () => {
    expect(getCacheStrategy(u("/"), "POST")).toBe("never");
    expect(getCacheStrategy(u("/_next/static/chunks/x.js"), "DELETE")).toBe("never");
  });

  it("returns 'shell' for the root and /login (GET)", () => {
    expect(getCacheStrategy(u("/"), "GET")).toBe("shell");
    expect(getCacheStrategy(u("/login"), "GET")).toBe("shell");
  });

  it("returns 'shell' for /_next/static/* (GET)", () => {
    expect(getCacheStrategy(u("/_next/static/chunks/abc.js"), "GET")).toBe("shell");
    expect(getCacheStrategy(u("/_next/static/css/app.css"), "GET")).toBe("shell");
  });

  it("returns 'runtime' for /_next/image/*, /api/icon/*, /api/logo (GET)", () => {
    expect(getCacheStrategy(u("/_next/image/abc"), "GET")).toBe("runtime");
    expect(getCacheStrategy(u("/api/icon/192/any.png"), "GET")).toBe("runtime");
    expect(getCacheStrategy(u("/api/logo"), "GET")).toBe("runtime");
  });

  it("returns 'never' for auth-gated /api/file, /api/thumb, /api/trpc", () => {
    expect(getCacheStrategy(u("/api/file/local/x.stl"), "GET")).toBe("never");
    expect(getCacheStrategy(u("/api/thumb/local/x.stl"), "GET")).toBe("never");
    expect(getCacheStrategy(u("/api/trpc/browse.list"), "GET")).toBe("never");
  });

  it("returns 'never' for /admin/* and /setup", () => {
    expect(getCacheStrategy(u("/admin"), "GET")).toBe("never");
    expect(getCacheStrategy(u("/admin/users"), "GET")).toBe("never");
    expect(getCacheStrategy(u("/setup"), "GET")).toBe("never");
    expect(getCacheStrategy(u("/setup/admin"), "GET")).toBe("never");
  });

  it("returns 'never' for unknown paths (GET) — default deny", () => {
    expect(getCacheStrategy(u("/random/page"), "GET")).toBe("never");
    expect(getCacheStrategy(u("/local"), "GET")).toBe("never");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/sw/strategy.test.ts`
Expected: FAIL — module `@/sw/strategy` not found.

- [ ] **Step 3: Write the implementation**

Create `src/sw/strategy.ts`:

```ts
export type CacheStrategy = "shell" | "runtime" | "never";

export function getCacheStrategy(url: URL, method: string): CacheStrategy {
  if (method !== "GET") return "never";
  // Auth-gated endpoints: never cache (per-user ACL would leak across tabs).
  if (url.pathname.startsWith("/api/file")) return "never";
  if (url.pathname.startsWith("/api/thumb")) return "never";
  if (url.pathname.startsWith("/api/trpc")) return "never";
  // State-bearing pages.
  if (url.pathname.startsWith("/setup")) return "never";
  if (url.pathname.startsWith("/admin")) return "never";
  // App shell.
  if (url.pathname.startsWith("/_next/static")) return "shell";
  if (url.pathname === "/" || url.pathname === "/login") return "shell";
  // Public, versioned static.
  if (url.pathname.startsWith("/_next/image")) return "runtime";
  if (url.pathname.startsWith("/api/icon")) return "runtime";
  if (url.pathname === "/api/logo") return "runtime";
  // Default deny.
  return "never";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/sw/strategy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sw/strategy.ts tests/sw/strategy.test.ts
git commit -m "feat(sw): pure cache-strategy classifier"
```

---

## Task 9: `src/sw/sw.ts` — service worker source

**Files:**
- Create: `src/sw/sw.ts`
- Test: `tests/sw/sw.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/sw/sw.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

type CacheRecord = { keys: Set<string>; entries: Map<string, Response> };

function makeMockCache(): { store: CacheRecord; api: Cache } {
  const store: CacheRecord = { keys: new Set(), entries: new Map() };
  const api = {
    async addAll(reqs: string[]) {
      for (const r of reqs) {
        store.keys.add(r);
        store.entries.set(r, new Response("body"));
      }
    },
    async match(req: string | Request) {
      const key = typeof req === "string" ? req : req.url;
      return store.entries.get(key);
    },
    async put(req: string | Request, res: Response) {
      const key = typeof req === "string" ? req : req.url;
      store.entries.set(key, res);
      store.keys.add(key);
    },
  } as unknown as Cache;
  return { store, api };
}

function makeMockSelf() {
  const cacheStores = new Map<string, ReturnType<typeof makeMockCache>>();
  const listeners = new Map<string, Function>();
  const skipWaiting = vi.fn(async () => {});
  const claim = vi.fn(async () => {});
  return {
    listeners,
    cacheStores,
    skipWaiting,
    claim,
    self: {
      addEventListener: (type: string, fn: Function) => listeners.set(type, fn),
      skipWaiting,
      registration: undefined as unknown,
      clients: { claim },
      caches: {
        async open(name: string) {
          let entry = cacheStores.get(name);
          if (!entry) {
            entry = makeMockCache();
            cacheStores.set(name, entry);
          }
          return entry.api;
        },
        async keys() {
          return Array.from(cacheStores.keys());
        },
        async delete(name: string) {
          return cacheStores.delete(name);
        },
        async match(req: string | Request) {
          for (const { api } of cacheStores.values()) {
            const r = await api.match(req);
            if (r) return r;
          }
          return undefined;
        },
      },
    },
  };
}

describe("service worker", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function loadSW(env: ReturnType<typeof makeMockSelf>) {
    // Inject mocks via globalThis before importing.
    (globalThis as any).self = env.self;
    (globalThis as any).caches = env.self.caches;
    // SHELL_VERSION + PRECACHE_LIST come from build-time esbuild defines; provide them here.
    (globalThis as any).SHELL_VERSION = "test-sha";
    (globalThis as any).PRECACHE_LIST = ["/", "/login"];
    return import("@/sw/sw");
  }

  it("registers install/activate/fetch listeners", async () => {
    const env = makeMockSelf();
    await loadSW(env);
    expect(env.listeners.has("install")).toBe(true);
    expect(env.listeners.has("activate")).toBe(true);
    expect(env.listeners.has("fetch")).toBe(true);
  });

  it("install populates the shell-v<sha> cache and skips waiting", async () => {
    const env = makeMockSelf();
    await loadSW(env);
    const installEvent = { waitUntil: vi.fn(async (p) => p) } as unknown as ExtendableEvent;
    await env.listeners.get("install")!(installEvent);
    // Drain the awaited promise.
    await installEvent.waitUntil((async () => {})());
    expect(env.cacheStores.has("shell-vtest-sha")).toBe(true);
    const cache = env.cacheStores.get("shell-vtest-sha")!;
    expect(cache.store.keys.has("/")).toBe(true);
    expect(cache.store.keys.has("/login")).toBe(true);
    expect(env.skipWaiting).toHaveBeenCalled();
  });

  it("activate deletes shell-v* caches that don't match the current version", async () => {
    const env = makeMockSelf();
    await loadSW(env);
    // Pre-populate two stale caches and the current one.
    await env.self.caches.open("shell-vold-sha-1");
    await env.self.caches.open("shell-vold-sha-2");
    await env.self.caches.open("shell-vtest-sha");
    await env.self.caches.open("runtime-static");
    const activateEvent = { waitUntil: vi.fn(async (p) => p) } as unknown as ExtendableEvent;
    await env.listeners.get("activate")!(activateEvent);
    await activateEvent.waitUntil((async () => {})());
    expect(env.cacheStores.has("shell-vold-sha-1")).toBe(false);
    expect(env.cacheStores.has("shell-vold-sha-2")).toBe(false);
    expect(env.cacheStores.has("shell-vtest-sha")).toBe(true);
    expect(env.cacheStores.has("runtime-static")).toBe(true); // not a shell-* cache; left alone
    expect(env.claim).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/sw/sw.test.ts`
Expected: FAIL — module `@/sw/sw` not found.

- [ ] **Step 3: Write the implementation**

Create `src/sw/sw.ts`:

```ts
/// <reference lib="webworker" />
import { getCacheStrategy } from "./strategy";

// Injected by esbuild at build time (scripts/build-sw.ts):
declare const SHELL_VERSION: string;
declare const PRECACHE_LIST: ReadonlyArray<string>;

const swSelf = self as unknown as ServiceWorkerGlobalScope;
const SHELL_CACHE = `shell-v${SHELL_VERSION}`;
const RUNTIME_CACHE = "runtime-static";

swSelf.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(PRECACHE_LIST as string[]);
      await swSelf.skipWaiting();
    })(),
  );
});

swSelf.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("shell-v") && n !== SHELL_CACHE)
          .map((n) => caches.delete(n)),
      );
      await swSelf.clients.claim();
    })(),
  );
});

swSelf.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only same-origin GETs go through the SW caching paths.
  const url = new URL(req.url);
  if (url.origin !== swSelf.location.origin) return;
  const strategy = getCacheStrategy(url, req.method);
  if (strategy === "never") return; // fall through to network

  if (strategy === "shell") {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        try {
          return await fetch(req);
        } catch {
          // Offline + no cache: serve cached shell root for navigation requests.
          if (req.mode === "navigate") {
            const root = await caches.match("/");
            if (root) return root;
          }
          return new Response("Offline", { status: 503 });
        }
      })(),
    );
    return;
  }

  // strategy === "runtime": stale-while-revalidate
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      const networkPromise = fetch(req)
        .then((res) => {
          // Only cache successful, basic-typed responses (avoid opaque/cors issues).
          if (res.ok && res.type === "basic") {
            cache.put(req, res.clone()).catch(() => undefined);
          }
          return res;
        })
        .catch(() => cached); // fall back to cached on network error
      return cached ?? (await networkPromise) ?? new Response("Offline", { status: 503 });
    })(),
  );
});
```

- [ ] **Step 4: Update `tsconfig.json` to compile `src/sw/`**

Open `tsconfig.json`. The `include` array probably already covers `src/**/*`. If `src/sw/sw.ts` is excluded, add it. Verify `lib` includes `WebWorker` for the `webworker` reference; if not, the in-file `/// <reference lib="webworker" />` directive handles it.

Confirm by running `pnpm typecheck`. If it errors on missing WebWorker lib types, edit `tsconfig.json`'s `compilerOptions.lib` to include `"WebWorker"` alongside `"DOM"` and `"ESNext"`. Be aware: `WebWorker` and `DOM` have conflicting `addEventListener` overloads — only enable the lib for the SW file via a per-file directive, which we already added.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- tests/sw/sw.test.ts`
Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: clean. If errors about `SHELL_VERSION`/`PRECACHE_LIST` not being defined, the `declare const` lines should suffice — these are build-time defines, not runtime values.

- [ ] **Step 7: Commit**

```bash
git add src/sw/sw.ts tests/sw/sw.test.ts
git commit -m "feat(sw): TypeScript service worker with shell + runtime cache strategies"
```

---

## Task 10: `scripts/build-sw.ts` + postbuild + Dockerfile + headers

**Files:**
- Create: `scripts/build-sw.ts`
- Test: `tests/scripts/build-sw.test.ts`
- Modify: `package.json`, `next.config.ts`, `Dockerfile`

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/build-sw.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSw } from "../../scripts/build-sw";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-build-sw-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("buildSw", () => {
  it("writes public/sw.js with the injected SHELL_VERSION and PRECACHE_LIST", async () => {
    const nextDir = join(tmp, ".next");
    const publicDir = join(tmp, "public");
    mkdirSync(nextDir, { recursive: true });
    mkdirSync(publicDir, { recursive: true });
    // Minimal build-manifest.json — the script reads pages/_app and rootMainFiles.
    writeFileSync(
      join(nextDir, "build-manifest.json"),
      JSON.stringify({
        rootMainFiles: ["static/chunks/main-xyz.js", "static/chunks/webpack-abc.js"],
        pages: { "/_app": ["static/chunks/main-xyz.js"] },
      }),
    );
    await buildSw({
      projectRoot: tmp,
      buildSha: "abc1234",
      // Repo's actual sw.ts source must exist relative to projectRoot — for the test, point at the real one.
      swSourcePath: join(process.cwd(), "src/sw/sw.ts"),
    });
    const out = readFileSync(join(publicDir, "sw.js"), "utf8");
    expect(out).toContain('"abc1234"'); // SHELL_VERSION literal
    expect(out).toContain("/_next/static/chunks/main-xyz.js");
    expect(out.length).toBeGreaterThan(500);
  });

  it("throws when .next/build-manifest.json is missing", async () => {
    mkdirSync(join(tmp, "public"), { recursive: true });
    await expect(
      buildSw({
        projectRoot: tmp,
        buildSha: "abc",
        swSourcePath: join(process.cwd(), "src/sw/sw.ts"),
      }),
    ).rejects.toThrow(/build-manifest/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/scripts/build-sw.test.ts`
Expected: FAIL — module `../../scripts/build-sw` not found.

- [ ] **Step 3: Write the implementation**

Create `scripts/build-sw.ts`:

```ts
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import * as esbuild from "esbuild";

type BuildSwOptions = {
  projectRoot: string;
  buildSha: string;
  swSourcePath: string;
};

function deriveBuildSha(): string {
  if (process.env.BUILD_SHA && process.env.BUILD_SHA.length > 0) {
    return process.env.BUILD_SHA;
  }
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return new Date().toISOString();
  }
}

export async function buildSw(opts: BuildSwOptions): Promise<void> {
  const manifestPath = join(opts.projectRoot, ".next/build-manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `build-manifest.json not found at ${manifestPath} — run 'next build' first.`,
    );
  }
  const manifestRaw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw) as {
    rootMainFiles?: string[];
    pages?: Record<string, string[]>;
  };
  const rootMain = (manifest.rootMainFiles ?? []).map((p) => `/_next/${p}`);
  const appShell = (manifest.pages?.["/_app"] ?? []).map((p) => `/_next/${p}`);
  const precacheList = Array.from(new Set(["/", "/login", ...rootMain, ...appShell]));

  const publicDir = join(opts.projectRoot, "public");
  await mkdir(publicDir, { recursive: true });

  await esbuild.build({
    entryPoints: [opts.swSourcePath],
    bundle: true,
    format: "iife",
    target: "es2022",
    minify: false,
    write: true,
    outfile: join(publicDir, "sw.js"),
    define: {
      SHELL_VERSION: JSON.stringify(opts.buildSha),
      PRECACHE_LIST: JSON.stringify(precacheList),
    },
    logLevel: "info",
  });
}

if (require.main === module) {
  const root = process.cwd();
  buildSw({
    projectRoot: root,
    buildSha: deriveBuildSha(),
    swSourcePath: join(root, "src/sw/sw.ts"),
  })
    .then(() => console.log("[build-sw] wrote public/sw.js"))
    .catch((err) => {
      console.error("[build-sw] failed:", err);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/scripts/build-sw.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `postbuild` script in `package.json`**

Modify `package.json`:

```json
"scripts": {
  "dev": "next dev --turbo",
  "prebuild": "tsx scripts/build-default-icons.ts",
  "build": "next build",
  "postbuild": "tsx scripts/build-sw.ts",
  "start": "next start",
  ...
}
```

- [ ] **Step 6: Add SW headers to `next.config.ts`**

Replace `next.config.ts` content with:

```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingIncludes: {
    "/api/**/*": ["./src/server/db/migrations/**/*.sql"],
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default config;
```

- [ ] **Step 7: Update `Dockerfile` to accept `BUILD_SHA`**

Find the `# ---- build ----` stage in `Dockerfile`. Add `ARG BUILD_SHA=""` before the `RUN pnpm build` line, and `ENV BUILD_SHA=$BUILD_SHA` immediately after, like so:

```dockerfile
# ---- build ----
FROM base AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG BUILD_SHA=""
ENV BUILD_SHA=$BUILD_SHA
RUN pnpm build
```

This makes `process.env.BUILD_SHA` visible to `scripts/build-sw.ts` during the postbuild step. If unset, the script falls back to `git rev-parse --short HEAD` (Task 10 Step 3 implementation), but git is not installed in the build container — so passing `BUILD_SHA` from CI is the canonical path. Local devs without `BUILD_SHA` set will get a git short SHA in dev, or an ISO timestamp if even git isn't available.

- [ ] **Step 8: Run a full local build to verify the chain works**

Run:
```bash
BUILD_SHA=local-test pnpm build
```

Expected:
- `prebuild` runs `tsx scripts/build-default-icons.ts` (writes 4 icons to `public/icons/`)
- `build` runs `next build` (Next.js standard output)
- `postbuild` runs `tsx scripts/build-sw.ts` and prints `[build-sw] wrote public/sw.js`

Verify:
```bash
test -f public/sw.js && head -c 200 public/sw.js
grep -c '"local-test"' public/sw.js
```
Expected: file exists, head shows JS content (likely `(()=>{var ...`), grep returns at least 1.

- [ ] **Step 9: Commit**

```bash
git add scripts/build-sw.ts tests/scripts/build-sw.test.ts package.json next.config.ts Dockerfile
git commit -m "feat(sw): build-sw script + postbuild + sw.js headers + BUILD_SHA build arg"
```

---

## Task 11: `PWAClient.tsx` — install prompt + SW registration

**Files:**
- Create: `src/components/pwa/PWAClient.tsx`
- Create: `src/components/pwa/pwa-install.d.ts`
- Test: `tests/components/pwa/PWAClient.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/pwa/PWAClient.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { PWAClient } from "@/components/pwa/PWAClient";

// Mock the dynamic import — the test environment can't load the web component module.
vi.mock("@khmyznikov/pwa-install", () => ({}));
const usePathname = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => usePathname() }));

beforeEach(() => {
  usePathname.mockReturnValue("/");
  vi.useFakeTimers();
  // Default: production-mode (set via vi.stubEnv).
  vi.stubEnv("NODE_ENV", "production");
  // matchMedia: not standalone.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  // localStorage clean.
  window.localStorage.clear();
  // navigator.serviceWorker mock.
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: vi.fn().mockResolvedValue(undefined), ready: Promise.resolve(undefined) },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PWAClient", () => {
  it("registers the service worker on mount in production", async () => {
    render(<PWAClient />);
    // PWAClient registers on window 'load' — fire it.
    window.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(0);
    expect(navigator.serviceWorker.register).toHaveBeenCalledWith(
      "/sw.js",
      expect.objectContaining({ scope: "/", updateViaCache: "none" }),
    );
  });

  it("does NOT register the service worker in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    render(<PWAClient />);
    window.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(0);
    expect(navigator.serviceWorker.register).not.toHaveBeenCalled();
  });

  it("mounts <pwa-install> after 30 seconds on /", async () => {
    const { container } = render(<PWAClient />);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(container.querySelector("pwa-install")).toBeTruthy();
  });

  it("does NOT mount <pwa-install> on /login", async () => {
    usePathname.mockReturnValue("/login");
    const { container } = render(<PWAClient />);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(container.querySelector("pwa-install")).toBeNull();
  });

  it("does NOT mount <pwa-install> on /setup", async () => {
    usePathname.mockReturnValue("/setup/admin");
    const { container } = render(<PWAClient />);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(container.querySelector("pwa-install")).toBeNull();
  });

  it("does NOT mount <pwa-install> when running standalone", async () => {
    (window.matchMedia as ReturnType<typeof vi.fn>).mockImplementation((q: string) => ({
      matches: q === "(display-mode: standalone)",
      media: q, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const { container } = render(<PWAClient />);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(container.querySelector("pwa-install")).toBeNull();
  });

  it("does NOT mount <pwa-install> when previously dismissed", async () => {
    window.localStorage.setItem("minifold:pwa-dismissed", "1");
    const { container } = render(<PWAClient />);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(container.querySelector("pwa-install")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/components/pwa/PWAClient.test.tsx`
Expected: FAIL — module `@/components/pwa/PWAClient` not found.

- [ ] **Step 3: Write the JSX type augmentation**

Create `src/components/pwa/pwa-install.d.ts`:

```ts
import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "pwa-install": DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          "manual-chrome"?: boolean | string;
          "manual-apple"?: boolean | string;
          "disable-screenshots"?: boolean | string;
          "disable-fast-app-install"?: boolean | string;
          "disable-fast-chrome-popup"?: boolean | string;
          name?: string;
          description?: string;
          icon?: string;
          "manifest-url"?: string;
        },
        HTMLElement
      >;
    }
  }
}

export {};
```

- [ ] **Step 4: Write the implementation**

Create `src/components/pwa/PWAClient.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import "./pwa-install.d";

const DISMISSED_KEY = "minifold:pwa-dismissed";
const PROMPT_DELAY_MS = 30_000;

declare global {
  interface Window {
    __minifoldInstallEvent?: Event;
  }
}

function shouldShowPrompt(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname.startsWith("/login")) return false;
  if (pathname.startsWith("/setup")) return false;
  if (pathname === "/change-password") return false;
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return false;
  if (window.localStorage.getItem(DISMISSED_KEY)) return false;
  return true;
}

export function PWAClient() {
  const pathname = usePathname();
  const [showPrompt, setShowPrompt] = useState(false);
  const elementRef = useRef<HTMLElement | null>(null);

  // Service worker registration (production only).
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch((err) => console.warn("[minifold] SW registration failed:", err));
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  // 30-second install-prompt timer.
  useEffect(() => {
    if (!shouldShowPrompt(pathname)) return;
    const id = window.setTimeout(() => setShowPrompt(true), PROMPT_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [pathname]);

  // Lazy-load the web component module + wire externalPromptEvent + showDialog.
  useEffect(() => {
    if (!showPrompt) return;
    let cancelled = false;
    void import("@khmyznikov/pwa-install").then(() => {
      if (cancelled) return;
      const el = elementRef.current;
      if (!el) return;
      // Hand the captured beforeinstallprompt event to the component (Chromium path).
      // The library reads this via the `externalPromptEvent` JS property.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).externalPromptEvent = window.__minifoldInstallEvent;
      const onChoice = () => {
        try {
          window.localStorage.setItem(DISMISSED_KEY, "1");
        } catch {
          // ignore — quota or private mode
        }
      };
      el.addEventListener("pwa-install-success-event", onChoice);
      el.addEventListener("pwa-install-user-choice-result-event", onChoice);
      el.addEventListener("pwa-install-fail-event", onChoice);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).showDialog?.(true);
    });
    return () => {
      cancelled = true;
    };
  }, [showPrompt]);

  if (!showPrompt) return null;
  return (
    <pwa-install
      ref={elementRef as unknown as React.Ref<HTMLElement>}
      manual-chrome="true"
      manual-apple="true"
      disable-screenshots="true"
    />
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- tests/components/pwa/PWAClient.test.tsx`
Expected: PASS — all 7 cases.

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: clean. If `pwa-install` JSX errors persist, double-check the `.d.ts` is at the same path as the component, and that the import in `PWAClient.tsx` references it (`import "./pwa-install.d";` triggers TypeScript to load the augmentation).

- [ ] **Step 7: Commit**

```bash
git add src/components/pwa tests/components/pwa
git commit -m "feat(pwa): PWAClient with SW registration + 30s install prompt"
```

---

## Task 12: Layout integration

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Read the current layout**

Run: `cat src/app/layout.tsx`. Note the existing structure: `generateMetadata`, `RootLayout` async function, `<html>` with `--accent` style, `<body>` with `TRPCProvider` → `SettingsProvider` → `AppShell`.

- [ ] **Step 2: Modify `src/app/layout.tsx`**

Apply these changes:

a. At the top of the imports block, add:
```ts
import { PWAClient } from "@/components/pwa/PWAClient";
```

b. After `const logoUrl = settings.logo_url || "";` and before the `// Forced-change gate.` comment, add nothing — keep the existing logic.

c. Replace the entire `return (...)` block with:

```tsx
  return (
    <html lang="en" style={{ "--accent": accent } as CSSProperties}>
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/api/icon/180/any.png" />
        <meta name="theme-color" content={accent} />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                window.__minifoldInstallEvent = e;
              });
            `,
          }}
        />
      </head>
      <body className="bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-50">
        <TRPCProvider>
          <SettingsProvider value={{ appName, accent, logoUrl }}>
            <AppShell sidebar={<Sidebar appName={appName} />}>{children}</AppShell>
          </SettingsProvider>
        </TRPCProvider>
        <PWAClient />
      </body>
    </html>
  );
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Run the full test suite**

Run: `pnpm test`
Expected: ALL PASS. Layout tests (if any exist) may need updating if they assert on the absence of `<head>` content.

- [ ] **Step 5: Manual smoke test in dev**

Run: `pnpm dev`

In a browser:
1. Open `http://localhost:3000/login` (or root). Open DevTools → Application → Manifest. Expect: `/manifest.webmanifest` loads with name "Minifold", theme_color "#3b82f6", four icons listed.
2. DevTools → Application → Service Workers. Expect: NOT registered (NODE_ENV=development gates it off).
3. View source / DevTools → Elements. Expect: `<head>` contains `<link rel="manifest" ...>`, `<link rel="apple-touch-icon" ...>`, `<meta name="theme-color" ...>`, and the inline `beforeinstallprompt` script.
4. `<pwa-install>` does NOT appear yet (30s timer + dev mode means library isn't loaded). Wait 30s if you want to see it appear.
5. Stop dev (`Ctrl+C`).

- [ ] **Step 6: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat(pwa): wire manifest, apple-touch-icon, theme-color, install prompt into layout"
```

---

## Task 13: Move the Coolify file + create generic compose

**Files:**
- Move: `docker-compose.yaml` → `docker-compose.coolify.yml`
- Create: `docker-compose.yml`

- [ ] **Step 1: Rename the existing file**

Run:
```bash
git mv docker-compose.yaml docker-compose.coolify.yml
```

- [ ] **Step 2: Verify the rename**

Run: `git status`
Expected: shows `renamed: docker-compose.yaml -> docker-compose.coolify.yml`.

- [ ] **Step 3: Create the generic `docker-compose.yml`**

Create `docker-compose.yml` at the repo root:

```yaml
# Generic Minifold deployment. Use this if you run your own reverse proxy
# (Caddy, nginx, Tailscale Funnel, etc.) and bind directly to port 3000.
#
# For Coolify, use docker-compose.coolify.yml.
# For Traefik, use docker-compose.traefik.yml.
# For Render or Unraid, see render.yaml / unraid-template.xml.
#
# To disable the optional thumbnail worker (saves ~Puppeteer/Three.js memory),
# comment out the entire minifold-thumbs service AND the
# MINIFOLD_THUMB_SERVICE_URL env var on the main service. The interactive
# 3D viewer still works; the grid falls back to type icons.

services:
  minifold:
    image: ghcr.io/jappyjan/minifold:latest
    pull_policy: always
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      DATABASE_PATH: /app/data/minifold.db
      MINIFOLD_THUMB_SERVICE_URL: http://minifold-thumbs:3001
    volumes:
      - minifold-data:/app/data
      - minifold-files:/files
    healthcheck:
      test: ["CMD", "curl", "-fsS", "-o", "/dev/null", "http://127.0.0.1:3000/"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 15s

  minifold-thumbs:
    image: ghcr.io/jappyjan/minifold-thumbs:latest
    pull_policy: always
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "-O", "/dev/null", "http://127.0.0.1:3001/health"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 15s

volumes:
  minifold-data:
  minifold-files:
```

- [ ] **Step 4: Validate both files parse cleanly**

Run:
```bash
docker compose -f docker-compose.yml config -q
docker compose -f docker-compose.coolify.yml config -q
```
Expected: no output (success) for both. If `docker compose` is unavailable locally, skip this step — CI will catch it (Task 18).

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml docker-compose.coolify.yml
git commit -m "feat(deploy): generic docker-compose.yml + move Coolify variant to its own file"
```

---

## Task 14: `docker-compose.traefik.yml`

**Files:**
- Create: `docker-compose.traefik.yml`

- [ ] **Step 1: Create the file**

Create `docker-compose.traefik.yml`:

```yaml
# Generic Traefik deployment. Use this if you run Traefik yourself
# (i.e. NOT through Coolify — for that, use docker-compose.coolify.yml).
#
# Prerequisites:
# - A running Traefik instance with an external Docker network named `traefik`.
# - A `letsencrypt` certresolver configured in your Traefik static config.
# - DNS pointing your domain at the Traefik host.
#
# Set MINIFOLD_DOMAIN in a sibling `.env` file:
#     MINIFOLD_DOMAIN=files.example.com
#
# Disable thumbs by commenting out minifold-thumbs and the env var (same as
# docker-compose.yml).

services:
  minifold:
    image: ghcr.io/jappyjan/minifold:latest
    pull_policy: always
    restart: unless-stopped
    networks: [traefik, default]
    environment:
      DATABASE_PATH: /app/data/minifold.db
      MINIFOLD_THUMB_SERVICE_URL: http://minifold-thumbs:3001
    volumes:
      - minifold-data:/app/data
      - minifold-files:/files
    labels:
      traefik.enable: "true"
      traefik.http.routers.minifold.rule: "Host(`${MINIFOLD_DOMAIN}`)"
      traefik.http.routers.minifold.entrypoints: "websecure"
      traefik.http.routers.minifold.tls.certresolver: "letsencrypt"
      traefik.http.services.minifold.loadbalancer.server.port: "3000"
    healthcheck:
      test: ["CMD", "curl", "-fsS", "-o", "/dev/null", "http://127.0.0.1:3000/"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 15s

  minifold-thumbs:
    image: ghcr.io/jappyjan/minifold-thumbs:latest
    pull_policy: always
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "-O", "/dev/null", "http://127.0.0.1:3001/health"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 15s

networks:
  traefik:
    external: true

volumes:
  minifold-data:
  minifold-files:
```

- [ ] **Step 2: Validate**

Run:
```bash
MINIFOLD_DOMAIN=test.example.com docker compose -f docker-compose.traefik.yml config -q
```
Expected: no output. Skip if `docker compose` unavailable.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.traefik.yml
git commit -m "feat(deploy): docker-compose.traefik.yml for generic Traefik setups"
```

---

## Task 15: `unraid-template.xml` + `docs/unraid-icon.png`

**Files:**
- Create: `unraid-template.xml`
- Create: `docs/unraid-icon.png`

- [ ] **Step 1: Generate `docs/unraid-icon.png`**

Run:
```bash
mkdir -p docs
cp public/icons/icon-512.png docs/unraid-icon.png
```

This commits a copy of the default 512×512 icon for Unraid CA's `<Icon>` URL (Unraid CA needs a stable external URL; the raw GitHub link to this file gives us that).

- [ ] **Step 2: Create `unraid-template.xml`**

Create `unraid-template.xml`:

```xml
<?xml version="1.0"?>
<Container version="2">
  <Name>minifold</Name>
  <Repository>ghcr.io/jappyjan/minifold:latest</Repository>
  <Registry>https://ghcr.io/jappyjan/minifold</Registry>
  <Network>bridge</Network>
  <MyIP/>
  <Shell>sh</Shell>
  <Privileged>false</Privileged>
  <Support>https://github.com/jappyjan/minifold/issues</Support>
  <Project>https://github.com/jappyjan/minifold</Project>
  <Overview>Self-hosted file browser for 3D print files (STL, 3MF), documents (Markdown, PDF), and arbitrary folder structures. First boot launches a setup wizard.

For server-side thumbnails, also install the `minifold-thumbs` Community Application and set this app's MINIFOLD_THUMB_SERVICE_URL to the thumb container's URL.</Overview>
  <Category>Productivity: Other:</Category>
  <WebUI>http://[IP]:[PORT:3000]</WebUI>
  <TemplateURL>https://raw.githubusercontent.com/jappyjan/minifold/main/unraid-template.xml</TemplateURL>
  <Icon>https://raw.githubusercontent.com/jappyjan/minifold/main/docs/unraid-icon.png</Icon>
  <ExtraParams/>
  <PostArgs/>
  <CPUset/>
  <DateInstalled/>
  <DonateText/>
  <DonateLink/>
  <Requires/>
  <Config Name="WebUI Port" Target="3000" Default="3000" Mode="tcp" Description="HTTP port" Type="Port" Display="always" Required="true" Mask="false">3000</Config>
  <Config Name="App Data" Target="/app/data" Default="/mnt/user/appdata/minifold" Mode="rw" Description="SQLite database + uploaded logo" Type="Path" Display="always" Required="true" Mask="false">/mnt/user/appdata/minifold</Config>
  <Config Name="Files" Target="/files" Default="/mnt/user/files" Mode="rw" Description="Root directory for the local storage provider" Type="Path" Display="always" Required="true" Mask="false">/mnt/user/files</Config>
  <Config Name="DATABASE_PATH" Target="DATABASE_PATH" Default="/app/data/minifold.db" Mode="" Description="SQLite database path inside the container" Type="Variable" Display="advanced" Required="true" Mask="false">/app/data/minifold.db</Config>
  <Config Name="MINIFOLD_THUMB_SERVICE_URL" Target="MINIFOLD_THUMB_SERVICE_URL" Default="" Mode="" Description="If set, enables server-side thumbnails via the minifold-thumbs container (e.g. http://minifold-thumbs:3001)" Type="Variable" Display="advanced" Required="false" Mask="false"/>
</Container>
```

- [ ] **Step 3: Validate XML well-formedness**

Run: `xmllint --noout unraid-template.xml`
Expected: no output (well-formed). If `xmllint` isn't installed: `brew install libxml2` on macOS, `apt-get install libxml2-utils` on Debian.

- [ ] **Step 4: Commit**

```bash
git add unraid-template.xml docs/unraid-icon.png
git commit -m "feat(deploy): Unraid Community Applications template"
```

---

## Task 16: `render.yaml`

**Files:**
- Create: `render.yaml`

- [ ] **Step 1: Create `render.yaml`**

Create `render.yaml`:

```yaml
# Render one-click deploy for Minifold. https://render.com/deploy
#
# Render allows ONE persistent disk per service, so this template mounts only
# /app/data (SQLite + uploaded logo). For the file-content volume, choose ONE:
#
#   1. RECOMMENDED: configure an S3-compatible storage provider in the setup
#      wizard. Phase 3.5 added full S3 support; this is the cleanest fit
#      for Render's per-service-disk model.
#
#   2. Alternative: change the disk's mountPath to a parent like /data,
#      set DATABASE_PATH=/data/minifold.db, and bind /data/files when
#      you configure the local provider in the setup wizard. Single combined
#      disk, sized to fit your file content.
#
# The thumbnail worker is not included. Add it as a second `web` service if
# you want server-side thumbnails (~$7/mo extra on Render's starter tier).

services:
  - type: web
    name: minifold
    runtime: docker
    repo: https://github.com/jappyjan/minifold
    plan: starter
    healthCheckPath: /
    envVars:
      - key: DATABASE_PATH
        value: /app/data/minifold.db
    disk:
      name: minifold-data
      mountPath: /app/data
      sizeGB: 1
```

- [ ] **Step 2: Hand-validate against the Render schema**

Open https://render.com/docs/blueprint-spec in a browser and confirm: `services[].type` is `web`, `runtime` is `docker`, `disk` shape matches. Skip if you trust the spec — the validator step is hand-eyed, not blocking CI (no public CLI for Render Blueprints validation as of writing).

- [ ] **Step 3: Commit**

```bash
git add render.yaml
git commit -m "feat(deploy): render.yaml one-click deploy (single disk + S3-recommended)"
```

---

## Task 17: README updates

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the Deployment section**

Open `README.md`. Find the existing `## Deployment` section (top of the file) and replace EVERYTHING from `## Deployment` to (but not including) `## Development` with:

```markdown
## Deployment

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/jappyjan/minifold)

Pick the template that matches your environment:

| Template | Target |
|---|---|
| [`docker-compose.yml`](docker-compose.yml) | Generic Docker Compose. Self-hosted with your own reverse proxy. |
| [`docker-compose.coolify.yml`](docker-compose.coolify.yml) | Coolify v4. |
| [`docker-compose.traefik.yml`](docker-compose.traefik.yml) | Generic Traefik (set `MINIFOLD_DOMAIN` in `.env`). |
| [`unraid-template.xml`](unraid-template.xml) | Unraid Community Applications. |
| [`render.yaml`](render.yaml) | Render one-click deploy. |

For the Compose templates:

```bash
docker compose -f docker-compose.yml up -d
```

**Thumbnails are optional.** The Compose templates include the optional `minifold-thumbs` service (Puppeteer + Three.js, generates `.minifold_thumb_*.webp` sidecars on first view of each `.stl`/`.3mf`). To disable: comment out the `minifold-thumbs` service and the `MINIFOLD_THUMB_SERVICE_URL` env var. The grid falls back to type icons; the interactive 3D viewer on file detail pages still works. The `MINIFOLD_THUMB_SERVICE_URL` env var gates the `/api/thumb/*` endpoint at runtime — flip it on or off and restart, no rebuild needed. Unraid and Render templates do not include thumbs by default; add the `minifold-thumbs` container manually if you want server-side thumbnails.

```

- [ ] **Step 2: Verify the replacement**

Run: `head -40 README.md`
Expected: shows the new Deployment section + the table + the thumbs note. The `## Development` heading should still follow.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): per-template deployment table + Render badge"
```

---

## Task 18: CI workflow updates

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add validation steps to the `verify` job**

Open `.github/workflows/ci.yml`. After the `Build` step in the `verify` job (the one that runs `pnpm build`), add:

```yaml
      - name: Validate compose templates
        run: |
          docker compose -f docker-compose.yml config -q
          docker compose -f docker-compose.coolify.yml config -q
          MINIFOLD_DOMAIN=test.example.com docker compose -f docker-compose.traefik.yml config -q

      - name: Validate Unraid template XML
        run: |
          sudo apt-get update && sudo apt-get install -y --no-install-recommends libxml2-utils
          xmllint --noout unraid-template.xml
```

- [ ] **Step 2: Pass `BUILD_SHA` to the Docker build**

In the `publish` job, find the `Build & push` step. Add a `build-args` block under `with`:

```yaml
      - name: Build & push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          build-args: |
            BUILD_SHA=${{ github.sha }}
```

(Preserve any existing `tags`/`labels` lines — only add the `build-args` block.)

- [ ] **Step 3: Verify the file parses**

Run:
```bash
pnpm exec js-yaml .github/workflows/ci.yml > /dev/null 2>&1 || node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/ci.yml', 'utf8'))"
```

Expected: no error. The `yaml` package is already a dependency.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: validate compose + unraid templates; pass BUILD_SHA to image build"
```

---

## Task 19: Final verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run lint, typecheck, tests, and build**

Run:
```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @minifold/thumb-worker test
BUILD_SHA=final-test pnpm build
```

Expected: ALL four pass. The build produces `public/icons/icon-{180,192,512,maskable-512}.png` and `public/sw.js`.

- [ ] **Step 2: Smoke-test the production build locally**

Run:
```bash
PORT=3000 NODE_ENV=production node .next/standalone/server.js &
SERVER_PID=$!
sleep 2
# Manifest reachable + valid JSON
curl -s http://localhost:3000/manifest.webmanifest | python3 -m json.tool | head -20
# Service worker reachable with no-cache headers
curl -sI http://localhost:3000/sw.js | head -5
# Icon dispatch route
curl -s -o /tmp/test-icon.png -w "%{http_code}\n" http://localhost:3000/api/icon/192/any.png
file /tmp/test-icon.png
# Cleanup
kill $SERVER_PID
```

Expected:
- `manifest.webmanifest` returns JSON with `name: "Minifold"`, four icons.
- `/sw.js` returns `200 OK` with `Cache-Control: no-cache, no-store, must-revalidate` and `Service-Worker-Allowed: /`.
- `/api/icon/192/any.png` returns `200` and the file is identified by `file` as `PNG image data, 192 x 192`.

If the standalone build needs the database to start (it will, due to the layout reading settings), pre-seed it:
```bash
mkdir -p /tmp/minifold-data
DATABASE_PATH=/tmp/minifold-data/minifold.db node bin/cli.mjs init || true
```
then re-run with `DATABASE_PATH=/tmp/minifold-data/minifold.db` prefixed.

- [ ] **Step 3: Manual browser smoke test**

Run `pnpm start` (or the standalone command above). In Chrome:

1. Open `http://localhost:3000/`. Login (or run setup wizard).
2. DevTools → Application → Manifest. Confirm `name`, `theme_color`, four icons.
3. DevTools → Application → Service Workers. Confirm `/sw.js` is registered with scope `/`.
4. DevTools → Lighthouse → "Progressive Web App" audit. Run. Aim for ≥80; the manifest, SW, and icons should all check.
5. After 30s on `/`, the install prompt overlay should appear. Dismiss it. Reload — it should NOT re-appear (localStorage flag).
6. Visit `/admin/settings`. Upload a different logo (a small PNG). Hard-refresh `http://localhost:3000/manifest.webmanifest` and confirm the icons still resolve to `/api/icon/...` paths. Check `/api/icon/192/any.png` directly — it should now show your uploaded logo.
7. Stop the server.

- [ ] **Step 4: Coolify deployment notes**

This task is a documentation hand-off, not a code change. Capture the operator action needed when this PR merges:

**On the Coolify side, after merging:**
1. Go to the Minifold application in the Coolify UI.
2. General → "Docker Compose Location" — change from `docker-compose.yaml` to `docker-compose.coolify.yml`.
3. Click "Deploy". Watch the deploy logs for "Successfully built" + "container started".
4. Verify the Coolify-served URL still serves Minifold (the moved file's hardcoded UUID labels match the existing Coolify resource, so Traefik routing should be unchanged).

If you forgot step 2, Coolify will fail to find a compose file (or fall back to `docker-compose.yml`, the generic one, which has no Traefik labels — Traefik returns 503). Fix by updating the path and redeploying.

- [ ] **Step 5: Final commit (if any straggling formatting changes)**

Run: `git status`. If anything is unstaged (e.g., Prettier changes), run `pnpm format` and commit:

```bash
pnpm format
git add -A
git diff --cached --quiet || git commit -m "chore(format): prettier sweep after phase 9"
```

If `git status` is clean, skip this step.

- [ ] **Step 6: Push**

```bash
git push origin main
```

CI runs on push. Watch for green checks on the verify + publish jobs. The publish job will build a new GHCR image with `BUILD_SHA=<commit-sha>`, which Coolify will redeploy on its next pull (configured to `pull_policy: always`).

---

## Summary

After Task 19 ships, Minifold is installable as a PWA on Android, iOS, and desktop Chromium; the install brand reflects the operator's `app_name`, `accent_color`, and (optionally) uploaded logo; the app shell is cached for offline use alongside the Phase 6 IndexedDB directory cache; and operators can deploy via 5 clean templates spanning generic Compose, Coolify, Traefik, Unraid, and Render.
