import type { Entry } from "@/server/storage/types";

// Returns the set of filenames in `entries` that are sidecar markdown files —
// i.e., `.md` or `.markdown` files whose basename matches a non-markdown
// sibling (e.g. `anchor.md` next to `anchor.stl`). These render as the
// description on the sibling's detail page, so showing them as separate grid
// cards just duplicates content. Hidden from the grid by default; revealed
// when the user toggles "Show description files".
export function findSidecarMarkdowns(entries: readonly Entry[]): Set<string> {
  const nonMdBases = new Set<string>();
  for (const e of entries) {
    if (e.type !== "file") continue;
    const dot = e.name.lastIndexOf(".");
    if (dot < 0) continue;
    const ext = e.name.slice(dot + 1).toLowerCase();
    if (ext === "md" || ext === "markdown") continue;
    nonMdBases.add(e.name.slice(0, dot).toLowerCase());
  }

  const sidecars = new Set<string>();
  for (const e of entries) {
    if (e.type !== "file") continue;
    const dot = e.name.lastIndexOf(".");
    if (dot < 0) continue;
    const ext = e.name.slice(dot + 1).toLowerCase();
    if (ext !== "md" && ext !== "markdown") continue;
    const base = e.name.slice(0, dot).toLowerCase();
    if (nonMdBases.has(base)) sidecars.add(e.name);
  }
  return sidecars;
}
