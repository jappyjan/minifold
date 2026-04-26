// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTRPCContext,
  protectedProcedure,
  router,
} from "@/server/trpc/trpc";
import { __resetDatabase, getDatabase } from "@/server/db";
import { createUser } from "@/server/db/users";
import { createSession } from "@/server/auth/session";
import { SESSION_COOKIE } from "@/server/auth/cookies";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "minifold-trpc-ctx-"));
  process.env.DATABASE_PATH = join(tmp, "test.db");
  __resetDatabase();
});

afterEach(() => {
  __resetDatabase();
  delete process.env.DATABASE_PATH;
  rmSync(tmp, { recursive: true, force: true });
});

function makeRequest(cookieHeader?: string): Request {
  const headers = new Headers();
  if (cookieHeader) headers.set("cookie", cookieHeader);
  return new Request("http://localhost/api/trpc/health.check", { headers });
}

describe("createTRPCContext", () => {
  it("returns currentUser=null when no cookie is present", async () => {
    const ctx = await createTRPCContext({ req: makeRequest() });
    expect(ctx.currentUser).toBeNull();
  });

  it("returns currentUser when a valid session cookie is present", async () => {
    const db = getDatabase();
    const user = createUser(db, {
      name: "Alice",
      username: "alice",
      passwordHash: "x",
      role: "user",
      mustChangePassword: false,
    });
    const { token } = createSession(db, user.id);
    const ctx = await createTRPCContext({
      req: makeRequest(`${SESSION_COOKIE}=${token}`),
    });
    expect(ctx.currentUser?.id).toBe(user.id);
  });

  it("returns currentUser=null for an unknown token", async () => {
    const ctx = await createTRPCContext({
      req: makeRequest(`${SESSION_COOKIE}=not-a-real-token`),
    });
    expect(ctx.currentUser).toBeNull();
  });
});

describe("protectedProcedure", () => {
  it("throws UNAUTHORIZED when currentUser is null", async () => {
    const r = router({
      whoami: protectedProcedure.query(({ ctx }) => ctx.currentUser.id),
    });
    const caller = r.createCaller({ currentUser: null });
    await expect(caller.whoami()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("passes through when currentUser is set", async () => {
    const r = router({
      whoami: protectedProcedure.query(({ ctx }) => ctx.currentUser.id),
    });
    const fakeUser = {
      id: "user-1",
      name: "A",
      username: "a",
      password: "x",
      role: "user" as const,
      must_change_password: 0 as 0 | 1,
      deactivated: 0 as 0 | 1,
      created_at: 0,
      last_login: null,
    };
    const caller = r.createCaller({ currentUser: fakeUser });
    expect(await caller.whoami()).toBe("user-1");
  });
});
