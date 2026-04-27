import { describe, it, expect } from "vitest";
import { ThumbQueue } from "../src/queue";

describe("ThumbQueue", () => {
  it("limits concurrency", async () => {
    const q = new ThumbQueue({ concurrency: 2 });
    let inFlight = 0;
    let maxInFlight = 0;
    const task = () =>
      new Promise<void>((resolve) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(() => {
          inFlight--;
          resolve();
        }, 20);
      });
    await Promise.all(Array.from({ length: 5 }, () => q.add(task)));
    expect(maxInFlight).toBe(2);
  });

  it("returns the result of the task", async () => {
    const q = new ThumbQueue({ concurrency: 1 });
    const result = await q.add(async () => 42);
    expect(result).toBe(42);
  });

  it("propagates errors", async () => {
    const q = new ThumbQueue({ concurrency: 1 });
    await expect(q.add(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });
});
