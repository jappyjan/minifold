import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStorageProvider } from "@/server/storage/local";
import { NotFoundError, PathTraversalError } from "@/server/storage/types";

let root: string;
let provider: LocalStorageProvider;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "minifold-local-"));
  mkdirSync(join(root, "prints"));
  writeFileSync(join(root, "prints", "anchor.stl"), Buffer.from([0, 1, 2, 3]));
  writeFileSync(join(root, "hello.md"), "# hi");
  mkdirSync(join(root, "prints", "sub"));
  provider = new LocalStorageProvider({ slug: "local", rootPath: root });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("LocalStorageProvider.list", () => {
  it("lists immediate children of the root", async () => {
    const entries = await provider.list("");
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["hello.md", "prints"]);
    const file = entries.find((e) => e.name === "hello.md")!;
    expect(file.type).toBe("file");
    expect(file.size).toBeGreaterThan(0);
    const dir = entries.find((e) => e.name === "prints")!;
    expect(dir.type).toBe("directory");
    expect(dir.size).toBe(0);
  });

  it("lists a nested directory", async () => {
    const entries = await provider.list("prints");
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["anchor.stl", "sub"]);
  });

  it("throws NotFoundError for a missing directory", async () => {
    await expect(provider.list("does-not-exist")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("blocks path traversal via ..", async () => {
    await expect(provider.list("../../../etc")).rejects.toBeInstanceOf(
      PathTraversalError,
    );
  });

  it("blocks absolute path arguments", async () => {
    await expect(provider.list("/etc")).rejects.toBeInstanceOf(PathTraversalError);
  });
});

describe("LocalStorageProvider.stat", () => {
  it("returns file metadata", async () => {
    const entry = await provider.stat("hello.md");
    expect(entry.name).toBe("hello.md");
    expect(entry.type).toBe("file");
    expect(entry.size).toBe(4);
    expect(entry.modifiedAt).toBeInstanceOf(Date);
  });

  it("returns directory metadata", async () => {
    const entry = await provider.stat("prints");
    expect(entry.type).toBe("directory");
    expect(entry.size).toBe(0);
  });

  it("throws NotFoundError for missing path", async () => {
    await expect(provider.stat("no-such-file")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("LocalStorageProvider.exists", () => {
  it("returns true for existing file", async () => {
    expect(await provider.exists("hello.md")).toBe(true);
  });
  it("returns true for existing directory", async () => {
    expect(await provider.exists("prints")).toBe(true);
  });
  it("returns false for missing path", async () => {
    expect(await provider.exists("nope")).toBe(false);
  });
  it("returns false on traversal attempts (no leak)", async () => {
    expect(await provider.exists("../etc/passwd")).toBe(false);
  });
});

describe("LocalStorageProvider.read + write", () => {
  it("write creates a file and read streams its content back", async () => {
    await provider.write("new.txt", Buffer.from("hello, world"));
    expect(await provider.exists("new.txt")).toBe(true);

    const stream = await provider.read("new.txt");
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const total = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    expect(total.toString("utf8")).toBe("hello, world");
  });

  it("write creates parent directories as needed", async () => {
    await provider.write("deep/nested/dir/file.txt", Buffer.from("ok"));
    expect(await provider.exists("deep/nested/dir/file.txt")).toBe(true);
  });

  it("write blocks traversal", async () => {
    await expect(
      provider.write("../outside.txt", Buffer.from("x")),
    ).rejects.toBeInstanceOf(PathTraversalError);
  });

  it("read throws NotFoundError for missing files", async () => {
    await expect(provider.read("missing.bin")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
