import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const ALLOWED: Record<string, ReadonlySet<string>> = {
  "180": new Set(["any"]),
  "192": new Set(["any"]),
  "512": new Set(["any", "maskable"]),
};

function dataDir(): string {
  const dbPath = process.env.DATABASE_PATH ?? "/app/data/minifold.db";
  return dirname(dbPath);
}

function publicIconsDir(): string {
  return resolve(process.cwd(), "public/icons");
}

function fileNameForVariant(size: string, purpose: string, prefix: "logo" | "icon"): string {
  if (purpose === "maskable") return `${prefix}-maskable-512.png`;
  return `${prefix}-${size}.png`;
}

async function pickFile(size: string, purpose: string): Promise<{ path: string; mtimeMs: number } | null> {
  const candidate = join(dataDir(), fileNameForVariant(size, purpose, "logo"));
  try {
    const s = await stat(candidate);
    if (s.isFile()) return { path: candidate, mtimeMs: s.mtimeMs };
  } catch {
    // fall through to default
  }
  const fallback = join(publicIconsDir(), fileNameForVariant(size, purpose, "icon"));
  try {
    const s = await stat(fallback);
    if (s.isFile()) return { path: fallback, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
  return null;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ size: string; purpose: string }> },
): Promise<Response> {
  const { size, purpose } = await ctx.params;
  // Strip a trailing ".png" if Next.js delivers the suffix as part of the segment.
  const cleanPurpose = purpose.replace(/\.png$/i, "");
  const allowed = ALLOWED[size];
  if (!allowed || !allowed.has(cleanPurpose)) {
    return new NextResponse(null, { status: 404 });
  }
  const picked = await pickFile(size, cleanPurpose);
  if (!picked) return new NextResponse(null, { status: 404 });

  const etag = `"${Math.floor(picked.mtimeMs)}"`;
  const ifNoneMatch = req.headers.get("If-None-Match");
  if (ifNoneMatch === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }
  const buf = await readFile(picked.path);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, must-revalidate",
      ETag: etag,
    },
  });
}
