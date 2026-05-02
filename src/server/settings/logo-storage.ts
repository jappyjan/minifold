import { writeFile, unlink } from "node:fs/promises";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export type LogoExt = "png" | "svg" | "webp";
export const LOGO_EXTS: readonly LogoExt[] = ["png", "svg", "webp"];

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
  // Tolerate leading whitespace + BOM. Check first ~64 bytes.
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

export async function writeLogo(dir: string, buf: Buffer): Promise<LogoExt> {
  const ext = sniffImageType(buf);
  if (!ext) throw new Error("Unsupported image type (must be PNG, SVG, or WebP)");
  // Remove any sibling logos first.
  for (const e of LOGO_EXTS) {
    if (e === ext) continue;
    const p = join(dir, `logo.${e}`);
    if (existsSync(p)) await unlink(p);
  }
  await writeFile(join(dir, `logo.${ext}`), buf);
  return ext;
}

export function clearLogo(dir: string): void {
  for (const e of LOGO_EXTS) {
    const p = join(dir, `logo.${e}`);
    if (existsSync(p)) unlinkSync(p);
  }
}

export function resolveLogoPath(dir: string, ext: LogoExt): string | null {
  const p = join(dir, `logo.${ext}`);
  return existsSync(p) ? p : null;
}
