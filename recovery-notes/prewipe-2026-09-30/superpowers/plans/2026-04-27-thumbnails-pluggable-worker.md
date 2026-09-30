# Phase 5.5: Pluggable Thumbnail Worker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Make 3D model thumbnails an opt-in feature delivered by a separate, optional Docker container. The main `minifold` image stays slim (no Chromium); deployments that want server-side thumbnails opt in via a `docker-compose.yml` that adds a `minifold-thumbs` container and sets `MINIFOLD_THUMB_SERVICE_URL` on the main app.

**Architecture:**
- New pnpm workspace package `thumb-worker/` — Node HTTP service that POSTs accept STL/3MF bytes and returns rendered WebP thumbnails. Implementation: Puppeteer + Three.js running in headless Chromium with `p-queue` (concurrency 2).
- Main app sees `MINIFOLD_THUMB_SERVICE_URL` env. If set: serves thumbs via `/api/thumb/[provider]/[...path]` with sidecar caching (`.minifold_thumb_<filename>.webp` written via the `StorageProvider`). If unset: thumbnails disabled — entry cards keep the type-icon look.
- `EntryCard` lazy-loads thumbs via `IntersectionObserver` so a directory with hundreds of files only requests the visible ones.
- CI builds two images on `main` push: `ghcr.io/jappyjan/minifold` (unchanged), `ghcr.io/jappyjan/minifold-thumbs` (new).
- Two example deployment files: minimal single-container compose (thumbs disabled) and full compose with both services.

**Tech Stack:** Node 22, native `node:http` (no Express), Puppeteer with `puppeteer-core` + system Chromium, Three.js + STLLoader + 3MFLoader, p-queue, vitest.

---

## Pragmatic decisions (already made — do not revisit)

- **Initial format support:** STL and 3MF only. STEP/OBJ/GCODE/F3D can be added later.
- **File transfer:** the main app reads the source file from its `StorageProvider`, POSTs the raw bytes to the worker (`Content-Type: application/octet-stream` with a `?format=stl|3mf` query param). No signed URLs, no shared volumes.
- **Thumbnail:** 256×256 WebP, transparent background, isometric camera with auto-fit framing (re-use the auto-fit code from the client-side ModelViewer).
- **Sidecar location:** alongside the source file, named `.minifold_thumb_<filename>.webp` (matches design spec §6 and `isHiddenEntry`).
- **No persistent state in worker:** worker is stateless; main app handles caching via `StorageProvider`.
- **HTTP timeout:** main app waits up to 30s for a worker render before falling back to the type icon.
- **Concurrency:** worker p-queue concurrency 2 (configurable via `THUMB_WORKER_CONCURRENCY`).
- **Auth between containers:** none (compose-internal network only). Document that the worker must NOT be exposed publicly.
- **Repo layout:** monorepo via existing pnpm workspace; new package at `thumb-worker/`.
- **Tests:** worker has its own vitest config; main app's vitest run is unchanged.
- **CI:** extend existing workflow to build a second image when `thumb-worker/` files change OR on every main push (simpler — just always build both).

---

## File Structure

**Create:**
- `thumb-worker/package.json` — name, deps, scripts.
- `thumb-worker/tsconfig.json`
- `thumb-worker/vitest.config.ts`
- `thumb-worker/src/server.ts` — HTTP server.
- `thumb-worker/src/render.ts` — Puppeteer renderer (loads `renderer.html` page).
- `thumb-worker/src/renderer.html` — the headless page that runs Three.js.
- `thumb-worker/src/queue.ts` — p-queue wrapper.
- `thumb-worker/src/index.ts` — entrypoint that starts the server.
- `thumb-worker/Dockerfile`
- `thumb-worker/tests/server.test.ts`
- `thumb-worker/tests/queue.test.ts`
- `thumb-worker/.dockerignore`
- `src/app/api/thumb/[provider]/[...path]/route.ts` — main app endpoint.
- `src/server/thumb/client.ts` — POSTs to worker and decodes the response.
- `src/server/thumb/sidecar-name.ts` — `.minifold_thumb_<filename>.webp` naming.
- `src/server/thumb/config.ts` — reads `MINIFOLD_THUMB_SERVICE_URL`, exposes `isThumbnailServiceEnabled()`.
- `tests/app/api/thumb.test.ts`
- `tests/server/thumb/client.test.ts`
- `tests/server/thumb/sidecar-name.test.ts`
- `tests/server/thumb/config.test.ts`
- `docker-compose.example.yml` — full deployment with worker.
- `docker-compose.minimal.yml` — single-container example.
- `tests/components/browse/EntryCard.test.tsx` — extend (already exists).

**Modify:**
- `pnpm-workspace.yaml` — declare the new package.
- `package.json` — root scripts unchanged; thumb-worker is a separate package with its own deps.
- `src/components/browse/EntryCard.tsx` — when entry kind is `stl` or `3mf` AND thumbnail service is configured, render an `<img>` with IntersectionObserver lazy-loading; fallback to icon on error.
- `src/server/browse/file-kind.ts` — no change needed (we already recognize stl + 3mf).
- `.github/workflows/ci.yml` — add a step to build & push `minifold-thumbs` image.
- `README.md` — short section on the two deployment options.

**Do not touch:**
- `src/components/browse/ModelViewer.tsx` (the interactive viewer). The worker has its own Three.js setup.
- `src/server/storage/*` — Sidecar writes go through the existing `StorageProvider.write` API.

---

## Task 1: Workspace skeleton + thumb-worker package init

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `thumb-worker/package.json`, `thumb-worker/tsconfig.json`, `thumb-worker/vitest.config.ts`, `thumb-worker/.dockerignore`
- Create: `thumb-worker/src/index.ts` (placeholder)
- Create: `thumb-worker/tests/smoke.test.ts`

- [ ] **Step 1: Update `pnpm-workspace.yaml`**

```yaml
packages:
  - "thumb-worker"

ignoredBuiltDependencies:
  - sharp
  - unrs-resolver
```

- [ ] **Step 2: Create `thumb-worker/package.json`**

```json
{
  "name": "@minifold/thumb-worker",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "p-queue": "^9.0.0",
    "puppeteer-core": "^24.30.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.20.0",
    "typescript": "^5.0.0",
    "vitest": "^4.1.5"
  }
}
```

(Run `pnpm install --frozen-lockfile=false` from repo root to lock the new deps. Commit lockfile.)

- [ ] **Step 3: Create `thumb-worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "noEmit": false,
    "lib": ["ES2022"]
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "tests", "node_modules"]
}
```

- [ ] **Step 4: Create `thumb-worker/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Create `thumb-worker/.dockerignore`**

```
node_modules
dist
tests
*.log
.DS_Store
```

- [ ] **Step 6: Placeholder `thumb-worker/src/index.ts`**

```typescript
console.log("minifold-thumb-worker starting");
```

- [ ] **Step 7: Smoke test `thumb-worker/tests/smoke.test.ts`**

```typescript
import { describe, it, expect } from "vitest";

describe("thumb-worker smoke", () => {
  it("sanity", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: Verify install + typecheck + test from root**

```bash
pnpm install
pnpm --filter @minifold/thumb-worker typecheck
pnpm --filter @minifold/thumb-worker test
```

Expected: clean install, typecheck passes, 1 smoke test passes.

Also verify the main app still works:

```bash
pnpm test
pnpm typecheck
```

Expected: 332 tests pass (no change), typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add pnpm-workspace.yaml thumb-worker package.json pnpm-lock.yaml
git commit -m "feat(thumbs): scaffold @minifold/thumb-worker workspace package"
```

---

## Task 2: HTTP server with `/health` + queue stub

**Files:**
- Create: `thumb-worker/src/server.ts`
- Create: `thumb-worker/src/queue.ts`
- Modify: `thumb-worker/src/index.ts`
- Test: `thumb-worker/tests/server.test.ts`, `thumb-worker/tests/queue.test.ts`

- [ ] **Step 1: Write tests for queue (`thumb-worker/tests/queue.test.ts`)**

```typescript
import { describe, it, expect, vi } from "vitest";
import { ThumbQueue } from "../src/queue";

describe("ThumbQueue", () => {
  it("limits concurrency", async () => {
    const q = new ThumbQueue({ concurrency: 2 });
    let inFlight = 0;
    let maxInFlight = 0;
    const task = () =>
      new Promise<void>((resolve) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(() => {
          inFlight--;
          resolve();
        }, 20);
      });
    await Promise.all(Array.from({ length: 5 }, () => q.add(task)));
    expect(maxInFlight).toBe(2);
  });

  it("returns the result of the task", async () => {
    const q = new ThumbQueue({ concurrency: 1 });
    const result = await q.add(async () => 42);
    expect(result).toBe(42);
  });

  it("propagates errors", async () => {
    const q = new ThumbQueue({ concurrency: 1 });
    await expect(q.add(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

```bash
pnpm --filter @minifold/thumb-worker test queue
```

Expected: import error (file missing).

- [ ] **Step 3: Implement `thumb-worker/src/queue.ts`**

```typescript
import PQueue from "p-queue";

type Options = { concurrency: number };

export class ThumbQueue {
  private readonly q: PQueue;

  constructor(opts: Options) {
    this.q = new PQueue({ concurrency: opts.concurrency });
  }

  add<T>(task: () => Promise<T>): Promise<T> {
    return this.q.add(task, { throwOnTimeout: false }) as Promise<T>;
  }
}
```

- [ ] **Step 4: Run tests, expect PASS (3 tests)**

- [ ] **Step 5: Write tests for server (`thumb-worker/tests/server.test.ts`)**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type ThumbServer } from "../src/server";

let server: ThumbServer;
let port: number;
const fakeRender = async (_buf: Buffer, _format: "stl" | "3mf") =>
  Buffer.from([0x00, 0x01, 0x02, 0x03]); // stub WebP bytes

beforeAll(async () => {
  server = createServer({ render: fakeRender, concurrency: 2 });
  port = await server.listen(0); // 0 = random free port
});

afterAll(async () => {
  await server.close();
});

describe("thumb-worker HTTP", () => {
  it("GET /health returns 200 ok", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("POST /render?format=stl returns the rendered bytes", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/render?format=stl`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array([1, 2, 3, 4, 5]),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf).toEqual(Buffer.from([0x00, 0x01, 0x02, 0x03]));
  });

  it("POST /render with missing format returns 400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/render`, {
      method: "POST",
      body: new Uint8Array([1, 2]),
    });
    expect(res.status).toBe(400);
  });

  it("POST /render with unknown format returns 400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/render?format=obj`, {
      method: "POST",
      body: new Uint8Array([1, 2]),
    });
    expect(res.status).toBe(400);
  });

  it("POST to unknown route returns 404", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nope`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 6: Run, expect FAIL**

- [ ] **Step 7: Implement `thumb-worker/src/server.ts`**

```typescript
import { createServer as createHttpServer, type Server } from "node:http";
import { ThumbQueue } from "./queue";

export type RenderFn = (
  data: Buffer,
  format: "stl" | "3mf",
) => Promise<Buffer>;

export type ThumbServer = {
  listen(port: number): Promise<number>; // resolves with the actual port
  close(): Promise<void>;
};

type Options = {
  render: RenderFn;
  concurrency: number;
};

const SUPPORTED_FORMATS = new Set(["stl", "3mf"]);

export function createServer(opts: Options): ThumbServer {
  const queue = new ThumbQueue({ concurrency: opts.concurrency });

  const http: Server = createHttpServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.method === "POST" && req.url?.startsWith("/render")) {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const format = url.searchParams.get("format");
      if (!format || !SUPPORTED_FORMATS.has(format)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "missing or unsupported format" }));
        return;
      }
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = Buffer.concat(chunks);
        const out = await queue.add(() => opts.render(body, format as "stl" | "3mf"));
        res.writeHead(200, { "content-type": "image/webp" });
        res.end(out);
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  return {
    listen(port: number): Promise<number> {
      return new Promise((resolve, reject) => {
        http.once("error", reject);
        http.listen(port, () => {
          const addr = http.address();
          if (typeof addr === "object" && addr) resolve(addr.port);
          else reject(new Error("listen returned no address"));
        });
      });
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        http.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
```

- [ ] **Step 8: Update `thumb-worker/src/index.ts` to start the server**

(Use a placeholder render that returns a fixed byte buffer for now; the real Puppeteer renderer lands in Task 3.)

```typescript
import { createServer } from "./server";

async function main() {
  const port = Number(process.env.PORT ?? 3001);
  const concurrency = Number(process.env.THUMB_WORKER_CONCURRENCY ?? 2);

  const server = createServer({
    concurrency,
    render: async () => {
      throw new Error("renderer not yet wired (Task 3)");
    },
  });

  const actual = await server.listen(port);
  console.log(`minifold-thumb-worker listening on :${actual}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 9: Run tests, expect PASS**

```bash
pnpm --filter @minifold/thumb-worker test
```

- [ ] **Step 10: Commit**

```bash
git add thumb-worker
git commit -m "feat(thumbs): worker HTTP server with health + render endpoints (queue + handlers)"
```

---

## Task 3: Puppeteer + Three.js renderer

**Files:**
- Create: `thumb-worker/src/render.ts`
- Create: `thumb-worker/src/renderer.html`
- Modify: `thumb-worker/src/index.ts`
- Test: `thumb-worker/tests/render.test.ts` (this test is gated — it requires a working Chromium; the test asserts the wiring is correct but skips the real render unless `PUPPETEER_EXECUTABLE_PATH` is set).

- [ ] **Step 1: Write `thumb-worker/src/renderer.html`**

A self-contained HTML file that:
1. Loads Three.js, STLLoader, 3MFLoader from a local copy bundled with the worker (or via CDN — see step 2).
2. Exposes a global `window.renderModel(bytes: Uint8Array, format: "stl"|"3mf"): Promise<string>` that returns a base64-encoded WebP data URL of a 256×256 isometric thumbnail.

For simplicity and reproducibility, bundle Three.js as a self-contained script. Use `three` from npm; the worker package depends on `three` (add to dependencies). Inline import via a `<script type="module">` tag with bare specifier resolution handled by Puppeteer's `addScriptTag` or by serving via a tiny in-memory file server during render.

**Simplified approach:** since we control the page entirely, use a tiny inline implementation:

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<canvas id="c" width="256" height="256"></canvas>
<script type="module">
  // Three.js is injected as a script tag by the renderer at runtime
  // (see render.ts: page.addScriptTag with the path to three.module.js).
  // Once injected, three is on window.THREE.
  // Loaders likewise are injected as separate <script> tags.

  function frameObject(camera, object, padding = 1.2) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    const distance = (maxDim * padding) / (2 * Math.tan(fov / 2));
    const dir = new THREE.Vector3(1, 1, 1).normalize();
    camera.position.copy(center).add(dir.multiplyScalar(distance));
    camera.lookAt(center);
    camera.near = distance / 100;
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
  }

  window.renderModel = async function (bytes, format) {
    const canvas = document.getElementById("c");
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(256, 256, false);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(1, 2, 1);
    scene.add(dir);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);

    let object;
    if (format === "stl") {
      const loader = new window.STLLoader();
      const geom = loader.parse(bytes.buffer);
      const mat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.7 });
      object = new THREE.Mesh(geom, mat);
    } else if (format === "3mf") {
      const loader = new window.ThreeMFLoader();
      object = loader.parse(bytes.buffer);
    } else {
      throw new Error("unsupported format: " + format);
    }

    scene.add(object);
    frameObject(camera, object, 1.3);

    renderer.render(scene, camera);

    const dataUrl = canvas.toDataURL("image/webp", 0.85);
    renderer.dispose();
    return dataUrl;
  };
</script>
</body>
</html>
```

- [ ] **Step 2: Add `three` to thumb-worker deps**

In `thumb-worker/package.json`, dependencies:

```json
{
  "dependencies": {
    "p-queue": "^9.0.0",
    "puppeteer-core": "^24.30.0",
    "three": "^0.184.0"
  }
}
```

Run `pnpm install` from the repo root.

- [ ] **Step 3: Implement `thumb-worker/src/render.ts`**

```typescript
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const HTML_PATH = resolve(__dirname, "renderer.html");
const HTML = readFileSync(HTML_PATH, "utf8");

const THREE_PATH = require.resolve("three/build/three.module.js", { paths: [__dirname] });
const STL_LOADER_PATH = require.resolve("three/examples/jsm/loaders/STLLoader.js", { paths: [__dirname] });
const TMF_LOADER_PATH = require.resolve("three/examples/jsm/loaders/3MFLoader.js", { paths: [__dirname] });

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ?? "/usr/bin/chromium",
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--use-gl=swiftshader",
        "--disable-gpu",
      ],
    });
  }
  return browserPromise;
}

export async function shutdownBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}

export async function renderThumbnail(
  data: Buffer,
  format: "stl" | "3mf",
): Promise<Buffer> {
  const browser = await getBrowser();
  const page: Page = await browser.newPage();
  try {
    await page.setContent(HTML, { waitUntil: "domcontentloaded" });

    // three.module.js exports `THREE` as a default + named exports. Inject as a UMD-like
    // global so the loaders (which expect `window.THREE`) can resolve.
    const threeSrc = readFileSync(THREE_PATH, "utf8");
    await page.addScriptTag({ content: `${threeSrc}\nwindow.THREE = THREE;` });

    // Loaders expect three's globals to already exist. They use named imports
    // from "three" — we shim those by exposing window.THREE.* below the Three.js
    // load. The bundled loader files in three/examples/jsm import from "three"
    // — we'll instead use the legacy global STLLoader from the examples.
    const stlSrc = readFileSync(STL_LOADER_PATH, "utf8");
    const tmfSrc = readFileSync(TMF_LOADER_PATH, "utf8");

    // Wrap each loader to expose itself on window.
    const wrapAsWindow = (src: string, exportName: string) =>
      `(function() { ${src.replace(/import \{[^}]+\} from ['"]three['"];?/g, "")} window.${exportName} = ${exportName}; })();`;

    await page.addScriptTag({ content: wrapAsWindow(stlSrc, "STLLoader") });
    await page.addScriptTag({ content: wrapAsWindow(tmfSrc, "ThreeMFLoader") });

    const dataUrl = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (bytes: number[], fmt: string) => (window as any).renderModel(new Uint8Array(bytes), fmt),
      Array.from(data),
      format,
    );

    const base64 = dataUrl.replace(/^data:image\/webp;base64,/, "");
    return Buffer.from(base64, "base64");
  } finally {
    await page.close();
  }
}
```

(The loader-shimming via `wrapAsWindow` is fragile. If the upstream Three.js examples ship as ESM that can't be trivially shimmed, fall back to using the global-script versions hosted at `three/build/three.min.js` plus the legacy loaders from `three/examples/js/loaders/STLLoader.js` if they still exist; otherwise re-implement minimal STL/3MF parsing inline. Document any deviation in the commit message.)

- [ ] **Step 4: Update `thumb-worker/src/index.ts`**

```typescript
import { createServer } from "./server";
import { renderThumbnail, shutdownBrowser } from "./render";

async function main() {
  const port = Number(process.env.PORT ?? 3001);
  const concurrency = Number(process.env.THUMB_WORKER_CONCURRENCY ?? 2);

  const server = createServer({
    concurrency,
    render: renderThumbnail,
  });

  const actual = await server.listen(port);
  console.log(`minifold-thumb-worker listening on :${actual}`);

  const shutdown = async () => {
    await server.close().catch(() => {});
    await shutdownBrowser().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Renderer test (skipped unless Chromium is available)**

`thumb-worker/tests/render.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";

const chromiumPath =
  process.env.PUPPETEER_EXECUTABLE_PATH ??
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : null);

const has = chromiumPath !== null;

describe.runIf(has)("renderThumbnail (live Chromium)", () => {
  it("returns a non-empty WebP buffer for a tiny binary STL", async () => {
    const { renderThumbnail } = await import("../src/render");
    // Minimal valid binary STL: 80-byte header, 4-byte uint32 triCount, 50 bytes per triangle.
    const header = Buffer.alloc(80);
    const triCount = Buffer.alloc(4);
    triCount.writeUInt32LE(1, 0);
    const tri = Buffer.alloc(50);
    // normal (12) + 3 vertices (36) + attribute byte count (2) = 50
    tri.writeFloatLE(0, 0); // nx
    tri.writeFloatLE(0, 4); // ny
    tri.writeFloatLE(1, 8); // nz
    // v1
    tri.writeFloatLE(0, 12);
    tri.writeFloatLE(0, 16);
    tri.writeFloatLE(0, 20);
    // v2
    tri.writeFloatLE(1, 24);
    tri.writeFloatLE(0, 28);
    tri.writeFloatLE(0, 32);
    // v3
    tri.writeFloatLE(0, 36);
    tri.writeFloatLE(1, 40);
    tri.writeFloatLE(0, 44);
    const buf = Buffer.concat([header, triCount, tri]);
    const out = await renderThumbnail(buf, "stl");
    expect(out.length).toBeGreaterThan(50); // some realistic minimum
    // WebP RIFF header: "RIFF" .... "WEBP"
    expect(out.subarray(0, 4).toString()).toBe("RIFF");
    expect(out.subarray(8, 12).toString()).toBe("WEBP");
  }, 30_000);
});
```

If the test environment lacks Chromium (e.g. CI), the test skips. We don't gate CI on it.

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @minifold/thumb-worker test
```

Expected: queue + server tests pass. Render test skips unless Chromium present.

- [ ] **Step 7: Commit**

```bash
git add thumb-worker
git commit -m "feat(thumbs): Puppeteer + Three.js headless renderer (256x256 WebP)"
```

---

## Task 4: thumb-worker Dockerfile

**Files:**
- Create: `thumb-worker/Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY thumb-worker/package.json thumb-worker/
RUN pnpm install --frozen-lockfile --filter @minifold/thumb-worker

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/thumb-worker/node_modules ./thumb-worker/node_modules
COPY thumb-worker thumb-worker
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm --filter @minifold/thumb-worker build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libc6 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libexpat1 \
      libfontconfig1 \
      libgbm1 \
      libgcc-s1 \
      libglib2.0-0 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libpangocairo-1.0-0 \
      libstdc++6 \
      libx11-6 \
      libx11-xcb1 \
      libxcb1 \
      libxcomposite1 \
      libxcursor1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxi6 \
      libxrandr2 \
      libxrender1 \
      libxss1 \
      libxtst6 \
      lsb-release \
      wget \
      xdg-utils \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs worker \
 && mkdir -p /app

COPY --from=build --chown=worker:nodejs /app/thumb-worker/dist ./dist
COPY --from=build --chown=worker:nodejs /app/thumb-worker/node_modules ./node_modules
COPY --from=build --chown=worker:nodejs /app/thumb-worker/src/renderer.html ./dist/renderer.html

USER worker
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD \
  wget --quiet --tries=1 --spider http://127.0.0.1:3001/health || exit 1

CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Verify image builds locally (optional, slow — only if Docker available)**

```bash
docker buildx build -f thumb-worker/Dockerfile -t minifold-thumbs:test .
```

Expected: builds successfully.

- [ ] **Step 3: Commit**

```bash
git add thumb-worker/Dockerfile
git commit -m "feat(thumbs): Dockerfile for minifold-thumbs worker (chromium + Node 22)"
```

---

## Task 5: Main app — thumb config + sidecar naming

**Files:**
- Create: `src/server/thumb/config.ts`
- Create: `src/server/thumb/sidecar-name.ts`
- Test: `tests/server/thumb/config.test.ts`, `tests/server/thumb/sidecar-name.test.ts`

- [ ] **Step 1: Write `tests/server/thumb/sidecar-name.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { thumbSidecarPath } from "@/server/thumb/sidecar-name";

describe("thumbSidecarPath", () => {
  it("places the sidecar next to the source with .minifold_thumb_ prefix and .webp suffix", () => {
    expect(thumbSidecarPath("prints/anchor.stl")).toBe("prints/.minifold_thumb_anchor.stl.webp");
  });

  it("works at the root", () => {
    expect(thumbSidecarPath("anchor.stl")).toBe(".minifold_thumb_anchor.stl.webp");
  });

  it("preserves nested paths", () => {
    expect(thumbSidecarPath("a/b/c/model.3mf")).toBe("a/b/c/.minifold_thumb_model.3mf.webp");
  });
});
```

- [ ] **Step 2: Implement `src/server/thumb/sidecar-name.ts`**

```typescript
export function thumbSidecarPath(originalPath: string): string {
  const lastSlash = originalPath.lastIndexOf("/");
  const dir = lastSlash >= 0 ? originalPath.slice(0, lastSlash) : "";
  const name = lastSlash >= 0 ? originalPath.slice(lastSlash + 1) : originalPath;
  const sidecar = `.minifold_thumb_${name}.webp`;
  return dir ? `${dir}/${sidecar}` : sidecar;
}
```

- [ ] **Step 3: Write `tests/server/thumb/config.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isThumbnailServiceEnabled, getThumbnailServiceUrl } from "@/server/thumb/config";

const ORIG = process.env.MINIFOLD_THUMB_SERVICE_URL;

beforeEach(() => {
  delete process.env.MINIFOLD_THUMB_SERVICE_URL;
});

afterEach(() => {
  if (ORIG) process.env.MINIFOLD_THUMB_SERVICE_URL = ORIG;
  else delete process.env.MINIFOLD_THUMB_SERVICE_URL;
});

describe("thumb config", () => {
  it("disabled when env var unset", () => {
    expect(isThumbnailServiceEnabled()).toBe(false);
    expect(getThumbnailServiceUrl()).toBeNull();
  });

  it("enabled when env var set", () => {
    process.env.MINIFOLD_THUMB_SERVICE_URL = "http://thumbs:3001";
    expect(isThumbnailServiceEnabled()).toBe(true);
    expect(getThumbnailServiceUrl()).toBe("http://thumbs:3001");
  });

  it("treats whitespace-only env as disabled", () => {
    process.env.MINIFOLD_THUMB_SERVICE_URL = "   ";
    expect(isThumbnailServiceEnabled()).toBe(false);
  });

  it("strips trailing slash", () => {
    process.env.MINIFOLD_THUMB_SERVICE_URL = "http://thumbs:3001/";
    expect(getThumbnailServiceUrl()).toBe("http://thumbs:3001");
  });
});
```

- [ ] **Step 4: Implement `src/server/thumb/config.ts`**

```typescript
export function getThumbnailServiceUrl(): string | null {
  const raw = process.env.MINIFOLD_THUMB_SERVICE_URL ?? "";
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed === "" ? null : trimmed;
}

export function isThumbnailServiceEnabled(): boolean {
  return getThumbnailServiceUrl() !== null;
}
```

- [ ] **Step 5: Run tests, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/server/thumb tests/server/thumb
git commit -m "feat(thumbs): main-app thumb config + sidecar naming"
```

---

## Task 6: Main app — thumb client (HTTP call to worker)

**Files:**
- Create: `src/server/thumb/client.ts`
- Test: `tests/server/thumb/client.test.ts`

- [ ] **Step 1: Write the test (`tests/server/thumb/client.test.ts`)**

Stub `fetch` via `vi.stubGlobal`. Test: success, non-200 response, timeout.

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchThumbnail, ThumbnailServiceError } from "@/server/thumb/client";

const realFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
});

describe("fetchThumbnail", () => {
  it("POSTs file bytes and returns the response Buffer on 200", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("http://thumbs:3001/render?format=stl");
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({ "content-type": "application/octet-stream" });
      const body = init.body as Uint8Array;
      expect(Array.from(body)).toEqual([1, 2, 3]);
      return new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
        status: 200,
        headers: { "content-type": "image/webp" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await fetchThumbnail({
      serviceUrl: "http://thumbs:3001",
      data: Buffer.from([1, 2, 3]),
      format: "stl",
      timeoutMs: 5_000,
    });
    expect(Array.from(out)).toEqual([0x52, 0x49, 0x46, 0x46]);
  });

  it("throws ThumbnailServiceError on non-200", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(
      fetchThumbnail({
        serviceUrl: "http://thumbs:3001",
        data: Buffer.from([0]),
        format: "stl",
        timeoutMs: 5_000,
      }),
    ).rejects.toBeInstanceOf(ThumbnailServiceError);
  });

  it("aborts and throws when timeout elapses", async () => {
    globalThis.fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;

    await expect(
      fetchThumbnail({
        serviceUrl: "http://thumbs:3001",
        data: Buffer.from([0]),
        format: "stl",
        timeoutMs: 50,
      }),
    ).rejects.toBeInstanceOf(ThumbnailServiceError);
  });
});
```

- [ ] **Step 2: Implement `src/server/thumb/client.ts`**

```typescript
export class ThumbnailServiceError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ThumbnailServiceError";
  }
}

type Args = {
  serviceUrl: string;
  data: Buffer;
  format: "stl" | "3mf";
  timeoutMs: number;
};

export async function fetchThumbnail({ serviceUrl, data, format, timeoutMs }: Args): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${serviceUrl}/render?format=${format}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array(data),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new ThumbnailServiceError(`render failed: ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf;
  } catch (err) {
    if (err instanceof ThumbnailServiceError) throw err;
    throw new ThumbnailServiceError("render request failed", err);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 3: Run tests, expect PASS (3 tests)**

- [ ] **Step 4: Commit**

```bash
git add src/server/thumb tests/server/thumb
git commit -m "feat(thumbs): main-app HTTP client to worker (timeout + error mapping)"
```

---

## Task 7: Main app — `/api/thumb/[provider]/[...path]` route

This is the heart of the integration: serves thumbnails, caches sidecars, falls back to 404 when service is disabled.

**Files:**
- Create: `src/app/api/thumb/[provider]/[...path]/route.ts`
- Test: `tests/app/api/thumb.test.ts`

Behavior:
- `GET /api/thumb/{slug}/{...path}` where path points to an `.stl` or `.3mf` file.
- Auth-gate: must be a signed-in user (use `getCurrentUser` like the file route does).
- Resolve provider via `findProviderBySlug`.
- Compute `sidecarPath = thumbSidecarPath(decodedPath)`.
- If `provider.exists(sidecarPath)`: stream sidecar with `Content-Type: image/webp` and a long `Cache-Control` header.
- Else: read source file (stream → Buffer), `fetchThumbnail(...)`, `provider.write(sidecarPath, buf)`, then stream the buffer in the response.
- If service disabled: return 404 (so the client can fall back to the icon).
- If service errors: return 502 (client falls back to icon).

- [ ] **Step 1: Write the test (`tests/app/api/thumb.test.ts`)**

Set up an in-memory test environment: tmpdir + `LocalStorageProvider` + a stubbed `fetchThumbnail` that returns fixed bytes. Test:

a. Service disabled → 404.
b. Service enabled, sidecar already exists → returns existing sidecar.
c. Service enabled, sidecar missing → calls fetchThumbnail, writes sidecar, returns the bytes.
d. Service enabled, fetchThumbnail throws → returns 502.
e. Provider not found → 404.
f. Path that's not stl/3mf → 400.

(Test scaffold structure mirrors the existing `tests/app/api/file/...` test; consult that file for patterns.)

Implementation specifics: import the `GET` handler from the route, build a `Request`, call it with the params, assert response status / body / headers.

- [ ] **Step 2: Implement the route**

```typescript
import { NextRequest } from "next/server";
import { findProviderBySlug } from "@/server/db/providers";
import { providerFromRow } from "@/server/storage/factory";
import { getDatabase } from "@/server/db";
import { getCurrentUser } from "@/server/auth/current-user";
import { decodePathSegments } from "@/server/browse/encode-path";
import { thumbSidecarPath } from "@/server/thumb/sidecar-name";
import { getThumbnailServiceUrl } from "@/server/thumb/config";
import { fetchThumbnail, ThumbnailServiceError } from "@/server/thumb/client";
import { NotFoundError, PathTraversalError } from "@/server/storage/types";

const SUPPORTED_EXT = new Set(["stl", "3mf"]);
const TIMEOUT_MS = 30_000;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string; path: string[] }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const { provider: slug, path: rawSegments = [] } = await params;
  const segments = decodePathSegments(rawSegments);
  if (!segments) return new Response("bad request", { status: 400 });
  const path = segments.join("/");

  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (!SUPPORTED_EXT.has(ext)) return new Response("unsupported", { status: 400 });

  const row = findProviderBySlug(getDatabase(), slug);
  if (!row) return new Response("not found", { status: 404 });
  const provider = providerFromRow(row);

  const serviceUrl = getThumbnailServiceUrl();
  if (!serviceUrl) return new Response("thumbnails disabled", { status: 404 });

  const sidecar = thumbSidecarPath(path);

  // 1) Cached sidecar?
  try {
    if (await provider.exists(sidecar)) {
      const stream = await provider.read(sidecar);
      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": "image/webp",
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    }
  } catch {
    // Fall through to regenerate.
  }

  // 2) Generate.
  let source: Buffer;
  try {
    const stream = await provider.read(path);
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    source = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof PathTraversalError) {
      return new Response("not found", { status: 404 });
    }
    throw err;
  }

  let thumb: Buffer;
  try {
    thumb = await fetchThumbnail({
      serviceUrl,
      data: source,
      format: ext as "stl" | "3mf",
      timeoutMs: TIMEOUT_MS,
    });
  } catch (err) {
    if (err instanceof ThumbnailServiceError) {
      return new Response("thumbnail service error", { status: 502 });
    }
    throw err;
  }

  // 3) Cache and return. Errors caching the sidecar shouldn't block the response.
  void provider.write(sidecar, thumb).catch(() => {});

  return new Response(new Uint8Array(thumb), {
    status: 200,
    headers: {
      "content-type": "image/webp",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
```

- [ ] **Step 3: Run tests, expect PASS**
- [ ] **Step 4: Commit**

```bash
git add src/app/api/thumb tests/app/api/thumb.test.ts
git commit -m "feat(thumbs): /api/thumb route with sidecar caching + 502 fallback"
```

---

## Task 8: EntryCard thumbnail with IntersectionObserver

**Files:**
- Modify: `src/components/browse/EntryCard.tsx`
- Modify: `tests/components/browse/EntryCard.test.tsx`

The card receives a new prop `thumbnailsEnabled: boolean`. When `true` AND the entry is a `stl` or `3mf` file, render an `<img>` with:
- `loading="lazy"` and a manually-managed IntersectionObserver to set `src` only on enter (avoids browsers prefetching).
- Falls back to the existing icon on `onError`.

The page passes `thumbnailsEnabled = isThumbnailServiceEnabled()` from the server side via the `FolderBrowser` props chain (or directly to `FolderGrid`/`EntryCard`). Choose the simplest path that doesn't bloat props on every component.

Pragmatic split: add a single `thumbnailsEnabled` prop to `FolderGrid`, plumb from `FolderBrowser` (which gets it from the page via a new prop too).

- [ ] **Step 1: Update tests** — render an entry with `thumbnailsEnabled={true}` and `entry.name = "anchor.stl"`. Assert that an `<img>` with the correct src exists. With `thumbnailsEnabled={false}`, assert that the icon (no img) renders.
- [ ] **Step 2: Modify `EntryCard.tsx`** — add the prop, branch the icon vs `<img>` rendering. Use `useEffect` + `IntersectionObserver` to set `src` only when in viewport (set initial `src=""` until then).
- [ ] **Step 3: Plumb the prop through `FolderGrid` and `FolderBrowser`.**
- [ ] **Step 4: Modify the page** to pass `thumbnailsEnabled={isThumbnailServiceEnabled()}`.
- [ ] **Step 5: Update FolderBrowser test** — add the new prop with a default of `false`.
- [ ] **Step 6: Run all tests + typecheck.**
- [ ] **Step 7: Commit**

```bash
git add src/components src/app tests/components
git commit -m "feat(thumbs): EntryCard lazy thumbnail via IntersectionObserver"
```

---

## Task 9: CI — build & push thumb-worker image

**Files:**
- Modify: `.github/workflows/ci.yml`

Add a third job that builds `thumb-worker/Dockerfile` and pushes `ghcr.io/jappyjan/minifold-thumbs` with the same tag scheme as the main image (sha + `latest` on main). Mirror the existing `publish` job's structure; just point Docker at `-f thumb-worker/Dockerfile` and the new image name.

- [ ] Add `publish-thumbs` job with `needs: verify`.
- [ ] Run `pnpm --filter @minifold/thumb-worker test` in the verify job too (so worker tests gate the build).
- [ ] Commit:

```bash
git add .github/workflows/ci.yml
git commit -m "ci: build and push minifold-thumbs image alongside the main app"
```

---

## Task 10: Deployment templates + README

**Files:**
- Create: `docker-compose.example.yml`
- Modify: `docker-compose.yml` (existing — keep as the single-container minimal version, or rename to `.minimal.yml`).
- Modify: `README.md` — short section.

- [ ] **Step 1: docker-compose.example.yml** — both services on a private network, main app sets `MINIFOLD_THUMB_SERVICE_URL=http://minifold-thumbs:3001`. Worker is internal-only (no published port).

```yaml
services:
  minifold:
    image: ghcr.io/jappyjan/minifold:latest
    restart: unless-stopped
    environment:
      MINIFOLD_THUMB_SERVICE_URL: http://minifold-thumbs:3001
      DATABASE_PATH: /data/minifold.db
    volumes:
      - minifold-data:/data
    ports:
      - "3000:3000"
    networks:
      - minifold

  minifold-thumbs:
    image: ghcr.io/jappyjan/minifold-thumbs:latest
    restart: unless-stopped
    networks:
      - minifold
    # No ports exposed: only reachable from the main app over the internal network.

volumes:
  minifold-data:

networks:
  minifold:
```

- [ ] **Step 2: README** — replace the deployment section (or add one) with a short "Two deployment options" — minimal vs full. Link to both compose files.
- [ ] **Step 3: Commit**

```bash
git add docker-compose.example.yml docker-compose.yml README.md
git commit -m "docs(thumbs): deployment templates for minimal vs full (with worker)"
```

---

## Task 11: Smoke verify

- [ ] `pnpm test` in repo root — all main-app tests still pass.
- [ ] `pnpm --filter @minifold/thumb-worker test` — worker tests pass.
- [ ] `pnpm typecheck` — clean.
- [ ] `pnpm build` — clean.
- [ ] `pnpm lint` — clean.
- [ ] Push, watch CI, deploy.

---

## Out of scope (deferred)

- STEP / OBJ / GCODE / F3D thumbnails — supports STL + 3MF only.
- Manual thumbnail invalidation when source files change — relies on TTL-less sidecar; users can delete `.minifold_thumb_*.webp` manually if needed.
- Auth between containers — assumes the worker is on a private network.
- Horizontal scaling of the worker — single instance, p-queue concurrency 2.
- Thumbnail generation queue persistence — in-memory, lost on worker restart.
