import { describe, it, expect } from "vitest";
import { appRouter } from "@/server/trpc/router";

describe("health router", () => {
  it("returns status: ok", async () => {
    const caller = appRouter.createCaller({});
    const result = await caller.health.check();
    expect(result).toEqual({ status: "ok" });
  });
});
