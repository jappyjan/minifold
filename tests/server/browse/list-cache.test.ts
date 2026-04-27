import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { listWithCache, __clearListCache } from "@/server/browse/list-cache";
import type { StorageProvider, Entry } from "@/server/storage/types";

// Fake timers control Date.now() / setTimeout but we let microtasks run
// normally so that promise chains resolve without needing extra trickery.
vi.useFakeTimers();

const TTL_FRESH_MS = 30_000;
const TTL_STALE_MS = 300_000;

function makeStubProvider() {
  let calls = 0;
  return {
    slug: "stub",
    list: async (_path: string): Promise<Entry[]> => {
      calls++;
      return [
        {
          name: `e${calls}`,
          type: "file" as const,
          size: 1,
          modifiedAt: new Date(0),
        },
      ];
    },
    get calls() {
      return calls;
    },
    // unused stubs
    stat: async () => ({}) as Entry,
    read: async () => ({}) as ReadableStream<Uint8Array>,
    write: async () => {},
    exists: async () => false,
  } satisfies StorageProvider & { readonly calls: number };
}

beforeEach(() => {
  __clearListCache();
  vi.clearAllTimers();
});

afterEach(() => {
  vi.clearAllTimers();
});

describe("listWithCache", () => {
  it("cold call invokes provider.list once and returns its entries", async () => {
    const provider = makeStubProvider();
    const entries = await listWithCache(provider, "");
    expect(provider.calls).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries.map((e) => e.name)).toEqual(["e1"]);
  });

  it("second call within TTL_FRESH_MS returns cached entries without invoking provider.list again", async () => {
    const provider = makeStubProvider();
    await listWithCache(provider, "");

    // Advance time but stay within fresh window.
    vi.advanceTimersByTime(TTL_FRESH_MS - 1);

    const entries = await listWithCache(provider, "");
    expect(provider.calls).toBe(1);
    expect(entries.map((e) => e.name)).toEqual(["e1"]);
  });

  it("concurrent cold calls dedupe — only one provider.list invocation", async () => {
    const provider = makeStubProvider();
    const [a, b] = await Promise.all([
      listWithCache(provider, ""),
      listWithCache(provider, ""),
    ]);
    expect(provider.calls).toBe(1);
    expect(a).toBe(b); // same array reference
  });

  it("after TTL_FRESH_MS but before TTL_STALE_MS, returns cached entries immediately AND triggers a background refresh", async () => {
    const provider = makeStubProvider();
    // Prime the cache.
    await listWithCache(provider, "");
    expect(provider.calls).toBe(1);

    // Move past fresh window but still within stale window.
    vi.advanceTimersByTime(TTL_FRESH_MS + 1);

    const entries = await listWithCache(provider, "");
    // Should get stale data back immediately.
    expect(entries.map((e) => e.name)).toEqual(["e1"]);

    // Background refresh is kicked off — let microtasks settle.
    await vi.advanceTimersByTimeAsync(0);

    // Background refresh should have happened.
    expect(provider.calls).toBe(2);

    // The next fresh call returns the updated cache entry.
    vi.advanceTimersByTime(0); // still fresh now
    const updated = await listWithCache(provider, "");
    expect(updated.map((e) => e.name)).toEqual(["e2"]);
    // Should still be 2 calls — within fresh window.
    expect(provider.calls).toBe(2);
  });

  it("after TTL_STALE_MS, the next call must wait for fresh data (not return stale)", async () => {
    const provider = makeStubProvider();
    // Prime the cache.
    await listWithCache(provider, "");
    expect(provider.calls).toBe(1);

    // Move past both fresh AND stale windows.
    vi.advanceTimersByTime(TTL_STALE_MS + 1);

    const entries = await listWithCache(provider, "");
    // Must have fetched fresh; stale data would be "e1".
    expect(provider.calls).toBe(2);
    expect(entries.map((e) => e.name)).toEqual(["e2"]);
  });
});
