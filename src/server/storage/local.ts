import {
  createReadStream,
  type Stats,
} from "node:fs";
import {
  mkdir,
  readdir,
  stat as statAsync,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import {
  NotFoundError,
  PathTraversalError,
  type Entry,
  type StorageProvider,
} from "./types";

type Options = {
  slug: string;
  rootPath: string;
};

export class LocalStorageProvider implements StorageProvider {
  readonly slug: string;
  private readonly rootPath: string;
  private readonly rootResolved: string;

  constructor(opts: Options) {
    this.slug = opts.slug;
    this.rootPath = opts.rootPath;
    this.rootResolved = resolve(opts.rootPath);
  }

  private resolveWithin(relative: string): string {
    const full = resolve(this.rootResolved, relative);
    if (full !== this.rootResolved && !full.startsWith(this.rootResolved + sep)) {
      throw new PathTraversalError(relative);
    }
    return full;
  }

  private static toEntry(name: string, stats: Stats): Entry {
    return {
      name,
      type: stats.isDirectory() ? "directory" : "file",
      size: stats.isDirectory() ? 0 : stats.size,
      modifiedAt: stats.mtime,
    };
  }

  async list(path: string): Promise<Entry[]> {
    const target = this.resolveWithin(path);
    let dirents;
    try {
      dirents = await readdir(target, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new NotFoundError(path);
      }
      throw err;
    }
    const entries: Entry[] = [];
    for (const d of dirents) {
      const childStats = await statAsync(resolve(target, d.name));
      entries.push(LocalStorageProvider.toEntry(d.name, childStats));
    }
    return entries;
  }

  async stat(path: string): Promise<Entry> {
    const target = this.resolveWithin(path);
    let stats;
    try {
      stats = await statAsync(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new NotFoundError(path);
      }
      throw err;
    }
    const name = target.slice(target.lastIndexOf(sep) + 1);
    return LocalStorageProvider.toEntry(name, stats);
  }

  async read(path: string): Promise<ReadableStream<Uint8Array>> {
    const target = this.resolveWithin(path);
    try {
      await statAsync(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new NotFoundError(path);
      }
      throw err;
    }
    const nodeStream = createReadStream(target);
    return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  }

  async write(path: string, data: Buffer): Promise<void> {
    const target = this.resolveWithin(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async exists(path: string): Promise<boolean> {
    try {
      const target = this.resolveWithin(path);
      await statAsync(target);
      return true;
    } catch {
      return false;
    }
  }
}
