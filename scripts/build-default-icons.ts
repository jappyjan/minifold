import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resizeAny, composeMaskable } from "../src/server/settings/icon-rendering";

export async function buildDefaultIcons(
  sourcePath: string,
  outDir: string,
  accentHex: string,
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const src = await readFile(sourcePath);
  const [v180, v192, v512, mask] = await Promise.all([
    resizeAny(src, 180),
    resizeAny(src, 192),
    resizeAny(src, 512),
    composeMaskable(src, accentHex),
  ]);
  await Promise.all([
    writeFile(join(outDir, "icon-180.png"), v180),
    writeFile(join(outDir, "icon-192.png"), v192),
    writeFile(join(outDir, "icon-512.png"), v512),
    writeFile(join(outDir, "icon-maskable-512.png"), mask),
  ]);
}

// Direct invocation: tsx scripts/build-default-icons.ts
if (require.main === module) {
  const root = process.cwd();
  const src = join(root, "public/icons/icon-source.png");
  const out = join(root, "public/icons");
  buildDefaultIcons(src, out, "#3b82f6")
    .then(() => console.log("[build-default-icons] wrote 4 variants to public/icons/"))
    .catch((err) => {
      console.error("[build-default-icons] failed:", err);
      process.exit(1);
    });
}
