import { writeFile, unlink, rename } from "node:fs/promises";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { resizeAny, composeMaskable } from "@/server/settings/icon-rendering";

export type LogoExt = "png" | "svg" | "webp";
export const LOGO_EXTS: readonly LogoExt[] = ["png", "svg", "webp"];

const VARIANT_FILES = [
  "logo-180.png",
  "logo-192.png",
  "logo-512.png",
  "logo-maskable-512.png",
] as const;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(buf: Buffer): boolean {
  if (buf.length < PNG_MAGIC.length) return false;
  return PNG_MAGIC.every((b, i) => buf[i] === b);
}

function isWebp(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  return (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  );
}

function isSvg(buf: Buffer): boolean {
  const head = buf.toString("utf8", 0, Math.min(64, buf.length)).trimStart();
  const lower = head.toLowerCase();
  return lower.startsWith("<?xml") || lower.startsWith("<svg");
}

export function sniffImageType(buf: Buffer): LogoExt | null {
  if (isPng(buf)) return "png";
  if (isWebp(buf)) return "webp";
  if (isSvg(buf)) return "svg";
  return null;
}

async function atomicWrite(path: string, buf: Buffer): Promise<void> {
  const tmp = `${path}.tmp`;
  try {
    await writeFile(tmp, buf);
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

// SVG decoding through sharp uses librsvg with limits; if the SVG can't be rasterised,
// this will throw. Operators uploading exotic SVGs should re-export to PNG.
export async function writeLogo(
  dir: string,
  buf: Buffer,
  accentHex: string,
): Promise<LogoExt> {
  const ext = sniffImageType(buf);
  if (!ext) throw new Error("Unsupported image type (must be PNG, SVG, or WebP)");
  // Generate all variant buffers FIRST — if sharp can't decode (corrupt/truncated
  // input that still passed magic-byte sniffing), this throws before we touch disk.
  const [v180, v192, v512, mask] = await Promise.all([
    resizeAny(buf, 180),
    resizeAny(buf, 192),
    resizeAny(buf, 512),
    composeMaskable(buf, accentHex),
  ]);
  // Remove any sibling logo with a different extension.
  for (const e of LOGO_EXTS) {
    if (e === ext) continue;
    const p = join(dir, `logo.${e}`);
    if (existsSync(p)) await unlink(p);
  }
  // Atomic writes — best effort. If one of the five renames fails after others
  // succeeded, on-disk state is partially-updated; subsequent reads fall back to
  // the public defaults for missing variants.
  await Promise.all([
    atomicWrite(join(dir, `logo.${ext}`), buf),
    atomicWrite(join(dir, "logo-180.png"), v180),
    atomicWrite(join(dir, "logo-192.png"), v192),
    atomicWrite(join(dir, "logo-512.png"), v512),
    atomicWrite(join(dir, "logo-maskable-512.png"), mask),
  ]);
  return ext;
}

export function clearLogo(dir: string): void {
  for (const e of LOGO_EXTS) {
    const p = join(dir, `logo.${e}`);
    if (existsSync(p)) unlinkSync(p);
  }
  for (const f of VARIANT_FILES) {
    const p = join(dir, f);
    if (existsSync(p)) unlinkSync(p);
  }
}

export function resolveLogoPath(dir: string, ext: LogoExt): string | null {
  const p = join(dir, `logo.${ext}`);
  return existsSync(p) ? p : null;
}

export async function regenerateMaskable(
  dir: string,
  currentBuffer: Buffer,
  accentHex: string,
): Promise<void> {
  const mask = await composeMaskable(currentBuffer, accentHex);
  await atomicWrite(join(dir, "logo-maskable-512.png"), mask);
}
