import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { PathTraversalError, type Entry, type StorageProvider } from "./types";

type Options = {
  slug: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  forcePathStyle?: boolean;
};

export class S3StorageProvider implements StorageProvider {
  readonly slug: string;
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(opts: Options) {
    this.slug = opts.slug;
    this.bucket = opts.bucket;
    this.client = new S3Client({
      region: opts.region,
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      ...(opts.forcePathStyle ? { forcePathStyle: opts.forcePathStyle } : {}),
    });
  }

  /**
   * Normalizes a user-supplied path into an S3 prefix.
   * - Strips leading slashes
   * - Throws PathTraversalError if any segment is ".."
   * - Returns "" for root, "prints/" for "prints", etc.
   */
  private normalizePrefix(path: string): string {
    // Strip all leading slashes
    const stripped = path.replace(/^\/+/, "");

    if (stripped === "") {
      return "";
    }

    const segments = stripped.split("/").filter((s) => s.length > 0);

    for (const segment of segments) {
      if (segment === "..") {
        throw new PathTraversalError(path);
      }
    }

    return segments.join("/") + "/";
  }

  async list(path: string): Promise<Entry[]> {
    const prefix = this.normalizePrefix(path);
    const entries: Entry[] = [];
    let continuationToken: string | undefined = undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        Delimiter: "/",
        ContinuationToken: continuationToken,
      });

      const resp = await this.client.send(command);

      // Directory entries from CommonPrefixes
      for (const cp of resp.CommonPrefixes ?? []) {
        if (!cp.Prefix) continue;
        // e.g. "prints/sub/" with prefix "prints/" → name = "sub"
        const withoutPrefix = cp.Prefix.slice(prefix.length);
        const name = withoutPrefix.replace(/\/$/, "");
        if (!name) continue;
        entries.push({
          name,
          type: "directory",
          size: 0,
          modifiedAt: new Date(0),
        });
      }

      // File entries from Contents
      for (const obj of resp.Contents ?? []) {
        if (!obj.Key) continue;
        // Skip directory marker (key equals prefix exactly)
        if (obj.Key === prefix) continue;
        const name = obj.Key.slice(prefix.length);
        if (!name) continue;
        const rawEtag = obj.ETag;
        const etag = rawEtag ? rawEtag.replace(/^"|"$/g, "") : undefined;
        entries.push({
          name,
          type: "file",
          size: obj.Size ?? 0,
          modifiedAt: obj.LastModified ?? new Date(0),
          ...(etag !== undefined ? { etag } : {}),
        });
      }

      continuationToken = resp.IsTruncated
        ? resp.NextContinuationToken
        : undefined;
    } while (continuationToken !== undefined);

    return entries;
  }

  async stat(_path: string): Promise<Entry> {
    throw new Error("not implemented");
  }

  async read(_path: string): Promise<ReadableStream<Uint8Array>> {
    throw new Error("not implemented");
  }

  async write(_path: string, _data: Buffer): Promise<void> {
    throw new Error("not implemented");
  }

  async exists(_path: string): Promise<boolean> {
    throw new Error("not implemented");
  }
}
