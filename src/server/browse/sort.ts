import type { Entry } from "@/server/storage/types";

const collator = new Intl.Collator(undefined, { sensitivity: "base" });

export function sortEntries(entries: readonly Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
}
