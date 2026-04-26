import { describe, it, expect } from "vitest";
import { isReservedSlug, RESERVED_SLUGS } from "@/server/browse/reserved-slugs";

describe("reserved slugs", () => {
  it("includes the obvious top-level routes", () => {
    expect(RESERVED_SLUGS.has("admin")).toBe(true);
    expect(RESERVED_SLUGS.has("api")).toBe(true);
    expect(RESERVED_SLUGS.has("login")).toBe(true);
    expect(RESERVED_SLUGS.has("logout")).toBe(true);
    expect(RESERVED_SLUGS.has("setup")).toBe(true);
  });

  it("isReservedSlug is case-insensitive and trim-tolerant", () => {
    expect(isReservedSlug("Admin")).toBe(true);
    expect(isReservedSlug("  api ")).toBe(true);
    expect(isReservedSlug("nas")).toBe(false);
    expect(isReservedSlug("")).toBe(false);
  });
});
