export type Entry = {
  name: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: Date;
  etag?: string;
};

export interface StorageProvider {
  readonly slug: string;
  list(path: string): Promise<Entry[]>;
  stat(path: string): Promise<Entry>;
  read(path: string): Promise<ReadableStream<Uint8Array>>;
  write(path: string, data: Buffer): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export class PathTraversalError extends Error {
  constructor(attempted: string) {
    super(`Path escapes provider root: ${attempted}`);
    this.name = "PathTraversalError";
  }
}

export class NotFoundError extends Error {
  constructor(path: string) {
    super(`Not found: ${path}`);
    this.name = "NotFoundError";
  }
}
