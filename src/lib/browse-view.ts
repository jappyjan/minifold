export type BrowseView = "grid" | "column";

export const VIEW_STORAGE_KEY = "minifold:browse-view";

export function mergeSearchParams(
  current: URLSearchParams,
  overrides: Record<string, string | null>,
): string {
  const next = new URLSearchParams(current);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) next.delete(k);
    else next.set(k, v);
  }
  return next.toString();
}

export function stripViewParam(current: URLSearchParams): string {
  return mergeSearchParams(current, { view: null });
}

export function readPersistedView(): BrowseView | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(VIEW_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "view" in parsed &&
      ((parsed as { view: unknown }).view === "grid" ||
        (parsed as { view: unknown }).view === "column")
    ) {
      return (parsed as { view: BrowseView }).view;
    }
  } catch {
    // fallthrough
  }
  return null;
}

export function writePersistedView(v: BrowseView): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ view: v }));
}
