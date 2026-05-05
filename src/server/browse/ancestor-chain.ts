export type LeafKind = "file" | "directory";

/**
 * Returns the list of directory paths to render as columns in column view.
 * Each entry is a path relative to the provider root; "" is the provider root.
 *
 * Rules:
 *   - directory leaf: chain is [root, segments[0], segments[0..1], ..., full path]
 *   - file leaf: chain is the same as for the file's parent directory
 */
export function columnAncestorChain(
  segments: readonly string[],
  leafKind: LeafKind,
): string[] {
  const dirSegments = leafKind === "file" ? segments.slice(0, -1) : segments;
  const out: string[] = [""];
  let acc = "";
  for (const seg of dirSegments) {
    acc = acc === "" ? seg : `${acc}/${seg}`;
    out.push(acc);
  }
  return out;
}
