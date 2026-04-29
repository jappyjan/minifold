# Thumbnail Loading State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a skeleton-shimmer loading state for thumbnail-eligible cards from mount until the `/api/thumb` image has decoded, replacing today's blank-pixel-then-flash behavior.

**Architecture:** Extract the lazy-load + image-tracking state machine out of `EntryCard` into a new `Thumbnail` client component. `Thumbnail` owns intersection observer, image mount, load/error tracking, and skeleton rendering. `EntryCard` just decides whether a thumbnail is eligible and delegates.

**Tech Stack:** Next.js 16 App Router (client components), React 19, Tailwind CSS v4, Vitest + happy-dom + `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-04-30-thumbnail-loading-state-design.md`

---

## File Structure

- **New:** `src/components/browse/Thumbnail.tsx` — owns: lazy intersection, image mount, load/error tracking, skeleton, fallback. Single responsibility: "render a thumbnail with a loading state".
- **New:** `tests/components/browse/Thumbnail.test.tsx` — five focused tests for the state machine.
- **Modify:** `src/components/browse/EntryCard.tsx` — delete `useLazyThumb`, `TRANSPARENT_PIXEL`, `errored`/`loaded` state; delegate to `<Thumbnail>`. File shrinks meaningfully.
- **Modify:** `src/app/globals.css` — add `@keyframes shimmer`.
- **Modify:** `tests/components/browse/EntryCard.test.tsx` — update one test that asserts on the now-removed transparent pixel.

---

## Task 1: Add shimmer keyframe to globals.css

**Files:**
- Modify: `src/app/globals.css` (append after the existing `body` block)

- [ ] **Step 1: Append the keyframe**

Add this to the bottom of `src/app/globals.css`:

```css
@keyframes shimmer {
  100% { transform: translateX(100%); }
}
```

The animation is consumed via Tailwind's arbitrary `animate-[shimmer_1.4s_infinite]` syntax; no Tailwind config change needed.

- [ ] **Step 2: Verify CSS still parses**

Run: `pnpm build` (Next will compile the CSS as part of the build) — but for speed, skip the full build and just run typecheck which doesn't parse CSS. Visual verification will come at the end via the dev server.

Run: `pnpm typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(browse): add shimmer keyframe for thumbnail skeleton"
```

---

## Task 2: Thumbnail component — skeleton before intersection

We start TDD here. The first slice: when not yet intersected, render only a skeleton, no `<img>`.

**Files:**
- Create: `src/components/browse/Thumbnail.tsx`
- Create: `tests/components/browse/Thumbnail.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/browse/Thumbnail.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Thumbnail } from "@/components/browse/Thumbnail";

// Default stub: IntersectionObserver does NOT fire (so component stays in
// pre-intersection state). Individual tests override this when they want
// intersection to fire.
beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "";
      thresholds: number[] = [];
    },
  );
});

describe("Thumbnail", () => {
  it("renders a skeleton and no <img> before intersection", () => {
    render(
      <Thumbnail
        src="/api/thumb/nas/prints/anchor.stl"
        className="h-12 w-12 rounded object-contain"
        fallback={<div data-testid="fallback">FALLBACK</div>}
      />,
    );

    expect(screen.getByTestId("thumb-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fallback")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/components/browse/Thumbnail.test.tsx`
Expected: FAIL with "Cannot find module '@/components/browse/Thumbnail'" (component doesn't exist yet).

- [ ] **Step 3: Create the minimal Thumbnail component**

Create `src/components/browse/Thumbnail.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  src: string;
  alt?: string;
  className?: string;
  fallback: ReactNode;
};

export function Thumbnail({ src, alt = "", className, fallback }: Props) {
  const skeletonRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const el = skeletonRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            obs.disconnect();
            return;
          }
        }
      },
      { rootMargin: "100px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView]);

  return (
    <div className={`${className ?? ""} relative overflow-hidden`}>
      <div
        ref={skeletonRef}
        data-testid="thumb-skeleton"
        className="absolute inset-0 rounded bg-neutral-200 dark:bg-neutral-800"
        aria-hidden="true"
      >
        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent motion-safe:animate-[shimmer_1.4s_infinite] dark:via-white/10" />
      </div>
      {/* Hidden suppressors — referenced props so TS doesn't complain on unused vars in this slice. */}
      <span hidden>{src}{alt}{fallback ? null : null}</span>
    </div>
  );
}
```

Note: the `<span hidden>` is a temporary placeholder so TS/lint don't flag unused props before later slices wire them up. It will be removed in Task 3. We use `motion-safe:animate-...` (Tailwind built-in variant for `prefers-reduced-motion: no-preference`) instead of a manual media query — same effect, less CSS.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- tests/components/browse/Thumbnail.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/Thumbnail.tsx tests/components/browse/Thumbnail.test.tsx
git commit -m "feat(browse): Thumbnail component renders skeleton before intersection"
```

---

## Task 3: Mount the `<img>` after intersection

Next slice: when the IntersectionObserver fires, the `<img>` mounts with the correct `src`.

**Files:**
- Modify: `src/components/browse/Thumbnail.tsx`
- Modify: `tests/components/browse/Thumbnail.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `tests/components/browse/Thumbnail.test.tsx` inside the `describe("Thumbnail", () => { ... })` block:

```tsx
  it("mounts the <img> with the given src after intersection", () => {
    // Override default stub: this IO fires immediately on observe().
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        cb: (entries: { isIntersecting: boolean; target: Element }[]) => void;
        constructor(
          cb: (entries: { isIntersecting: boolean; target: Element }[]) => void,
        ) {
          this.cb = cb;
        }
        observe(el: Element) {
          this.cb([{ isIntersecting: true, target: el }]);
        }
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
        root = null;
        rootMargin = "";
        thresholds: number[] = [];
      },
    );

    render(
      <Thumbnail
        src="/api/thumb/nas/prints/anchor.stl"
        className="h-12 w-12 rounded object-contain"
        fallback={<div>fallback</div>}
      />,
    );

    const img = screen.getByAltText("");
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toBe("/api/thumb/nas/prints/anchor.stl");
    // Skeleton still present (image hasn't loaded yet)
    expect(screen.getByTestId("thumb-skeleton")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/components/browse/Thumbnail.test.tsx`
Expected: FAIL on the new test with "Unable to find an element with the alt text" (no `<img>` rendered yet).

- [ ] **Step 3: Update Thumbnail to mount the `<img>` on intersection**

Replace the entire body of `src/components/browse/Thumbnail.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  src: string;
  alt?: string;
  className?: string;
  fallback: ReactNode;
};

export function Thumbnail({ src, alt = "", className, fallback: _fallback }: Props) {
  const skeletonRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const el = skeletonRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            obs.disconnect();
            return;
          }
        }
      },
      { rootMargin: "100px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView]);

  return (
    <div className={`${className ?? ""} relative overflow-hidden`}>
      {inView && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="block h-full w-full object-contain"
        />
      )}
      <div
        ref={skeletonRef}
        data-testid="thumb-skeleton"
        className="absolute inset-0 rounded bg-neutral-200 dark:bg-neutral-800"
        aria-hidden="true"
      >
        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent motion-safe:animate-[shimmer_1.4s_infinite] dark:via-white/10" />
      </div>
    </div>
  );
}
```

The `<span hidden>` placeholder is gone. `fallback` is renamed to `_fallback` so unused-vars lint doesn't fire (it gets used in Task 5). Skeleton stays rendered on top of the img — overlay covers it until imgReady removes the skeleton in the next task.

- [ ] **Step 4: Run all Thumbnail tests**

Run: `pnpm test -- tests/components/browse/Thumbnail.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/Thumbnail.tsx tests/components/browse/Thumbnail.test.tsx
git commit -m "feat(browse): Thumbnail mounts <img> on intersection"
```

---

## Task 4: Remove skeleton when image loads

Slice: when `<img>`'s `onLoad` fires, the skeleton is removed from the DOM.

**Files:**
- Modify: `src/components/browse/Thumbnail.tsx`
- Modify: `tests/components/browse/Thumbnail.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to the `describe("Thumbnail", ...)` block in `tests/components/browse/Thumbnail.test.tsx`:

```tsx
  it("removes the skeleton when the image fires onLoad", () => {
    // Firing IO stub
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        cb: (entries: { isIntersecting: boolean; target: Element }[]) => void;
        constructor(
          cb: (entries: { isIntersecting: boolean; target: Element }[]) => void,
        ) {
          this.cb = cb;
        }
        observe(el: Element) {
          this.cb([{ isIntersecting: true, target: el }]);
        }
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
        root = null;
        rootMargin = "";
        thresholds: number[] = [];
      },
    );

    render(
      <Thumbnail
        src="/api/thumb/nas/prints/anchor.stl"
        className="h-12 w-12 rounded object-contain"
        fallback={<div>fallback</div>}
      />,
    );

    const img = screen.getByAltText("");
    expect(screen.getByTestId("thumb-skeleton")).toBeInTheDocument();

    fireEvent.load(img);

    expect(screen.queryByTestId("thumb-skeleton")).not.toBeInTheDocument();
    expect(img).toBeInTheDocument();
  });
```

Also update the imports at the top of the file to include `fireEvent`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/components/browse/Thumbnail.test.tsx`
Expected: FAIL on the new test — skeleton is still in DOM after `fireEvent.load`.

- [ ] **Step 3: Wire `onLoad` to remove the skeleton**

Replace `src/components/browse/Thumbnail.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  src: string;
  alt?: string;
  className?: string;
  fallback: ReactNode;
};

export function Thumbnail({ src, alt = "", className, fallback: _fallback }: Props) {
  const skeletonRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  const [imgReady, setImgReady] = useState(false);

  useEffect(() => {
    if (inView) return;
    const el = skeletonRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            obs.disconnect();
            return;
          }
        }
      },
      { rootMargin: "100px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView]);

  return (
    <div className={`${className ?? ""} relative overflow-hidden`}>
      {inView && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="block h-full w-full object-contain"
          onLoad={() => setImgReady(true)}
        />
      )}
      {!imgReady && (
        <div
          ref={skeletonRef}
          data-testid="thumb-skeleton"
          className="absolute inset-0 rounded bg-neutral-200 dark:bg-neutral-800"
          aria-hidden="true"
        >
          <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent motion-safe:animate-[shimmer_1.4s_infinite] dark:via-white/10" />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run all Thumbnail tests**

Run: `pnpm test -- tests/components/browse/Thumbnail.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/Thumbnail.tsx tests/components/browse/Thumbnail.test.tsx
git commit -m "feat(browse): Thumbnail removes skeleton when image loads"
```

---

## Task 5: Render fallback on image error

Slice: when `<img>`'s `onError` fires, the component renders the `fallback` prop and stops showing skeleton/img.

**Files:**
- Modify: `src/components/browse/Thumbnail.tsx`
- Modify: `tests/components/browse/Thumbnail.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to the `describe("Thumbnail", ...)` block:

```tsx
  it("renders the fallback when the image fires onError", () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        cb: (entries: { isIntersecting: boolean; target: Element }[]) => void;
        constructor(
          cb: (entries: { isIntersecting: boolean; target: Element }[]) => void,
        ) {
          this.cb = cb;
        }
        observe(el: Element) {
          this.cb([{ isIntersecting: true, target: el }]);
        }
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
        root = null;
        rootMargin = "";
        thresholds: number[] = [];
      },
    );

    render(
      <Thumbnail
        src="/api/thumb/nas/prints/anchor.stl"
        className="h-12 w-12 rounded object-contain"
        fallback={<div data-testid="fallback">FALLBACK</div>}
      />,
    );

    const img = screen.getByAltText("");
    fireEvent.error(img);

    expect(screen.getByTestId("fallback")).toBeInTheDocument();
    expect(screen.queryByAltText("")).not.toBeInTheDocument();
    expect(screen.queryByTestId("thumb-skeleton")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/components/browse/Thumbnail.test.tsx`
Expected: FAIL — fallback is not rendered after error.

- [ ] **Step 3: Wire `onError` to render fallback**

Replace `src/components/browse/Thumbnail.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  src: string;
  alt?: string;
  className?: string;
  fallback: ReactNode;
};

export function Thumbnail({ src, alt = "", className, fallback }: Props) {
  const skeletonRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  const [imgReady, setImgReady] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (inView) return;
    const el = skeletonRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            obs.disconnect();
            return;
          }
        }
      },
      { rootMargin: "100px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView]);

  if (errored) return <>{fallback}</>;

  return (
    <div className={`${className ?? ""} relative overflow-hidden`}>
      {inView && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="block h-full w-full object-contain"
          onLoad={() => setImgReady(true)}
          onError={() => setErrored(true)}
        />
      )}
      {!imgReady && (
        <div
          ref={skeletonRef}
          data-testid="thumb-skeleton"
          className="absolute inset-0 rounded bg-neutral-200 dark:bg-neutral-800"
          aria-hidden="true"
        >
          <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent motion-safe:animate-[shimmer_1.4s_infinite] dark:via-white/10" />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run all Thumbnail tests**

Run: `pnpm test -- tests/components/browse/Thumbnail.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/Thumbnail.tsx tests/components/browse/Thumbnail.test.tsx
git commit -m "feat(browse): Thumbnail falls back on image error"
```

---

## Task 6: Cached-image short-circuit

Edge case: when the browser already has the image in cache, `onLoad` may have already fired before React attached the handler. Use a ref callback that checks `img.complete` synchronously when the element mounts.

**Files:**
- Modify: `src/components/browse/Thumbnail.tsx`
- Modify: `tests/components/browse/Thumbnail.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to the `describe("Thumbnail", ...)` block:

```tsx
  it("short-circuits to ready when img.complete is already true at mount", () => {
    // Firing IO stub
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        cb: (entries: { isIntersecting: boolean; target: Element }[]) => void;
        constructor(
          cb: (entries: { isIntersecting: boolean; target: Element }[]) => void,
        ) {
          this.cb = cb;
        }
        observe(el: Element) {
          this.cb([{ isIntersecting: true, target: el }]);
        }
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
        root = null;
        rootMargin = "";
        thresholds: number[] = [];
      },
    );

    // Force HTMLImageElement.complete to return true so the ref callback
    // sees a "cached" image at mount time.
    const completeSpy = vi
      .spyOn(HTMLImageElement.prototype, "complete", "get")
      .mockReturnValue(true);

    try {
      render(
        <Thumbnail
          src="/api/thumb/nas/prints/anchor.stl"
          className="h-12 w-12 rounded object-contain"
          fallback={<div>fallback</div>}
        />,
      );

      // Skeleton should be removed immediately, no fireEvent.load needed.
      expect(screen.queryByTestId("thumb-skeleton")).not.toBeInTheDocument();
      expect(screen.getByAltText("")).toBeInTheDocument();
    } finally {
      completeSpy.mockRestore();
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- tests/components/browse/Thumbnail.test.tsx`
Expected: FAIL — skeleton is still present (we haven't added the ref-callback short-circuit yet).

- [ ] **Step 3: Add a ref callback that checks `complete` at mount**

Replace `src/components/browse/Thumbnail.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  src: string;
  alt?: string;
  className?: string;
  fallback: ReactNode;
};

export function Thumbnail({ src, alt = "", className, fallback }: Props) {
  const skeletonRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  const [imgReady, setImgReady] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (inView) return;
    const el = skeletonRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            obs.disconnect();
            return;
          }
        }
      },
      { rootMargin: "100px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView]);

  // Callback ref: when the <img> element mounts, check if it's already
  // loaded (cached). If so, short-circuit to ready — onLoad may not fire
  // for cached images in some browsers.
  const handleImgRef = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete) setImgReady(true);
  }, []);

  if (errored) return <>{fallback}</>;

  return (
    <div className={`${className ?? ""} relative overflow-hidden`}>
      {inView && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={handleImgRef}
          src={src}
          alt={alt}
          className="block h-full w-full object-contain"
          onLoad={() => setImgReady(true)}
          onError={() => setErrored(true)}
        />
      )}
      {!imgReady && (
        <div
          ref={skeletonRef}
          data-testid="thumb-skeleton"
          className="absolute inset-0 rounded bg-neutral-200 dark:bg-neutral-800"
          aria-hidden="true"
        >
          <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent motion-safe:animate-[shimmer_1.4s_infinite] dark:via-white/10" />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run all Thumbnail tests**

Run: `pnpm test -- tests/components/browse/Thumbnail.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Add defensive `src`-change reset**

The component is mounted once per entry and `src` never changes in practice. But if a parent ever swaps the URL on a mounted instance (e.g. future-feature), state would be stale (`imgReady=true` for the old image, no skeleton for the new one). Add a small useEffect keyed on `src` to reset transient state.

Insert this after the existing intersection `useEffect` block in `src/components/browse/Thumbnail.tsx`:

```tsx
  // Defensive: reset transient state if src changes mid-life.
  useEffect(() => {
    setImgReady(false);
    setErrored(false);
  }, [src]);
```

Note: this runs once on mount too, but `setState` to the current value is a no-op in React 19 — no extra render.

- [ ] **Step 6: Run all Thumbnail tests again**

Run: `pnpm test -- tests/components/browse/Thumbnail.test.tsx`
Expected: PASS (still 5 tests — the new effect is defensive, not behavior-changing in test scenarios).

- [ ] **Step 7: Commit**

```bash
git add src/components/browse/Thumbnail.tsx tests/components/browse/Thumbnail.test.tsx
git commit -m "feat(browse): Thumbnail short-circuits when image is already cached"
```

---

## Task 7: Wire Thumbnail into EntryCard

Replace `EntryCard`'s inline lazy-thumb logic with a `<Thumbnail>` call. Update one existing EntryCard test that was asserting on the now-removed transparent pixel.

**Files:**
- Modify: `src/components/browse/EntryCard.tsx`
- Modify: `tests/components/browse/EntryCard.test.tsx`

- [ ] **Step 1: Replace EntryCard with delegating version**

Replace the contents of `src/components/browse/EntryCard.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import type { Entry } from "@/server/storage/types";
import { fileKindOf } from "@/server/browse/file-kind";
import { encodePathSegments } from "@/server/browse/encode-path";
import { Thumbnail } from "./Thumbnail";

type Props = {
  providerSlug: string;
  parentPath: string;
  entry: Entry;
  thumbnailsEnabled: boolean;
};

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function EntryCard({
  providerSlug,
  parentPath,
  entry,
  thumbnailsEnabled,
}: Props) {
  const childPath = joinPath(parentPath, entry.name);
  const href = `/${providerSlug}/${encodePathSegments(childPath)}`;

  const kind = entry.type === "file" ? fileKindOf(entry.name) : null;
  const showThumb = thumbnailsEnabled && (kind === "stl" || kind === "3mf");
  const thumbUrl = showThumb
    ? `/api/thumb/${providerSlug}/${encodePathSegments(childPath)}`
    : null;

  return (
    <Link
      href={href}
      className="group flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-center transition-colors hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-neutral-600 dark:hover:bg-neutral-900"
    >
      {thumbUrl ? (
        <Thumbnail
          src={thumbUrl}
          className="h-12 w-12 rounded"
          fallback={<Icon entry={entry} />}
        />
      ) : (
        <Icon entry={entry} />
      )}
      <span className="line-clamp-2 break-all text-xs text-neutral-700 dark:text-neutral-300">
        {entry.name}
      </span>
    </Link>
  );
}

function Icon({ entry }: { entry: Entry }) {
  if (entry.type === "directory") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="h-12 w-12 fill-neutral-300 group-hover:fill-neutral-400 dark:fill-neutral-700 dark:group-hover:fill-neutral-600"
        aria-hidden="true"
      >
        <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />
      </svg>
    );
  }
  const kind = fileKindOf(entry.name);
  const label = kind === "other" ? "FILE" : kind.toUpperCase();
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded border border-neutral-300 bg-neutral-100 text-[10px] font-medium uppercase text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
      {label}
    </div>
  );
}
```

Note: `useState` is still imported but not used in this component anymore. Check the final code — if no `useState` reference remains, remove the import. Same for `useEffect`/`useRef`. Keep imports tight.

After re-reading the new code: `useState` is no longer used → remove that import. Final imports should be:

```tsx
import Link from "next/link";
import type { Entry } from "@/server/storage/types";
import { fileKindOf } from "@/server/browse/file-kind";
import { encodePathSegments } from "@/server/browse/encode-path";
import { Thumbnail } from "./Thumbnail";
```

- [ ] **Step 2: Update the broken EntryCard test**

Open `tests/components/browse/EntryCard.test.tsx`. The test on or around line 136 — `"shows transparent placeholder before intersection (non-firing stub)"` — asserts `img.getAttribute("src")` equals the `TRANSPARENT_PIXEL` constant. In the new design, no `<img>` is mounted before intersection at all. Replace that test (and remove the now-unused `TRANSPARENT_PIXEL` constant near the top of the file).

Find and replace this block:

```tsx
const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
```

With nothing (delete the constant entirely — it's no longer used).

Find and replace this test:

```tsx
    it("shows transparent placeholder before intersection (non-firing stub)", () => {
      // Override with a non-firing stub for this test only
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          observe() {}
          disconnect() {}
          unobserve() {}
          takeRecords() {
            return [];
          }
          root = null;
          rootMargin = "";
          thresholds: number[] = [];
        },
      );

      render(
        <EntryCard
          providerSlug="nas"
          parentPath="prints"
          entry={file("anchor.stl")}
          thumbnailsEnabled={true}
        />,
      );
      const img = screen.getByAltText("");
      expect(img.getAttribute("src")).toBe(TRANSPARENT_PIXEL);
    });
```

With:

```tsx
    it("does not mount the <img> before intersection (non-firing stub)", () => {
      // Override with a non-firing stub for this test only
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          observe() {}
          disconnect() {}
          unobserve() {}
          takeRecords() {
            return [];
          }
          root = null;
          rootMargin = "";
          thresholds: number[] = [];
        },
      );

      render(
        <EntryCard
          providerSlug="nas"
          parentPath="prints"
          entry={file("anchor.stl")}
          thumbnailsEnabled={true}
        />,
      );
      // Pre-intersection: no <img> mounted; only the skeleton is in the DOM.
      expect(screen.queryByAltText("")).not.toBeInTheDocument();
      expect(screen.getByTestId("thumb-skeleton")).toBeInTheDocument();
    });
```

- [ ] **Step 3: Run the EntryCard tests**

Run: `pnpm test -- tests/components/browse/EntryCard.test.tsx`
Expected: PASS — all EntryCard tests including the updated one. The other thumbnail tests (rendering an `<img>` after intersection with the right URL, falling back on error, no img for .txt/disabled cases) should still pass without any changes: the firing IO stub triggers `Thumbnail`'s intersection, which mounts the img with the same `src` and same `alt=""`, and `fireEvent.error` still produces the same fallback Icon text. If any unexpected failure surfaces, stop and report — do not loosen assertions to make tests green.

- [ ] **Step 4: Run the full browse test directory**

Run: `pnpm test -- tests/components/browse`
Expected: PASS — Thumbnail (5 tests) + EntryCard + FilterDropdown + FolderBrowser + Markdown all green.

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/EntryCard.tsx tests/components/browse/EntryCard.test.tsx
git commit -m "feat(browse): EntryCard delegates thumbnail rendering to Thumbnail component"
```

---

## Task 8: Final verification

End-to-end checks before declaring done.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: PASS — all tests across the project.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS — no TS errors.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: PASS — no lint errors.

- [ ] **Step 4: Build (sanity check that Tailwind/Next compile)**

Run: `pnpm build`
Expected: PASS — production build completes. This is the only step that actually parses the new `@keyframes shimmer` rule and exercises Tailwind's `animate-[shimmer_1.4s_infinite]` arbitrary syntax. If Tailwind v4 doesn't accept the arbitrary animation reference, fix by promoting the keyframe + animation into Tailwind's theme config (Tailwind v4 uses CSS-first `@theme` directives in `globals.css`):

```css
@theme {
  --animate-shimmer: shimmer 1.4s infinite;
}
```

…and replace `animate-[shimmer_1.4s_infinite]` in `Thumbnail.tsx` with `animate-shimmer`. This is a fallback only — try the arbitrary syntax first.

- [ ] **Step 5: Manual smoke check (optional but recommended)**

Run: `pnpm dev`
Open the app, navigate to a folder containing STL or 3MF files. Confirm:
- Cards visible in viewport on first paint show the shimmer skeleton briefly, then the thumbnail.
- Cards below the fold show the skeleton only when scrolled into view.
- Reduced-motion preference (System Settings → Accessibility on macOS) makes the shimmer static — no sweeping animation.

This is not blocking — visual verification can also happen post-merge on the Coolify deploy.

- [ ] **Step 6: Final commit (if any cleanup happened)**

If steps 1–4 surfaced any small fixes, commit them with a descriptive message. Otherwise skip.
