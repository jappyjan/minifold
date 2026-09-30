# 3D Viewer (STL + 3MF) — Design Spec

**Date:** 2026-04-26
**Status:** Approved
**Phase:** 5 (Phase 5.5 covers thumbnails separately)
**Summary:** An interactive in-browser 3D viewer for `.stl` and `.3mf` files on the file detail page. Replaces the current "Preview not available — use the Download button" placeholder. Client-side only — no server-side render, no thumbnails, no caching beyond what the browser does naturally. The thumbnail pipeline (per the parent spec §6) is deferred to Phase 5.5.

---

## 1. Scope

**In scope:**
- New client component `<ModelViewer>` rendered inline in the existing `FileDetail` left column when `fileKindOf(name)` is `"stl"` or `"3mf"`.
- Three.js viewer with orbit / zoom / pan, touch-optimised for mobile.
- Wireframe toggle and Reset View buttons.
- Auto-fit camera to the model's bounding box on load.
- Loading, error, and oversized-file states.

**Out of scope (for this phase):**
- Server-side thumbnail rendering (Phase 5.5 — Puppeteer + queue + dot-file caching).
- Lazy thumbnail `<img>` cards in the directory grid (Phase 5.5).
- Multi-object scene navigation, exploded views, measurements, animations.
- Server-side mesh decimation or LOD.
- File formats beyond STL and 3MF (STEP, OBJ, etc. — out of original spec scope).

---

## 2. Stack Choice

**Picked:** `three@latest` + `@react-three/fiber@^9` + `@react-three/drei@^10`, with `STLLoader` and `3MFLoader` from `three/examples/jsm/loaders/`.

**Alternatives evaluated and rejected:**
- `react-stl-viewer` — last release 2024-01, locked to R3F v8 (incompatible with React 19), no 3MF support. Also ~30 lines of trivial wrapper code we don't need.
- `@google/model-viewer` — alive and excellent for glTF/GLB, but doesn't read STL or 3MF.
- `online-3d-viewer` — actively maintained, supports STL + 3MF + many more, but the npm package is a vanilla-JS engine (`EmbeddedViewer`) we'd wrap in `useEffect` with no first-class types. Adopting it would shift complexity, not reduce it. **Held in reserve** as a fallback if `3MFLoader`'s color/material fidelity is inadequate in practice.
- `react-3d-model-viewer`, `react-stl-explorer`, etc. — abandoned, single-author, React 16/17 era.

R3F v9 + drei v10 are React 19 / Next.js 16 compatible per their published peer-deps (`react: ">=19 <19.3"` for R3F, `react: "^19"` for drei). Bundle weight ~250 KB gzipped, only loaded when a user opens an STL/3MF detail page (chunk-split via `next/dynamic` with `ssr: false`).

---

## 3. Component Shape

### `src/components/browse/ModelViewer.tsx` — `"use client"`

```tsx
type Props = {
  fileApi: string;     // "/api/file/{slug}/{encoded-path}"
  fileSize: number;    // entry.size from the page route
  kind: "stl" | "3mf";
  fileName: string;    // for the "File too large" / error message
};
```

Internal structure:
- `<Canvas>` from R3F at `h-[60vh] md:h-[70vh] w-full`, light-grey background light mode / dark-grey dark mode.
- `<PerspectiveCamera>` set up by drei `<Bounds fit clip observe>` so the camera auto-frames the loaded geometry.
- One `<directionalLight>` + ambient hemispheric fill so models aren't flat.
- `<OrbitControls>` from drei with `enablePan`, `enableZoom`, `enableRotate`, `makeDefault`. Touch defaults are correct out of the box (one-finger orbit, two-finger pinch + pan).
- A single `<mesh>` whose `geometry` is the loaded `BufferGeometry` (STL → one mesh; 3MF → group rendered via the loader's returned scene).
- `<MeshStandardMaterial color="#a3a3a3" wireframe={wireframe}>` (with the wireframe state held in `useState`).

### Toolbar (overlay, top-right of the canvas)

- **Wireframe** toggle button (icon: square ↔ filled).
- **Reset** view button (calls `controlsRef.current.reset()` from drei `OrbitControls`).

Plain HTML `<button>`s positioned `absolute top-2 right-2`, styled minimal (semi-transparent background). Hidden behind a tap-to-show on mobile? — no, keep them visible. Real estate is fine.

### States

| State | UI |
|---|---|
| **Loading** | A small "Loading model…" pill + spinner over the canvas backdrop. Triggered while the fetch + parse runs. |
| **Loaded** | Canvas + toolbar. |
| **Parse error** | Falls back to the existing "Preview not available" placeholder + a smaller "Could not parse this file" line. Download button still works (it lives in the right rail, untouched). |
| **Too large** | Same fallback layout; message reads "File is N MB — too large to preview in-browser. Download to view." |

### Size guard

A hard cap (`MAX_PREVIEW_BYTES = 200 * 1024 * 1024`) keyed on the `fileSize` prop. Default 200 MB; if `fileSize > cap`, render the "Too large" state and never fetch. Configurable later via settings, not now.

### Cleanup

R3F handles `BufferGeometry` disposal on unmount automatically when the geometry is rendered through `<primitive>` / `<mesh geometry={…}>` and React unmounts. No extra `useEffect` needed.

---

## 4. Data Flow

```
FileDetail (RSC)
  └── kind="stl" | "3mf"  →  ModelViewerLazy (next/dynamic, ssr:false)
                                └── ModelViewer ("use client")
                                       │  fetch(fileApi)
                                       │  → ArrayBuffer
                                       │  → loader.parse(buf)  // STLLoader → BufferGeometry; 3MFLoader → Group
                                       └── <Canvas>{geometry}</Canvas>
```

The viewer relies on the **existing `/api/file/{slug}/{path}` route** (Phase 4) for bytes — auth, path traversal, and content-length all already work. No new server endpoint.

---

## 5. Loader Specifics

- **STL:** binary or ASCII; `STLLoader.parse(buf)` returns a single `BufferGeometry`. Center it on its bounding-box centroid before rendering so `<Bounds>` framing is sensible. (`geometry.computeBoundingBox()` + `geometry.translate(-cx, -cy, -cz)`.)
- **3MF:** `3MFLoader.parse(buf)` returns a `THREE.Group` of one or more meshes with materials. Render the whole group; let drei `<Bounds>` handle framing. `fflate` (zip extraction) is already a transitive of three.

**3MF caveat:** three's stock `3MFLoader` has known weak spots around colour groups, build-platform metadata, and multi-component scenes. For real-world print files this is usually fine; if a user's 3MF file renders incorrectly in production, the escape hatch is to swap to `online-3d-viewer`'s engine for that format only — held in reserve, NOT done now.

---

## 6. Wire-up to Existing `FileDetail.tsx`

Existing `Viewer` switch in `src/components/browse/FileDetail.tsx`:

```tsx
if (kind === "md")    return <MdViewer …/>;
if (kind === "pdf")   return <iframe …/>;
if (kind === "image") return <img …/>;
return <PlaceholderPreviewNotAvailable/>;
```

Add a new branch above the placeholder:

```tsx
if (kind === "stl" || kind === "3mf") {
  return (
    <ModelViewerLazy
      fileApi={fileApi}
      fileSize={entry.size}
      kind={kind}
      fileName={entry.name}
    />
  );
}
```

`ModelViewerLazy` is `next/dynamic(() => import("./ModelViewer"), { ssr: false, loading: <SkeletonCanvas/> })`. The right rail (file info, download button, sibling description) is untouched.

---

## 7. Error Handling and Fallbacks

- **Network / fetch failure** → ErrorBoundary inside `ModelViewer`, falls back to placeholder + "Could not load this file" message.
- **Loader parse exception** → caught, same fallback, log to `console.error` for debugging.
- **WebGL not available** (very old browser, headless test, or hardware acceleration disabled) → R3F throws on Canvas mount; ErrorBoundary catches and renders the same fallback.
- **Aborted (user navigates away)** → no special handling needed; React unmount + AbortController on the `fetch`.

The fallback intentionally resembles the current Phase-4 placeholder so the UX degrades gracefully back to "Preview not available — use Download".

---

## 8. Testing Strategy

**Unit-testable:**
- `selectLoader(kind)` — pure function returning the right loader class. Tested.
- Size-guard threshold helper (`isTooLargeForPreview(size)`). Tested.
- Geometry-centering helper for STL. Tested with synthetic geometry.

**Not unit-testable (skipped):**
- The `<Canvas>` itself. happy-dom has no WebGL; mocking would test the mock, not the viewer. Real bugs surface only against a real browser. Skip — the integration test is the live deploy.

**Integration test:** open an STL file on the live deploy; confirm it renders, orbit works on desktop and on a phone, wireframe + reset buttons work. Document this as Task N in the implementation plan.

---

## 9. Performance & Bundle

- Three.js + R3F + drei + loaders: ~250 KB gzipped. Loaded only when a user opens an STL/3MF detail page (next/dynamic split). Fine for a self-hosted app.
- Memory: a 50 MB binary STL produces a `BufferGeometry` of roughly 3–5x the file size in RAM (vertex + normal + index buffers). The 200 MB hard cap keeps us inside reasonable browser limits on mid-range mobile.
- Frame rate: a centred mesh with one directional light is trivial for any device that can run R3F at all.

---

## 10. Migration / Rollout

- New deps: `three`, `@react-three/fiber`, `@react-three/drei`. All added in one task.
- No DB migration. No new routes. No env vars.
- Phase 4 grid badges ("STL", "3MF") stay until Phase 5.5 replaces them with thumbnail `<img>`s. That's intentional — the viewer is the visible win; the badges are tolerable.

---

## 11. Open Questions

None. The escape hatch for 3MF fidelity (`online-3d-viewer`) is documented above and explicitly deferred until a real failure case demands it.
