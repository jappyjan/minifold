import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../trpc";
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
import { findProviderBySlug } from "@/server/db/providers";
import { providerFromRow } from "@/server/storage/factory";
import { createAccessResolver } from "@/server/access/resolver";
import { getGlobalDefaultAccess } from "@/server/access/global-default";

export const browseRouter = router({
  list: publicProcedure
    .input(
      z.object({
        providerSlug: z.string().min(1),
        path: z.string(),
        knownHash: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const db = getDatabase();
      const row = findProviderBySlug(db, input.providerSlug);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const provider = providerFromRow(row);

      const config = row.config as { defaultAccess?: "public" | "signed-in" };
      const resolver = createAccessResolver({
        user: ctx.currentUser,
        storage: provider,
        providerDefault: config.defaultAccess,
        globalDefault: getGlobalDefaultAccess(db),
      });

      // Gate the directory itself first — if user can't see it, behave as 404.
      const dirDecision = await resolver.resolve(input.path, "directory");
      if (dirDecision !== "allow") {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

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
      upsertDirCache(db, cacheKey, hash, Date.now());

      if (input.knownHash === hash) {
        return { changed: false as const, hash };
      }

      const visibleAfterHidden = raw.filter((e) => !isHiddenEntry(e.name));
      const allowed: Entry[] = [];
      for (const entry of visibleAfterHidden) {
        const child =
          input.path === "" ? entry.name : `${input.path}/${entry.name}`;
        const decision = await resolver.resolve(child, entry.type);
        if (decision === "allow") allowed.push(entry);
      }

      const sorted = sortEntries(allowed);
      return { changed: true as const, hash, entries: sorted };
    }),
});
