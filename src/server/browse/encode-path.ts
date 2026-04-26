// Encode a slash-separated path for use in a URL. Each segment is
// percent-encoded so that filenames containing `#`, `?`, `%`, or spaces don't
// break the URL. Empty input → empty string.
export function encodePathSegments(path: string): string {
  if (!path) return "";
  return path.split("/").map(encodeURIComponent).join("/");
}

// Decode each segment from a Next.js dynamic route. App Router does NOT
// auto-decode URL-encoded segments for on-demand pages (only for SSG paths
// — see node_modules/next/dist/server/lib/router-utils/decode-path-params.js),
// so a URL like `/hetzner/%40untagged` arrives with `params.path = ["%40untagged"]`.
// Returns null if any segment is malformed; caller should treat as not-found.
export function decodePathSegments(
  segments: readonly string[],
): string[] | null {
  const out: string[] = [];
  for (const seg of segments) {
    try {
      out.push(decodeURIComponent(seg));
    } catch {
      return null;
    }
  }
  return out;
}
