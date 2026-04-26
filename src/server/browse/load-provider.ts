import { getDatabase } from "@/server/db";
import { findProviderBySlug } from "@/server/db/providers";
import { providerFromRow } from "@/server/storage/factory";
import type { StorageProvider } from "@/server/storage/types";

export function loadProvider(slug: string): StorageProvider | null {
  const row = findProviderBySlug(getDatabase(), slug);
  if (!row) return null;
  return providerFromRow(row);
}
