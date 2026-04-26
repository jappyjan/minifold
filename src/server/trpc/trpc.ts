import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { UserRow } from "@/server/db/users";
import { getDatabase } from "@/server/db";
import { validateSession } from "@/server/auth/session";
import { SESSION_COOKIE } from "@/server/auth/session-constants";

export type TRPCContext = {
  currentUser: UserRow | null;
};

export async function createTRPCContext(opts?: {
  req?: Request;
}): Promise<TRPCContext> {
  const cookieHeader = opts?.req?.headers.get("cookie") ?? "";
  const token = parseCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return { currentUser: null };
  const result = validateSession(getDatabase(), token);
  return { currentUser: result?.user ?? null };
}

function parseCookie(header: string, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.currentUser) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, currentUser: ctx.currentUser } });
});
