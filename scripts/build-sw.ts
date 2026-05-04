import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import * as esbuild from "esbuild";

type BuildSwOptions = {
  projectRoot: string;
  buildSha: string;
  swSourcePath: string;
};

function deriveBuildSha(): string {
  if (process.env.BUILD_SHA && process.env.BUILD_SHA.length > 0) {
    return process.env.BUILD_SHA;
  }
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return new Date().toISOString();
  }
}

export async function buildSw(opts: BuildSwOptions): Promise<void> {
  const manifestPath = join(opts.projectRoot, ".next/build-manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `build-manifest.json not found at ${manifestPath} — run 'next build' first.`,
    );
  }
  const manifestRaw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw) as {
    rootMainFiles?: string[];
    pages?: Record<string, string[]>;
  };
  const rootMain = (manifest.rootMainFiles ?? []).map((p) => `/_next/${p}`);
  const appShell = (manifest.pages?.["/_app"] ?? []).map((p) => `/_next/${p}`);
  const precacheList = Array.from(new Set(["/", "/login", ...rootMain, ...appShell]));

  const publicDir = join(opts.projectRoot, "public");
  await mkdir(publicDir, { recursive: true });

  await esbuild.build({
    entryPoints: [opts.swSourcePath],
    bundle: true,
    format: "iife",
    target: "es2022",
    minify: false,
    write: true,
    outfile: join(publicDir, "sw.js"),
    define: {
      SHELL_VERSION: JSON.stringify(opts.buildSha),
      PRECACHE_LIST: JSON.stringify(precacheList),
    },
    logLevel: "info",
  });
}

// Direct invocation: tsx scripts/build-sw.ts
if (require.main === module) {
  const root = process.cwd();
  buildSw({
    projectRoot: root,
    buildSha: deriveBuildSha(),
    swSourcePath: join(root, "src/sw/sw.ts"),
  })
    .then(() => console.log("[build-sw] wrote public/sw.js"))
    .catch((err) => {
      console.error("[build-sw] failed:", err);
      process.exit(1);
    });
}
