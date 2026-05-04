import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSw } from "../../scripts/build-sw";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-build-sw-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("buildSw", () => {
  it("writes public/sw.js with the injected SHELL_VERSION and PRECACHE_LIST", async () => {
    const nextDir = join(tmp, ".next");
    const publicDir = join(tmp, "public");
    mkdirSync(nextDir, { recursive: true });
    mkdirSync(publicDir, { recursive: true });
    // Minimal build-manifest.json — the script reads pages/_app and rootMainFiles.
    writeFileSync(
      join(nextDir, "build-manifest.json"),
      JSON.stringify({
        rootMainFiles: ["static/chunks/main-xyz.js", "static/chunks/webpack-abc.js"],
        pages: { "/_app": ["static/chunks/main-xyz.js"] },
      }),
    );
    await buildSw({
      projectRoot: tmp,
      buildSha: "abc1234",
      // Repo's actual sw.ts source must exist relative to projectRoot — for the test, point at the real one.
      swSourcePath: join(process.cwd(), "src/sw/sw.ts"),
    });
    const out = readFileSync(join(publicDir, "sw.js"), "utf8");
    expect(out).toContain('"abc1234"'); // SHELL_VERSION literal
    expect(out).toContain("/_next/static/chunks/main-xyz.js");
    // PRECACHE_LIST must NOT contain HTML pages — those embed per-user state.
    expect(out).not.toMatch(/PRECACHE_LIST_default = \[[^\]]*"\/"/);
    expect(out).not.toMatch(/PRECACHE_LIST_default = \[[^\]]*"\/login"/);
    expect(out.length).toBeGreaterThan(500);
  });

  it("throws when .next/build-manifest.json is missing", async () => {
    mkdirSync(join(tmp, "public"), { recursive: true });
    await expect(
      buildSw({
        projectRoot: tmp,
        buildSha: "abc",
        swSourcePath: join(process.cwd(), "src/sw/sw.ts"),
      }),
    ).rejects.toThrow(/build-manifest/i);
  });
});
