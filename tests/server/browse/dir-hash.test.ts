import { describe, it, expect } from "vitest";
import type { Entry } from "@/server/storage/types";
import { computeDirHash } from "@/server/browse/dir-hash";

const fileEntry = (name: string, size: number, mtimeMs: number, etag?: string): Entry => ({
  name,
  type: "file",
  size,
  modifiedAt: new Date(mtimeMs),
  ...(etag !== undefined ? { etag } : {}),
});

const dirEntry = (name: string): Entry => ({
  name,
  type: "directory",
  size: 0,
  modifiedAt: new Date(0),
});

describe("computeDirHash", () => {
  it("returns a 64-char lowercase hex SHA-256 string", () => {
    const hash = computeDirHash([fileEntry("a.stl", 100, 1)]);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same hash regardless of input order", () => {
    const a = fileEntry("a.stl", 100, 1);
    const b = fileEntry("b.stl", 200, 2);
    expect(computeDirHash([a, b])).toBe(computeDirHash([b, a]));
  });

  it("hashes change when a file's size changes", () => {
    const before = computeDirHash([fileEntry("a.stl", 100, 1)]);
    const after = computeDirHash([fileEntry("a.stl", 101, 1)]);
    expect(before).not.toBe(after);
  });

  it("hashes change when a file's mtime changes (no etag)", () => {
    const before = computeDirHash([fileEntry("a.stl", 100, 1)]);
    const after = computeDirHash([fileEntry("a.stl", 100, 2)]);
    expect(before).not.toBe(after);
  });

  it("uses etag as the signature when present (mtime is ignored)", () => {
    const a = fileEntry("a.stl", 100, 1, "etag-1");
    const b = fileEntry("a.stl", 100, 999, "etag-1");
    expect(computeDirHash([a])).toBe(computeDirHash([b]));
  });

  it("hashes differ when etag changes", () => {
    const a = fileEntry("a.stl", 100, 1, "etag-1");
    const b = fileEntry("a.stl", 100, 1, "etag-2");
    expect(computeDirHash([a])).not.toBe(computeDirHash([b]));
  });

  it("hashes differ when a child is added", () => {
    const before = computeDirHash([fileEntry("a.stl", 100, 1)]);
    const after = computeDirHash([
      fileEntry("a.stl", 100, 1),
      fileEntry("b.stl", 100, 1),
    ]);
    expect(before).not.toBe(after);
  });

  it("includes directories in the hash (type matters)", () => {
    const asFile = computeDirHash([fileEntry("sub", 0, 0)]);
    const asDir = computeDirHash([dirEntry("sub")]);
    expect(asFile).not.toBe(asDir);
  });

  it("returns a stable hash for an empty directory", () => {
    expect(computeDirHash([])).toBe(computeDirHash([]));
    expect(computeDirHash([])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not collide when a filename contains delimiter-like characters", () => {
    // The old `name|type|size|sig\n` scheme could be tricked by a name that
    // embedded the field delimiters. With type=file, size=1, sig=1, the name
    // "a|file|1|1\nb" serializes to "a|file|1|1\nb|file|1|1\n" — byte-
    // identical to two entries named "a" and "b". NUL delimiters fix this
    // because NUL is forbidden in POSIX filenames and cannot appear in any
    // field value.
    const split = computeDirHash([
      fileEntry("a", 1, 1),
      fileEntry("b", 1, 1),
    ]);
    const collidingName = computeDirHash([fileEntry("a|file|1|1\nb", 1, 1)]);
    expect(split).not.toBe(collidingName);
  });
});
