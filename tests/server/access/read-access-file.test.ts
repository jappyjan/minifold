import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStorageProvider } from "@/server/storage/local";
import { readAccessFile } from "@/server/access/read-access-file";

let tmp: string;
let provider: LocalStorageProvider;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-access-read-"));
  provider = new LocalStorageProvider({ slug: "nas", rootPath: tmp });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("readAccessFile", () => {
  it("returns null when the access file does not exist", async () => {
    const result = await readAccessFile(provider, "");
    expect(result).toBeNull();
  });

  it("reads + parses the access file at the provider root", async () => {
    writeFileSync(
      join(tmp, ".minifold_access.yaml"),
      "default: public\n",
    );
    const result = await readAccessFile(provider, "");
    expect(result?.default).toBe("public");
  });

  it("reads + parses the access file in a subdirectory", async () => {
    mkdirSync(join(tmp, "sub"));
    writeFileSync(
      join(tmp, "sub", ".minifold_access.yaml"),
      "default: signed-in\noverrides:\n  x.stl: public\n",
    );
    const result = await readAccessFile(provider, "sub");
    expect(result?.default).toBe("signed-in");
    expect(result?.overrides).toEqual({ "x.stl": "public" });
  });

  it("returns a parsed result with warnings for malformed YAML (does not throw)", async () => {
    writeFileSync(
      join(tmp, ".minifold_access.yaml"),
      "::not-yaml::\n",
    );
    const result = await readAccessFile(provider, "");
    expect(result).not.toBeNull();
    expect(result?.warnings.length).toBeGreaterThan(0);
  });
});
