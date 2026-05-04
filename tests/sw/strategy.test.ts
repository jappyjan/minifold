import { describe, it, expect } from "vitest";
import { getCacheStrategy } from "@/sw/strategy";

const u = (path: string) => new URL(`http://test${path}`);

describe("getCacheStrategy", () => {
  it("returns 'never' for any non-GET request", () => {
    expect(getCacheStrategy(u("/"), "POST")).toBe("never");
    expect(getCacheStrategy(u("/_next/static/chunks/x.js"), "DELETE")).toBe("never");
  });

  it("returns 'shell' for the root and /login (GET)", () => {
    expect(getCacheStrategy(u("/"), "GET")).toBe("shell");
    expect(getCacheStrategy(u("/login"), "GET")).toBe("shell");
  });

  it("returns 'shell' for /_next/static/* (GET)", () => {
    expect(getCacheStrategy(u("/_next/static/chunks/abc.js"), "GET")).toBe("shell");
    expect(getCacheStrategy(u("/_next/static/css/app.css"), "GET")).toBe("shell");
  });

  it("returns 'runtime' for /_next/image/*, /api/icon/*, /api/logo (GET)", () => {
    expect(getCacheStrategy(u("/_next/image/abc"), "GET")).toBe("runtime");
    expect(getCacheStrategy(u("/api/icon/192/any.png"), "GET")).toBe("runtime");
    expect(getCacheStrategy(u("/api/logo"), "GET")).toBe("runtime");
  });

  it("returns 'never' for auth-gated /api/file, /api/thumb, /api/trpc", () => {
    expect(getCacheStrategy(u("/api/file/local/x.stl"), "GET")).toBe("never");
    expect(getCacheStrategy(u("/api/thumb/local/x.stl"), "GET")).toBe("never");
    expect(getCacheStrategy(u("/api/trpc/browse.list"), "GET")).toBe("never");
  });

  it("returns 'never' for /admin/* and /setup", () => {
    expect(getCacheStrategy(u("/admin"), "GET")).toBe("never");
    expect(getCacheStrategy(u("/admin/users"), "GET")).toBe("never");
    expect(getCacheStrategy(u("/setup"), "GET")).toBe("never");
    expect(getCacheStrategy(u("/setup/admin"), "GET")).toBe("never");
  });

  it("returns 'never' for unknown paths (GET) — default deny", () => {
    expect(getCacheStrategy(u("/random/page"), "GET")).toBe("never");
    expect(getCacheStrategy(u("/local"), "GET")).toBe("never");
  });
});
