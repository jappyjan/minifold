// Encode a slash-separated path for use in a URL. Each segment is
// percent-encoded so that filenames containing `#`, `?`, `%`, or spaces don't
// break the URL. Empty input → empty string.
export function encodePathSegments(path: string): string {
  if (!path) return "";
  return path.split("/").map(encodeURIComponent).join("/");
}
