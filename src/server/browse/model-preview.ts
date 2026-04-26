// Hard cap on file sizes the in-browser 3D viewer will attempt to load.
// Three.js + R3F geometry buffers can use 3-5x the file size in RAM, so
// 200 MB stays inside reasonable limits even on mid-range mobile.
export const MAX_PREVIEW_BYTES = 200 * 1024 * 1024;

export function isTooLargeForPreview(size: number): boolean {
  if (!Number.isFinite(size) || size < 0) return false;
  return size > MAX_PREVIEW_BYTES;
}

export type ModelLoaderKind = "stl" | "3mf";

// Returns which three.js loader to use for a filename, or null if the file
// isn't a previewable 3D format. Kept separate from `fileKindOf` so this
// module can grow (step, obj, gcode, …) without churning the broader
// file-kind enum.
export function loaderKindFor(name: string): ModelLoaderKind | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (ext === "stl") return "stl";
  if (ext === "3mf") return "3mf";
  return null;
}
