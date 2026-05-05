import type { FileKind } from "@/server/browse/file-kind";
import { fileKindOf } from "@/server/browse/file-kind";
import type { Entry } from "@/server/storage/types";

export const CATEGORIES = ["3d", "doc", "image", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const DEFAULT_VISIBLE: readonly Category[] = ["3d", "doc", "image"];

export const STORAGE_KEY = "minifold:browse-filter";

export function categoryOfKind(kind: FileKind): Category {
  switch (kind) {
    case "stl":
    case "3mf":
    case "step":
    case "obj":
    case "gcode":
    case "bgcode":
    case "f3d":
      return "3d";
    case "md":
    case "pdf":
      return "doc";
    case "image":
      return "image";
    case "other":
      return "other";
  }
}

/**
 * Parses `?show=3d,doc,image` into a Category[] (or null if param absent/empty).
 * Special token "all" → all four categories.
 * Unknown tokens are ignored. Whitespace and case are normalized.
 */
export function parseShowParam(
  raw: string | null | undefined,
): Category[] | null {
  if (raw == null) return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "") return null;
  if (trimmed === "all") return [...CATEGORIES];
  const parts = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = parts.filter((p): p is Category =>
    (CATEGORIES as readonly string[]).includes(p),
  );
  return valid.length > 0 ? valid : null;
}

/**
 * Reads the persisted visible set from localStorage. Returns null if none/invalid.
 * Safe to call from SSR — returns null if `localStorage` is unavailable.
 */
export function readPersistedVisible(): Category[] | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "visible" in parsed &&
      Array.isArray((parsed as { visible: unknown }).visible)
    ) {
      const v = (parsed as { visible: unknown[] }).visible;
      const valid = v.filter(
        (x): x is Category =>
          typeof x === "string" &&
          (CATEGORIES as readonly string[]).includes(x),
      );
      return valid;
    }
  } catch {
    // fallthrough
  }
  return null;
}

export function writePersistedVisible(visible: readonly Category[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ visible }));
}

export function filterEntriesByCategory(
  entries: readonly Entry[],
  visibleCategories: ReadonlySet<Category>,
): Entry[] {
  return entries.filter((e) => {
    if (e.type === "file") {
      const cat = categoryOfKind(fileKindOf(e.name));
      if (!visibleCategories.has(cat)) return false;
    }
    return true;
  });
}
