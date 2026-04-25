import type { ProviderRow } from "@/server/db/providers";
import { LocalStorageProvider } from "./local";
import { S3StorageProvider } from "./s3";
import type { StorageProvider } from "./types";

export function providerFromRow(row: ProviderRow): StorageProvider {
  switch (row.type) {
    case "local":
      return new LocalStorageProvider({
        slug: row.slug,
        rootPath: (row.config as { rootPath: string }).rootPath,
      });
    case "s3": {
      const c = row.config as {
        bucket: string;
        region: string;
        accessKeyId: string;
        secretAccessKey: string;
        endpoint?: string;
        pathStyle?: boolean;
      };
      return new S3StorageProvider({
        slug: row.slug,
        bucket: c.bucket,
        region: c.region,
        accessKeyId: c.accessKeyId,
        secretAccessKey: c.secretAccessKey,
        endpoint: c.endpoint,
        forcePathStyle: c.pathStyle,
      });
    }
    default: {
      const exhaustive: never = row.type;
      throw new Error(`Unknown provider type: ${String(exhaustive)}`);
    }
  }
}
