import { createHash } from "node:crypto";
import type { Entry } from "@/server/storage/types";

// Stable SHA-256 over directory contents. Each child contributes its
// name, type, size, and signature (etag if present, else
// modifiedAt.getTime()) separated by NUL bytes — disallowed in
// filesystem paths, so no field value can collide with the delimiter.
// Children are sorted by name first so input order never affects the hash.
export function computeDirHash(entries: readonly Entry[]): string {
  const sorted = [...entries].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const hash = createHash("sha256");
  const NUL = "\x00";
  for (const e of sorted) {
    const sig = e.etag ?? String(e.modifiedAt.getTime());
    hash.update(e.name);
    hash.update(NUL);
    hash.update(e.type);
    hash.update(NUL);
    hash.update(String(e.size));
    hash.update(NUL);
    hash.update(sig);
    hash.update(NUL);
  }
  return hash.digest("hex");
}
