import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import {
  PathTraversalError,
  NotFoundError,
  type Entry,
  type StorageProvider,
} from "./types";

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
   * Normalizes a user-supplied path into an S3 key (no trailing slash).
   * Used by read and write.
   */
  private normalizeKey(path: string): string {
    const stripped = path.replace(/^\/+/, "");
    if (stripped === "") {
      throw new NotFoundError(path);
    }
    const segments = stripped.split("/").filter((s) => s.length > 0);
    for (const segment of segments) {
      if (segment === "..") {
        throw new PathTraversalError(path);
      }
    }
    return segments.join("/");
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
      const command: ListObjectsV2Command = new ListObjectsV2Command({
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

  async stat(path: string): Promise<Entry> {
    // Guard traversal (normalizePrefix will throw PathTraversalError for "..")
    // We need to derive the S3 key (no trailing slash) and the prefix for dir probe
    const stripped = path.replace(/^\/+/, "");
    const segments = stripped === "" ? [] : stripped.split("/").filter((s) => s.length > 0);
    for (const segment of segments) {
      if (segment === "..") {
        throw new PathTraversalError(path);
      }
    }

    const key = segments.join("/"); // e.g. "prints/anchor.stl" or "prints"
    const name = segments[segments.length - 1] ?? "";

    // Try HeadObject first (file probe)
    try {
      const resp = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const rawEtag = resp.ETag;
      const etag = rawEtag ? rawEtag.replace(/^"|"$/g, "") : undefined;
      return {
        name,
        type: "file",
        size: resp.ContentLength ?? 0,
        modifiedAt: resp.LastModified ?? new Date(0),
        ...(etag !== undefined ? { etag } : {}),
      };
    } catch (err: unknown) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      const is404 =
        e.$metadata?.httpStatusCode === 404 ||
        e.name === "NoSuchKey" ||
        e.name === "NotFound";
      if (!is404) throw err;
    }

    // HeadObject returned 404 — probe for directory via ListObjectsV2
    const prefix = key === "" ? "" : key + "/";
    const listResp = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: 1,
      }),
    );

    const hasContent =
      (listResp.Contents && listResp.Contents.length > 0) ||
      (listResp.CommonPrefixes && listResp.CommonPrefixes.length > 0);

    if (hasContent) {
      return {
        name,
        type: "directory",
        size: 0,
        modifiedAt: new Date(0),
      };
    }

    throw new NotFoundError(path);
  }

  async read(path: string): Promise<ReadableStream<Uint8Array>> {
    const key = this.normalizeKey(path);
    try {
      const resp = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!resp.Body) throw new NotFoundError(path);
      return Readable.toWeb(resp.Body as Readable) as ReadableStream<Uint8Array>;
    } catch (err: unknown) {
      if (err instanceof NotFoundError) throw err;
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      const is404 =
        e.$metadata?.httpStatusCode === 404 ||
        e.name === "NoSuchKey" ||
        e.name === "NotFound";
      if (is404) throw new NotFoundError(path);
      throw err;
    }
  }

  async write(path: string, data: Buffer): Promise<void> {
    const key = this.normalizeKey(path);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentLength: data.length,
      }),
    );
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch (err: unknown) {
      if (err instanceof NotFoundError) return false;
      throw err;
    }
  }
}
