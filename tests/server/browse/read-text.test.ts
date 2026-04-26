import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStorageProvider } from "@/server/storage/local";
import { readTextFile } from "@/server/browse/read-text";

let root: string;
let provider: LocalStorageProvider;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "minifold-readtext-"));
  writeFileSync(join(root, "hi.txt"), "hello world\n");
  writeFileSync(join(root, "utf8.md"), "# café — π ≈ 3.14\n");
  provider = new LocalStorageProvider({ slug: "p", rootPath: root });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("readTextFile", () => {
  it("returns the full file content as UTF-8", async () => {
    expect(await readTextFile(provider, "hi.txt")).toBe("hello world\n");
  });

  it("preserves multibyte characters", async () => {
    expect(await readTextFile(provider, "utf8.md")).toBe(
      "# café — π ≈ 3.14\n",
    );
  });
});
