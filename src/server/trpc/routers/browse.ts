import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import { loadProvider } from "@/server/browse/load-provider";
import { computeDirHash } from "@/server/browse/dir-hash";
import { isHiddenEntry } from "@/server/browse/hidden";
import { sortEntries } from "@/server/browse/sort";
import { upsertDirCache } from "@/server/db/dir-cache";
import { getDatabase } from "@/server/db";
import {
  NotFoundError,
  PathTraversalError,
  type Entry,
} from "@/server/storage/types";
import { listWithCache } from "@/server/browse/list-cache";

export const browseRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        providerSlug: z.string().min(1),
        path: z.string(),
        knownHash: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const provider = loadProvider(input.providerSlug);
      if (!provider) throw new TRPCError({ code: "NOT_FOUND" });

      let raw: Entry[];
      try {
        raw = await listWithCache(provider, input.path);
      } catch (err) {
        if (err instanceof NotFoundError || err instanceof PathTraversalError) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        throw err;
      }

      const hash = computeDirHash(raw);
      const cacheKey = `${input.providerSlug}/${input.path}`;
      upsertDirCache(getDatabase(), cacheKey, hash, Date.now());

      if (input.knownHash === hash) {
        return { changed: false as const, hash };
      }

      const visible = sortEntries(raw.filter((e) => !isHiddenEntry(e.name)));
      return { changed: true as const, hash, entries: visible };
    }),
});
