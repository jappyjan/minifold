export function getThumbnailServiceUrl(): string | null {
  const raw = process.env.MINIFOLD_THUMB_SERVICE_URL ?? "";
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed === "" ? null : trimmed;
}

export function isThumbnailServiceEnabled(): boolean {
  return getThumbnailServiceUrl() !== null;
}
