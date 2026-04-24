import type { ProviderRow } from "@/server/db/providers";
import { LocalStorageProvider } from "./local";
import type { StorageProvider } from "./types";

export function providerFromRow(row: ProviderRow): StorageProvider {
  switch (row.type) {
    case "local":
      return new LocalStorageProvider({
        slug: row.slug,
        rootPath: (row.config as { rootPath: string }).rootPath,
      });
    case "s3":
      throw new Error("s3 provider not yet implemented (Phase 3.5)");
    default: {
      const exhaustive: never = row.type;
      throw new Error(`Unknown provider type: ${String(exhaustive)}`);
    }
  }
}
