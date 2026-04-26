import type { Entry } from "@/server/storage/types";

const FOLDER_DESC_PRIORITY = ["index.md", "readme.md", "model.md", "collection.md"];

export function findFolderDescription(entries: readonly Entry[]): Entry | null {
  for (const target of FOLDER_DESC_PRIORITY) {
    const found = entries.find(
      (e) => e.type === "file" && e.name.toLowerCase() === target,
    );
    if (found) return found;
  }
  return null;
}

export function findFileDescription(
  siblings: readonly Entry[],
  fileName: string,
): Entry | null {
  const dot = fileName.lastIndexOf(".");
  const baseLower = (dot < 0 ? fileName : fileName.slice(0, dot)).toLowerCase();
  if (!baseLower) return null;
  for (const e of siblings) {
    if (e.type !== "file") continue;
    if (e.name === fileName) continue; // do not match self
    const eDot = e.name.lastIndexOf(".");
    if (eDot < 0) continue;
    const eExt = e.name.slice(eDot + 1).toLowerCase();
    if (eExt !== "md" && eExt !== "markdown") continue;
    const eBase = e.name.slice(0, eDot).toLowerCase();
    if (eBase === baseLower) return e;
  }
  return null;
}
