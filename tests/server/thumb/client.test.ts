import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchThumbnail, ThumbnailServiceError } from "@/server/thumb/client";

const realFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
});

describe("fetchThumbnail", () => {
  it("POSTs file bytes and returns the response Buffer on 200", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("http://thumbs:3001/render?format=stl");
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({ "content-type": "application/octet-stream" });
      const body = init.body as Uint8Array;
      expect(Array.from(body)).toEqual([1, 2, 3]);
      return new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
        status: 200,
        headers: { "content-type": "image/webp" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await fetchThumbnail({
      serviceUrl: "http://thumbs:3001",
      data: Buffer.from([1, 2, 3]),
      format: "stl",
      timeoutMs: 5_000,
    });
    expect(Array.from(out)).toEqual([0x52, 0x49, 0x46, 0x46]);
  });

  it("throws ThumbnailServiceError on non-200", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(
      fetchThumbnail({
        serviceUrl: "http://thumbs:3001",
        data: Buffer.from([0]),
        format: "stl",
        timeoutMs: 5_000,
      }),
    ).rejects.toBeInstanceOf(ThumbnailServiceError);
  });

  it("aborts and throws when timeout elapses", async () => {
    globalThis.fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;

    await expect(
      fetchThumbnail({
        serviceUrl: "http://thumbs:3001",
        data: Buffer.from([0]),
        format: "stl",
        timeoutMs: 50,
      }),
    ).rejects.toBeInstanceOf(ThumbnailServiceError);
  });
});
