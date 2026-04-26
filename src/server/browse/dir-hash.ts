import { createHash } from "node:crypto";
import type { Entry } from "@/server/storage/types";

// Stable SHA-256 over directory contents. Each child contributes
// `name|type|size|sig\n` where sig is etag if present, else
// modifiedAt.getTime(). Children are sorted by name first so input order
// never affects the hash. The trailing newline separator prevents
// boundary ambiguity (e.g. ["ab","c"] vs ["a","bc"]).
export function computeDirHash(entries: readonly Entry[]): string {
  const sorted = [...entries].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const hash = createHash("sha256");
  for (const e of sorted) {
    const sig = e.etag ?? String(e.modifiedAt.getTime());
    hash.update(`${e.name}|${e.type}|${e.size}|${sig}\n`);
  }
  return hash.digest("hex");
}
