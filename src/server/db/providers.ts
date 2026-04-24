import type { Database } from "better-sqlite3";
import { decryptJSON, encryptJSON } from "@/server/auth/encryption";

export type ProviderType = "local" | "s3";

export type LocalConfig = {
  rootPath: string;
};

export type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  pathStyle: boolean;
};

export type ProviderConfig = LocalConfig | S3Config;

export type ProviderRow = {
  slug: string;
  name: string;
  type: ProviderType;
  config: ProviderConfig;
  position: number;
  created_at: number;
};

type RawRow = Omit<ProviderRow, "config"> & { config: string };

export type NewProvider = {
  slug: string;
  name: string;
  type: ProviderType;
  config: ProviderConfig;
};

function decodeRow(db: Database, raw: RawRow): ProviderRow {
  return {
    ...raw,
    config: decryptJSON<ProviderConfig>(db, raw.config),
  };
}

export function hasAnyProvider(db: Database): boolean {
  return db.prepare("SELECT 1 FROM providers LIMIT 1").get() !== undefined;
}

export function createProvider(db: Database, input: NewProvider): ProviderRow {
  const slug = input.slug.toLowerCase();
  const encrypted = encryptJSON(db, input.config);
  const now = Date.now();
  db.prepare(
    `INSERT INTO providers (slug, name, type, config, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(slug, input.name, input.type, encrypted, 0, now);
  const found = findProviderBySlug(db, slug);
  if (!found) throw new Error("createProvider: inserted row not found");
  return found;
}

export function findProviderBySlug(db: Database, slug: string): ProviderRow | null {
  const raw = db
    .prepare("SELECT * FROM providers WHERE slug = ?")
    .get(slug.toLowerCase()) as RawRow | undefined;
  return raw ? decodeRow(db, raw) : null;
}

export function listProviders(db: Database): ProviderRow[] {
  const rows = db
    .prepare("SELECT * FROM providers ORDER BY position ASC, created_at ASC")
    .all() as RawRow[];
  return rows.map((r) => decodeRow(db, r));
}

export function updateProviderPosition(
  db: Database,
  slug: string,
  position: number,
): void {
  db.prepare("UPDATE providers SET position = ? WHERE slug = ?").run(position, slug);
}

export function deleteProvider(db: Database, slug: string): void {
  db.prepare("DELETE FROM providers WHERE slug = ?").run(slug);
}
