export function thumbSidecarPath(originalPath: string): string {
  const lastSlash = originalPath.lastIndexOf("/");
  const dir = lastSlash >= 0 ? originalPath.slice(0, lastSlash) : "";
  const name = lastSlash >= 0 ? originalPath.slice(lastSlash + 1) : originalPath;
  const sidecar = `.minifold_thumb_${name}.webp`;
  return dir ? `${dir}/${sidecar}` : sidecar;
}
