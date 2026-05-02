import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getDatabase } from "@/server/db";
import { getSetting } from "@/server/db/settings";
import {
  resolveLogoPath,
  type LogoExt,
} from "@/server/settings/logo-storage";

const CONTENT_TYPES: Record<LogoExt, string> = {
  png: "image/png",
  webp: "image/webp",
  svg: "image/svg+xml",
};

function dataDir(): string {
  return dirname(process.env.DATABASE_PATH ?? "/app/data/minifold.db");
}

export async function GET(): Promise<Response> {
  const value = getSetting(getDatabase(), "logo_url");
  if (!value || !value.startsWith("internal:")) {
    return new Response("Not found", { status: 404 });
  }
  const ext = value.slice("internal:".length) as LogoExt;
  if (!(ext in CONTENT_TYPES)) {
    return new Response("Not found", { status: 404 });
  }
  const path = resolveLogoPath(dataDir(), ext);
  if (!path) return new Response("Not found", { status: 404 });
  const buf = await readFile(path);
  return new Response(buf, {
    status: 200,
    headers: {
      "content-type": CONTENT_TYPES[ext],
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
