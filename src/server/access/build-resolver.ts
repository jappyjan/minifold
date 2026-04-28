import { getDatabase } from "@/server/db";
import { findProviderBySlug } from "@/server/db/providers";
import { providerFromRow } from "@/server/storage/factory";
import type { UserRow } from "@/server/db/users";
import { createAccessResolver, type Resolver } from "./resolver";
import { getGlobalDefaultAccess } from "./global-default";

type Args = {
  user: UserRow | null;
  providerSlug: string;
};

export function buildResolverForRequest({ user, providerSlug }: Args): Resolver | null {
  const db = getDatabase();
  const row = findProviderBySlug(db, providerSlug);
  if (!row) return null;
  const storage = providerFromRow(row);
  const config = row.config as { defaultAccess?: "public" | "signed-in" };
  const providerDefault = config.defaultAccess;
  const globalDefault = getGlobalDefaultAccess(db);
  return createAccessResolver({ user, storage, providerDefault, globalDefault });
}
