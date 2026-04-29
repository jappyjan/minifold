# Thumbnail Loading State — Design

**Date:** 2026-04-30
**Status:** Approved

## Problem

Folder grid cards for STL/3MF files request thumbnails from `/api/thumb/...`. The current `EntryCard` renders a 1×1 transparent GIF until an `IntersectionObserver` flips a `loaded` flag, then swaps in the real image. Two states give the user no feedback:

1. **Pre-intersection** (offscreen, lazy-deferred): blank space.
2. **In-flight** (scrolled into view, image requested but not yet returned): also blank — the worker can take up to 30s for an uncached render.

The user reported this as a UX gap: cards look broken or empty while thumbnails load.

## Goals

- Show a clear "loading" affordance from the moment a thumbnail-eligible card mounts until the image has decoded.
- Cover both pre-intersection and in-flight states with the same treatment.
- Preserve the existing intersection-based lazy-load behavior (don't fire all thumbnail requests on page load).
- Preserve the existing error fallback (file-kind icon).
- Keep `EntryCard` simple by extracting the loading state machine into its own component.

## Non-goals

- No "still loading after N seconds" escalation or progress indicator.
- No retry-on-error or error toast.
- No artificial minimum skeleton duration.
- No changes to the `/api/thumb` route or worker.

## Architecture

A new client component `src/components/browse/Thumbnail.tsx` owns the entire loading state machine. `EntryCard` decides only whether a thumbnail is eligible (`thumbnailsEnabled && (kind === "stl" || kind === "3mf")`) and delegates everything else.

### Component contract

```ts
type Props = {
  src: string;            // the /api/thumb URL
  alt?: string;           // defaults to ""
  className?: string;     // sizing/shape from caller (e.g. "h-12 w-12 rounded")
  fallback: ReactNode;    // rendered on error (the file-kind <Icon>)
};
```

`EntryCard` reduces to:

```tsx
{thumbUrl ? (
  <Thumbnail
    src={thumbUrl}
    className="h-12 w-12 rounded object-contain"
    fallback={<Icon entry={entry} />}
  />
) : (
  <Icon entry={entry} />
)}
```

After this change, `EntryCard` no longer references `useRef`, `IntersectionObserver`, `errored`, `loaded`, or `TRANSPARENT_PIXEL`. Those move into `Thumbnail` (or are deleted).

## State machine

Two booleans drive rendering: `inView` (flipped by `IntersectionObserver`) and `imgReady` (flipped by `<img onLoad>`). A third, `errored`, terminates into the fallback.

| `inView` | `imgReady` | `errored` | Render                                          |
| -------- | ---------- | --------- | ----------------------------------------------- |
| false    | —          | —         | Skeleton (pre-intersection)                     |
| true     | false      | false     | Skeleton (in-flight) + hidden `<img>` requesting|
| true     | true       | false     | `<img>` (skeleton removed)                      |
| —        | —          | true      | `fallback` prop                                 |

### Transitions

- `inView`: an `IntersectionObserver` (with `rootMargin: "100px"`, matching today's behavior) observes the skeleton element. On first intersection, it sets `inView = true` and disconnects.
- `imgReady`: the `<img>`'s `onLoad` handler sets it to `true`.
- `errored`: the `<img>`'s `onError` handler sets it to `true`. Once true, the component renders only the `fallback`.

### DOM layout

- Before `inView`: the skeleton `<div>` is the only element rendered. The observer ref attaches to it.
- After `inView`: the skeleton `<div>` is still rendered, plus the `<img>` element. The image starts hidden (`opacity: 0` or equivalent) so the skeleton remains visible underneath. When `imgReady` becomes `true`, the skeleton is removed from the tree and the image becomes visible.

## Visual design

A neutral rounded square with an animated shimmer band sweeping across.

```tsx
<div
  ref={observerRef}
  className="h-12 w-12 rounded bg-neutral-200 dark:bg-neutral-800 relative overflow-hidden"
  aria-hidden="true"
>
  <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/10" />
</div>
```

(The component sizes itself from `className`; the snippet above shows defaults that match the current 48×48 footprint.)

A new keyframe added to `src/app/globals.css`:

```css
@keyframes shimmer {
  100% { transform: translateX(100%); }
}
```

### Reduced motion

The shimmer animation is wrapped in `@media (prefers-reduced-motion: no-preference)`. Users with reduced-motion settings see a static neutral square — no sweep.

### Tunables

- Animation duration: **1.4s** (calm, reads as "loading" without feeling twitchy).
- Light mode: `bg-neutral-200` base, `white/40` band.
- Dark mode: `bg-neutral-800` base, `white/10` band.

## Error handling

- `<img onError>` → set `errored = true` → render `fallback`.
- No retry, no toast, no logging beyond what the browser already does.
- Same effective behavior as today; the trigger moves from `EntryCard` to `Thumbnail`.

## Edge cases

1. **Browser-cached image fires `onLoad` synchronously.** After the `<img>` mounts, a `useEffect` checks `imgRef.current?.complete` and short-circuits `imgReady` to `true`. Standard pattern for race-safe `<img>` loading in React.
2. **Component unmounts mid-load.** The `IntersectionObserver` cleanup disconnects in the effect's return. Image-load handlers no-op if the ref is null.
3. **`src` prop changes.** Reset `imgReady` and `errored` via a `useEffect` keyed on `src`. Not expected in practice (one URL per entry) but cheap insurance.
4. **Skeleton flicker for instantly-cached images.** Acceptable: a single frame of skeleton is preferable to artificial delays.
5. **SSR / no-JS.** Component is `"use client"`. SSR renders nothing meaningful for the thumbnail slot. Same as today; not regressed.

## Testing

### New: `tests/components/browse/Thumbnail.test.tsx`

1. **Renders skeleton before intersection** — mock `IntersectionObserver` so it never fires; assert skeleton element present, no `<img>` element.
2. **Triggers load on intersection** — fire intersection; assert `<img>` now in DOM with the expected `src`.
3. **Swaps skeleton for image on load** — fire intersection, then dispatch `load` on the `<img>`; assert skeleton gone, image visible (no opacity-0 class).
4. **Falls back on error** — fire intersection, then dispatch `error` on the `<img>`; assert fallback rendered, skeleton and image gone.
5. **Handles already-cached image** — set `img.complete = true` synchronously after mount; assert ready state is reached without waiting for an `onLoad` event.

### Updated: `tests/components/browse/EntryCard.test.tsx`

Existing assertions about thumbnail-eligible cards should hold because the public behavior is unchanged: an image element appears when a thumbnail URL is available. Selectors may need minor adjustment (e.g. if a test asserts on the transparent-pixel `src`, it now asserts on the skeleton element instead). Re-run after implementation; fix only what breaks.

### Unchanged

- `tests/app/api/thumb/thumb.test.ts` — server route is untouched.

## Files touched

- **New:** `src/components/browse/Thumbnail.tsx`
- **New:** `tests/components/browse/Thumbnail.test.tsx`
- **Modified:** `src/components/browse/EntryCard.tsx` (delegate to `Thumbnail`)
- **Modified:** `src/app/globals.css` (add `shimmer` keyframe)
- **Possibly modified:** `tests/components/browse/EntryCard.test.tsx` (selector adjustments)

## Out of scope

- 3D viewer thumbnail/poster behavior (separate component, separate spec).
- Worker-side speedups or pre-rendering.
- Toast / retry UX on thumbnail failures.
