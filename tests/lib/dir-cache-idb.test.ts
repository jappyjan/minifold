import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  clearCachedDir,
  getCachedDir,
  IDB_DB_NAME,
  setCachedDir,
} from "@/lib/dir-cache-idb";
import type { Entry } from "@/server/storage/types";

const fileEntry = (name: string): Entry => ({
  name,
  type: "file",
  size: 1,
  modifiedAt: new Date(0),
});

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(IDB_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  await deleteDb();
});

describe("dir-cache-idb", () => {
  it("getCachedDir returns null when nothing is stored", async () => {
    expect(await getCachedDir("nas/foo")).toBeNull();
  });

  it("setCachedDir then getCachedDir round-trips the value", async () => {
    const entries = [fileEntry("a.stl")];
    await setCachedDir("nas/foo", { hash: "h1", entries, cachedAt: 42 });
    const got = await getCachedDir("nas/foo");
    expect(got).toEqual({ hash: "h1", entries, cachedAt: 42 });
  });

  it("setCachedDir overwrites the previous value at the same key", async () => {
    await setCachedDir("nas/foo", { hash: "h1", entries: [], cachedAt: 1 });
    await setCachedDir("nas/foo", { hash: "h2", entries: [], cachedAt: 2 });
    expect(await getCachedDir("nas/foo")).toEqual({
      hash: "h2",
      entries: [],
      cachedAt: 2,
    });
  });

  it("clearCachedDir removes a key", async () => {
    await setCachedDir("nas/foo", { hash: "h1", entries: [], cachedAt: 1 });
    await clearCachedDir("nas/foo");
    expect(await getCachedDir("nas/foo")).toBeNull();
  });

  it("keys are independent", async () => {
    await setCachedDir("nas/a", { hash: "h1", entries: [], cachedAt: 1 });
    await setCachedDir("nas/b", { hash: "h2", entries: [], cachedAt: 2 });
    expect((await getCachedDir("nas/a"))?.hash).toBe("h1");
    expect((await getCachedDir("nas/b"))?.hash).toBe("h2");
  });
});
