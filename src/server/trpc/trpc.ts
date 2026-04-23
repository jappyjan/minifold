import { initTRPC } from "@trpc/server";
import superjson from "superjson";

// Future phases add fields (userId, db, request headers, etc.). Empty for now.
export type TRPCContext = Record<string, never>;

export async function createTRPCContext(): Promise<TRPCContext> {
  return {};
}

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
