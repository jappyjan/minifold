# Phase 3.5 — Storage Providers (S3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [2026-04-23-minifold-design.md](../specs/2026-04-23-minifold-design.md) §4 (Storage Providers — S3 implementation).

**Goal:** Add `S3StorageProvider` as a second implementation of the existing `StorageProvider` interface (defined in Phase 3). After this phase, operators can configure local-FS *or* S3-compatible providers. The provider factory dispatches to the right implementation; the CLI's `add-provider` accepts `--type s3` with the necessary credentials.

**Architecture:** A new `S3StorageProvider` class in `src/server/storage/s3.ts` wraps `@aws-sdk/client-s3@v3`. Configurable via `endpoint` (for non-AWS S3-compatible like MinIO/Backblaze B2/Wasabi/Cloudflare R2), `bucket`, `region`, `accessKeyId`, `secretAccessKey`, `pathStyle`. Directories are synthesized from S3 key prefixes (S3 has no real directories): `list("foo")` issues a `ListObjectsV2` with `Prefix="foo/"` and `Delimiter="/"`, mapping `Contents` → file entries and `CommonPrefixes` → directory entries. `read()` returns the AWS SDK's `Body` (already a `ReadableStream<Uint8Array>` in modern SDK v3). Path inputs are normalized (leading `/` stripped, `..` rejected as `PathTraversalError`) so behavior is symmetric with `LocalStorageProvider`. Tests use `aws-sdk-client-mock` to stub the S3 client — no live S3 in CI.

**Tech Stack:**
- `@aws-sdk/client-s3@^3` — official AWS SDK v3, modular and tree-shakable
- `@aws-sdk/lib-storage` — NOT pulled in this phase; PutObject of a Buffer is sufficient
- `aws-sdk-client-mock@^4` (devDependency) — canonical mocking lib for SDK v3
- Existing: better-sqlite3 (encrypted config), Vitest, the Phase 3 `StorageProvider` interface

**Out of scope (deferred):**
- Wizard step 2 type-selector (admin still creates first provider as local; S3 first-provider via CLI). The full type picker lands in Phase 8's admin UI.
- Multipart upload — Phase 3 doesn't write large files via the interface; if Phase 5's thumbnails ever exceed S3's single-PUT limit (5 GiB) we'll revisit with `lib-storage`.
- Presigned URLs — read currently streams via the server. Direct browser→S3 streaming is a future optimization.
- AWS region resolution from environment — region is required in the provider config (operators set it explicitly).

---

## File Structure

```
minifold/
  src/
    server/
      storage/
        s3.ts                         # NEW: S3StorageProvider
        factory.ts                    # MODIFIED: route type=s3 to S3StorageProvider
  bin/
    cli.mjs                           # MODIFIED: add-provider --type s3 with S3 flags
  tests/
    server/
      storage/
        s3.test.ts                    # NEW
        factory.test.ts               # MODIFIED: replace s3-throws case with s3-returns-instance
    bin/
      cli.test.ts                     # MODIFIED: extend with s3 add-provider cases
```

---

## Task 1: Install AWS SDK v3 + mock library

**Files:** `package.json` (via pnpm).

- [ ] **Step 1: Install runtime + dev deps**

```bash
pnpm add @aws-sdk/client-s3@^3
pnpm add -D aws-sdk-client-mock@^4
```

- [ ] **Step 2: Verify clean baseline**

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all green; baseline is 21 test files / 120 tests from Phase 3.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat: add @aws-sdk/client-s3 + aws-sdk-client-mock for S3 provider"
```

**Notes:**
- `@aws-sdk/client-s3` v3 is modular (~50KB tree-shaken). It pulls a few transitive deps (`@smithy/*`, `@aws-sdk/credential-provider-node`, etc.) — that's expected.
- If `aws-sdk-client-mock` resolves to v5+ at install time, accept the new major; the `mockClient`/`.on(Cmd).resolves()` API is stable across versions. Document the resolved version in the commit message.

---

## Task 2: S3StorageProvider — list (TDD)

**Files:** `src/server/storage/s3.ts`, `tests/server/storage/s3.test.ts`.

We'll build the class incrementally — one method per task — to keep each commit focused. This task adds the class skeleton, the `list()` method, and the path-traversal guard.

- [ ] **Step 1: Write the failing test**

Create `tests/server/storage/s3.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { S3StorageProvider } from "@/server/storage/s3";
import { PathTraversalError } from "@/server/storage/types";

const s3Mock = mockClient(S3Client);

beforeEach(() => {
  s3Mock.reset();
});

afterEach(() => {
  s3Mock.reset();
});

function newProvider() {
  return new S3StorageProvider({
    slug: "s3",
    bucket: "my-bucket",
    region: "us-east-1",
    accessKeyId: "AKIA",
    secretAccessKey: "SECRET",
    endpoint: "https://s3.example.com",
    pathStyle: true,
  });
}

describe("S3StorageProvider.list", () => {
  it("returns files (Contents) and directories (CommonPrefixes) at the root", async () => {
    s3Mock
      .on(ListObjectsV2Command, {
        Bucket: "my-bucket",
        Prefix: "",
        Delimiter: "/",
      })
      .resolves({
        Contents: [
          { Key: "hello.md", Size: 4, LastModified: new Date("2026-01-01"), ETag: '"abc"' },
        ],
        CommonPrefixes: [{ Prefix: "prints/" }],
      });

    const entries = await newProvider().list("");
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["hello.md", "prints"]);

    const file = entries.find((e) => e.name === "hello.md")!;
    expect(file.type).toBe("file");
    expect(file.size).toBe(4);
    expect(file.modifiedAt).toEqual(new Date("2026-01-01"));
    expect(file.etag).toBe('"abc"');

    const dir = entries.find((e) => e.name === "prints")!;
    expect(dir.type).toBe("directory");
    expect(dir.size).toBe(0);
  });

  it("lists a nested directory", async () => {
    s3Mock
      .on(ListObjectsV2Command, {
        Bucket: "my-bucket",
        Prefix: "prints/",
        Delimiter: "/",
      })
      .resolves({
        Contents: [
          { Key: "prints/anchor.stl", Size: 4, LastModified: new Date("2026-01-02"), ETag: '"x"' },
        ],
        CommonPrefixes: [{ Prefix: "prints/sub/" }],
      });

    const entries = await newProvider().list("prints");
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["anchor.stl", "sub"]);
  });

  it("handles paginated results (IsTruncated)", async () => {
    s3Mock
      .on(ListObjectsV2Command, {
        Bucket: "my-bucket",
        Prefix: "",
        Delimiter: "/",
        ContinuationToken: undefined,
      })
      .resolves({
        Contents: [
          { Key: "a.md", Size: 1, LastModified: new Date("2026-01-01"), ETag: '"1"' },
        ],
        IsTruncated: true,
        NextContinuationToken: "page-2",
      });
    s3Mock
      .on(ListObjectsV2Command, {
        Bucket: "my-bucket",
        Prefix: "",
        Delimiter: "/",
        ContinuationToken: "page-2",
      })
      .resolves({
        Contents: [
          { Key: "b.md", Size: 2, LastModified: new Date("2026-01-02"), ETag: '"2"' },
        ],
        IsTruncated: false,
      });

    const entries = await newProvider().list("");
    expect(entries.map((e) => e.name).sort()).toEqual(["a.md", "b.md"]);
  });

  it("returns an empty array for an empty prefix", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({});
    const entries = await newProvider().list("empty");
    expect(entries).toEqual([]);
  });

  it("blocks path traversal via ..", async () => {
    await expect(newProvider().list("../../../etc")).rejects.toBeInstanceOf(
      PathTraversalError,
    );
  });

  it("strips a leading slash so /foo and foo behave the same", async () => {
    s3Mock
      .on(ListObjectsV2Command, {
        Bucket: "my-bucket",
        Prefix: "foo/",
        Delimiter: "/",
      })
      .resolves({
        Contents: [
          { Key: "foo/x.md", Size: 1, LastModified: new Date("2026-01-01"), ETag: '"1"' },
        ],
      });
    const entries = await newProvider().list("/foo");
    expect(entries.map((e) => e.name)).toEqual(["x.md"]);
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/server/storage/s3.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation skeleton + list**

Create `src/server/storage/s3.ts`:

```ts
import {
  ListObjectsV2Command,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import {
  PathTraversalError,
  type Entry,
  type StorageProvider,
} from "./types";

export type S3Options = {
  slug: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  pathStyle?: boolean;
};

function normalizeKeyPrefix(input: string): string {
  let p = input;
  while (p.startsWith("/")) p = p.slice(1);
  // Reject any segment that traverses up.
  for (const seg of p.split("/")) {
    if (seg === "..") throw new PathTraversalError(input);
  }
  return p;
}

function dirPrefix(p: string): string {
  if (p === "") return "";
  return p.endsWith("/") ? p : `${p}/`;
}

function nameFromKey(key: string, parent: string): string {
  const after = key.startsWith(parent) ? key.slice(parent.length) : key;
  // Strip trailing slash for directory-like keys.
  return after.replace(/\/$/, "");
}

export class S3StorageProvider implements StorageProvider {
  readonly slug: string;
  protected readonly bucket: string;
  protected readonly client: S3Client;

  constructor(opts: S3Options) {
    this.slug = opts.slug;
    this.bucket = opts.bucket;
    const config: S3ClientConfig = {
      region: opts.region,
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
      forcePathStyle: opts.pathStyle ?? false,
    };
    if (opts.endpoint) config.endpoint = opts.endpoint;
    this.client = new S3Client(config);
  }

  async list(path: string): Promise<Entry[]> {
    const prefix = dirPrefix(normalizeKeyPrefix(path));
    const entries: Entry[] = [];
    let continuationToken: string | undefined = undefined;

    do {
      const out = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          Delimiter: "/",
          ContinuationToken: continuationToken,
        }),
      );

      for (const obj of out.Contents ?? []) {
        if (!obj.Key || obj.Key === prefix) continue; // skip self-prefix marker
        entries.push({
          name: nameFromKey(obj.Key, prefix),
          type: "file",
          size: obj.Size ?? 0,
          modifiedAt: obj.LastModified ?? new Date(0),
          etag: obj.ETag,
        });
      }

      for (const cp of out.CommonPrefixes ?? []) {
        if (!cp.Prefix) continue;
        entries.push({
          name: nameFromKey(cp.Prefix, prefix),
          type: "directory",
          size: 0,
          modifiedAt: new Date(0),
        });
      }

      continuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (continuationToken);

    return entries;
  }

  // stat / read / write / exists added in subsequent tasks
  async stat(_path: string): Promise<Entry> {
    throw new Error("S3StorageProvider.stat: not yet implemented");
  }
  async read(_path: string): Promise<ReadableStream<Uint8Array>> {
    throw new Error("S3StorageProvider.read: not yet implemented");
  }
  async write(_path: string, _data: Buffer): Promise<void> {
    throw new Error("S3StorageProvider.write: not yet implemented");
  }
  async exists(_path: string): Promise<boolean> {
    throw new Error("S3StorageProvider.exists: not yet implemented");
  }
}
```

- [ ] **Step 4: Run test**

```bash
pnpm test tests/server/storage/s3.test.ts
```

Expected: 6 list-tests pass.

- [ ] **Step 5: Sweep + commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add src/server/storage/s3.ts tests/server/storage/s3.test.ts
git commit -m "feat(storage): add S3StorageProvider.list with pagination + traversal guard"
```

---

## Task 3: S3StorageProvider — stat + exists (TDD)

**Files:** modify `src/server/storage/s3.ts`, extend `tests/server/storage/s3.test.ts`.

`stat` uses `HeadObject` for files, falls back to a prefix probe for directories.
`exists` is `stat` that returns boolean.

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/storage/s3.test.ts`:

```ts
import {
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { NotFoundError } from "@/server/storage/types";

describe("S3StorageProvider.stat", () => {
  it("returns file metadata via HeadObject", async () => {
    s3Mock
      .on(HeadObjectCommand, { Bucket: "my-bucket", Key: "prints/anchor.stl" })
      .resolves({
        ContentLength: 1024,
        LastModified: new Date("2026-01-03"),
        ETag: '"a1b2"',
      });

    const entry = await newProvider().stat("prints/anchor.stl");
    expect(entry.name).toBe("anchor.stl");
    expect(entry.type).toBe("file");
    expect(entry.size).toBe(1024);
    expect(entry.modifiedAt).toEqual(new Date("2026-01-03"));
    expect(entry.etag).toBe('"a1b2"');
  });

  it("returns directory metadata when Head404s but objects exist under the prefix", async () => {
    s3Mock
      .on(HeadObjectCommand, { Bucket: "my-bucket", Key: "prints" })
      .rejects({ name: "NotFound", $metadata: { httpStatusCode: 404 } });
    s3Mock
      .on(ListObjectsV2Command, {
        Bucket: "my-bucket",
        Prefix: "prints/",
        MaxKeys: 1,
      })
      .resolves({
        KeyCount: 1,
        Contents: [
          { Key: "prints/anchor.stl", Size: 4, LastModified: new Date("2026-01-04"), ETag: '"x"' },
        ],
      });

    const entry = await newProvider().stat("prints");
    expect(entry.name).toBe("prints");
    expect(entry.type).toBe("directory");
    expect(entry.size).toBe(0);
  });

  it("throws NotFoundError when neither object nor prefix exists", async () => {
    s3Mock
      .on(HeadObjectCommand)
      .rejects({ name: "NotFound", $metadata: { httpStatusCode: 404 } });
    s3Mock.on(ListObjectsV2Command).resolves({ KeyCount: 0 });

    await expect(newProvider().stat("missing")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("blocks traversal via ..", async () => {
    await expect(newProvider().stat("../etc")).rejects.toBeInstanceOf(
      PathTraversalError,
    );
  });
});

describe("S3StorageProvider.exists", () => {
  it("returns true for an existing file", async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 1, LastModified: new Date() });
    expect(await newProvider().exists("hello.md")).toBe(true);
  });

  it("returns true for an existing directory (key+'/' has objects)", async () => {
    s3Mock
      .on(HeadObjectCommand)
      .rejects({ name: "NotFound", $metadata: { httpStatusCode: 404 } });
    s3Mock
      .on(ListObjectsV2Command)
      .resolves({ KeyCount: 1, Contents: [{ Key: "prints/x.stl" }] });
    expect(await newProvider().exists("prints")).toBe(true);
  });

  it("returns false for missing path", async () => {
    s3Mock
      .on(HeadObjectCommand)
      .rejects({ name: "NotFound", $metadata: { httpStatusCode: 404 } });
    s3Mock.on(ListObjectsV2Command).resolves({ KeyCount: 0 });
    expect(await newProvider().exists("nope")).toBe(false);
  });

  it("returns false for traversal attempts (no leak)", async () => {
    expect(await newProvider().exists("../etc/passwd")).toBe(false);
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/server/storage/s3.test.ts
```

Expected: 9 new failures (the previously-stubbed methods throw "not yet implemented").

- [ ] **Step 3: Implement stat + exists**

In `src/server/storage/s3.ts`, replace the stub `stat` and `exists` with:

```ts
  async stat(path: string): Promise<Entry> {
    const key = normalizeKeyPrefix(path);
    if (key === "") {
      // Bucket root is conceptually a directory.
      return {
        name: "",
        type: "directory",
        size: 0,
        modifiedAt: new Date(0),
      };
    }

    // Try HeadObject for an exact file match.
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const lastSlash = key.lastIndexOf("/");
      const name = lastSlash >= 0 ? key.slice(lastSlash + 1) : key;
      return {
        name,
        type: "file",
        size: head.ContentLength ?? 0,
        modifiedAt: head.LastModified ?? new Date(0),
        etag: head.ETag,
      };
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }

    // Fall back to a directory probe.
    const out = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: dirPrefix(key),
        MaxKeys: 1,
      }),
    );
    if ((out.KeyCount ?? 0) > 0) {
      const lastSlash = key.lastIndexOf("/");
      const name = lastSlash >= 0 ? key.slice(lastSlash + 1) : key;
      return {
        name,
        type: "directory",
        size: 0,
        modifiedAt: new Date(0),
      };
    }

    throw new NotFoundError(path);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch {
      return false;
    }
  }
```

Add at the top of the file (alongside `dirPrefix`/`nameFromKey`):

```ts
function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
    Code?: string;
  };
  if (e.name === "NotFound" || e.name === "NoSuchKey") return true;
  if (e.Code === "NoSuchKey" || e.Code === "NotFound") return true;
  return e.$metadata?.httpStatusCode === 404;
}
```

Add to imports:
```ts
import {
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import {
  NotFoundError,
  PathTraversalError,
  type Entry,
  type StorageProvider,
} from "./types";
```

- [ ] **Step 4: Run test**

```bash
pnpm test tests/server/storage/s3.test.ts
```

Expected: 15 total tests passing in this file (6 list + 4 stat + 4 exists + 1 stat-traversal already counted).

- [ ] **Step 5: Sweep + commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add src/server/storage/s3.ts tests/server/storage/s3.test.ts
git commit -m "feat(storage): add S3StorageProvider.stat + exists (file or prefix)"
```

---

## Task 4: S3StorageProvider — read + write (TDD)

**Files:** modify `src/server/storage/s3.ts`, extend `tests/server/storage/s3.test.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/storage/s3.test.ts`:

```ts
import {
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

function streamFromBuffer(buf: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(buf);
      controller.close();
    },
  });
}

describe("S3StorageProvider.read", () => {
  it("returns a stream of the object body", async () => {
    s3Mock
      .on(GetObjectCommand, { Bucket: "my-bucket", Key: "hello.md" })
      .resolves({
        Body: streamFromBuffer(Buffer.from("hello, world")) as unknown as never,
        ContentLength: 12,
        LastModified: new Date(),
      });

    const stream = await newProvider().read("hello.md");
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const total = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    expect(total.toString("utf8")).toBe("hello, world");
  });

  it("throws NotFoundError when GetObject 404s", async () => {
    s3Mock
      .on(GetObjectCommand)
      .rejects({ name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });

    await expect(newProvider().read("missing")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("blocks traversal", async () => {
    await expect(newProvider().read("../etc/passwd")).rejects.toBeInstanceOf(
      PathTraversalError,
    );
  });
});

describe("S3StorageProvider.write", () => {
  it("PutObject is called with the key and body", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    await newProvider().write("new.txt", Buffer.from("hello"));

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0]!.args[0].input;
    expect(input.Bucket).toBe("my-bucket");
    expect(input.Key).toBe("new.txt");
    // Body is a Buffer here; just verify length.
    const body = input.Body as Buffer;
    expect(body.toString("utf8")).toBe("hello");
  });

  it("blocks traversal", async () => {
    await expect(
      newProvider().write("../outside.txt", Buffer.from("x")),
    ).rejects.toBeInstanceOf(PathTraversalError);
  });

  it("strips a leading slash before sending", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    await newProvider().write("/foo/bar.txt", Buffer.from("ok"));
    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls[0]!.args[0].input.Key).toBe("foo/bar.txt");
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/server/storage/s3.test.ts
```

Expected: 6 new failures.

- [ ] **Step 3: Implement read + write**

Replace the stub `read` and `write` in `src/server/storage/s3.ts`:

```ts
  async read(path: string): Promise<ReadableStream<Uint8Array>> {
    const key = normalizeKeyPrefix(path);
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = out.Body;
      if (!body) throw new NotFoundError(path);
      // SDK v3's Body in Node is an SdkStream<Readable> which exposes
      // .transformToWebStream(). In tests we may pass a ReadableStream
      // directly — accept either.
      if (typeof (body as { transformToWebStream?: unknown }).transformToWebStream === "function") {
        return (body as { transformToWebStream: () => ReadableStream<Uint8Array> }).transformToWebStream();
      }
      return body as unknown as ReadableStream<Uint8Array>;
    } catch (err) {
      if (isNotFound(err)) throw new NotFoundError(path);
      throw err;
    }
  }

  async write(path: string, data: Buffer): Promise<void> {
    const key = normalizeKeyPrefix(path);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
      }),
    );
  }
```

Add to imports:
```ts
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
```

- [ ] **Step 4: Run + sweep**

```bash
pnpm test tests/server/storage/s3.test.ts
pnpm typecheck && pnpm lint && pnpm test
```

Expected: 21 tests in `s3.test.ts` (6 list + 4 stat + 4 exists + 7 read/write).

- [ ] **Step 5: Commit**

```bash
git add src/server/storage/s3.ts tests/server/storage/s3.test.ts
git commit -m "feat(storage): add S3StorageProvider.read + write"
```

---

## Task 5: Update factory to construct S3 providers

**Files:** modify `src/server/storage/factory.ts`, modify `tests/server/storage/factory.test.ts`.

- [ ] **Step 1: Update the factory test**

Replace the contents of `tests/server/storage/factory.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { providerFromRow } from "@/server/storage/factory";
import { LocalStorageProvider } from "@/server/storage/local";
import { S3StorageProvider } from "@/server/storage/s3";

describe("providerFromRow", () => {
  it("returns a LocalStorageProvider for type=local", () => {
    const p = providerFromRow({
      slug: "nas",
      name: "NAS",
      type: "local",
      config: { rootPath: "/tmp" },
      position: 0,
      created_at: Date.now(),
    });
    expect(p).toBeInstanceOf(LocalStorageProvider);
    expect(p.slug).toBe("nas");
  });

  it("returns an S3StorageProvider for type=s3", () => {
    const p = providerFromRow({
      slug: "backups",
      name: "Backups",
      type: "s3",
      config: {
        endpoint: "https://s3.example.com",
        bucket: "my-bucket",
        region: "us-east-1",
        accessKeyId: "AKIA",
        secretAccessKey: "SECRET",
        pathStyle: true,
      },
      position: 0,
      created_at: Date.now(),
    });
    expect(p).toBeInstanceOf(S3StorageProvider);
    expect(p.slug).toBe("backups");
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/server/storage/factory.test.ts
```

Expected: the s3 case fails because the factory still throws.

- [ ] **Step 3: Update the factory**

Replace `src/server/storage/factory.ts`:

```ts
import type { ProviderRow, S3Config } from "@/server/db/providers";
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
      const cfg = row.config as S3Config;
      return new S3StorageProvider({
        slug: row.slug,
        bucket: cfg.bucket,
        region: cfg.region,
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        endpoint: cfg.endpoint,
        pathStyle: cfg.pathStyle,
      });
    }
    default: {
      const exhaustive: never = row.type;
      throw new Error(`Unknown provider type: ${String(exhaustive)}`);
    }
  }
}
```

- [ ] **Step 4: Run + sweep + commit**

```bash
pnpm test tests/server/storage/factory.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add src/server/storage/factory.ts tests/server/storage/factory.test.ts
git commit -m "feat(storage): factory dispatches type=s3 to S3StorageProvider"
```

---

## Task 6: CLI — `add-provider --type s3`

**Files:** modify `bin/cli.mjs`, extend `tests/bin/cli.test.ts`.

S3 add requires: `--bucket`, `--region`, `--access-key-id`, `--secret-access-key`. Optional: `--endpoint`, `--path-style`. Slug stays optional (auto-generated from name).

- [ ] **Step 1: Extend the CLI test**

Open `tests/bin/cli.test.ts`. Inside the existing `describe("minifold CLI — providers", …)` block, append:

```ts
  it("add-provider --type s3 stores the provider with all credentials encrypted", () => {
    const r = run([
      "add-provider",
      "--type",
      "s3",
      "--name",
      "Backups",
      "--bucket",
      "my-backups",
      "--region",
      "us-east-1",
      "--access-key-id",
      "AKIA",
      "--secret-access-key",
      "TOPSECRET-MARKER",
      "--endpoint",
      "https://s3.example.com",
      "--path-style",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/added provider/i);

    const listed = run(["list-providers"]);
    expect(listed.stdout).toContain("backups");
    expect(listed.stdout).toContain("Backups");
    expect(listed.stdout).toContain("s3");

    // Verify the secret never appears as plaintext in the raw DB row.
    const dump = spawnSync(
      "sqlite3",
      [dbPath, "SELECT config FROM providers WHERE slug = 'backups'"],
      { encoding: "utf8" },
    );
    expect(dump.stdout).not.toContain("TOPSECRET-MARKER");
    expect(dump.stdout).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+/);
  });

  it("add-provider --type s3 requires bucket / region / access-key-id / secret-access-key", () => {
    const partial = run([
      "add-provider",
      "--type",
      "s3",
      "--name",
      "Backups",
      "--bucket",
      "my-backups",
      "--region",
      "us-east-1",
      // no access keys
    ]);
    expect(partial.status).not.toBe(0);
    expect(partial.stderr.toLowerCase()).toMatch(/access-key|secret/);
  });

  it("add-provider with --type local does not require S3 flags", () => {
    const r = run([
      "add-provider",
      "--type",
      "local",
      "--name",
      "NAS",
      "--root-path",
      "/files",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/added provider/i);
  });

  it("add-provider rejects --type s3 with --root-path (wrong type)", () => {
    const r = run([
      "add-provider",
      "--type",
      "s3",
      "--name",
      "Confused",
      "--root-path",
      "/files",
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain("--root-path");
  });
```

The test references the existing `dbPath` and `spawnSync` from earlier in the file; if they aren't imported at top, the existing CLI test file already has both. If `sqlite3` (the CLI) isn't available in the test environment, fall back to opening the DB via `better-sqlite3` directly:

```ts
// Replace the sqlite3 spawn check above with:
import Database from "better-sqlite3";
const dbCheck = new Database(dbPath, { readonly: true });
const row = dbCheck.prepare("SELECT config FROM providers WHERE slug = ?").get("backups") as { config: string };
dbCheck.close();
expect(row.config).not.toContain("TOPSECRET-MARKER");
expect(row.config).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+/);
```

Use whichever variant compiles. The `better-sqlite3` path is more reliable; prefer it.

- [ ] **Step 2: Run — should fail**

```bash
pnpm test tests/bin/cli.test.ts
```

Expected: 4 new failures (the s3-related cases) plus the existing 7 still pass.

- [ ] **Step 3: Update bin/cli.mjs**

Replace the `cmdAddProvider` function in `bin/cli.mjs`:

```js
function cmdAddProvider(db, flags) {
  const type = (flags.type ?? "local").toLowerCase();
  if (type !== "local" && type !== "s3") {
    console.error(`--type must be 'local' or 's3' (got '${type}')`);
    return 2;
  }
  if (!flags.name) {
    console.error("--name is required");
    return 2;
  }

  let config;
  if (type === "local") {
    if (!flags["root-path"]) {
      console.error("--root-path is required for type=local");
      return 2;
    }
    config = { rootPath: flags["root-path"] };
  } else {
    if (flags["root-path"]) {
      console.error("--root-path is for type=local; remove it for type=s3");
      return 2;
    }
    if (!flags.bucket) {
      console.error("--bucket is required for type=s3");
      return 2;
    }
    if (!flags.region) {
      console.error("--region is required for type=s3");
      return 2;
    }
    if (!flags["access-key-id"]) {
      console.error("--access-key-id is required for type=s3");
      return 2;
    }
    if (!flags["secret-access-key"]) {
      console.error("--secret-access-key is required for type=s3");
      return 2;
    }
    config = {
      bucket: flags.bucket,
      region: flags.region,
      accessKeyId: flags["access-key-id"],
      secretAccessKey: flags["secret-access-key"],
      endpoint: flags.endpoint,
      pathStyle: Object.prototype.hasOwnProperty.call(flags, "path-style"),
    };
  }

  let slug;
  if (flags.slug) {
    if (!SLUG_RE.test(flags.slug)) {
      console.error("--slug must match /^[a-z0-9-]{1,32}$/i");
      return 2;
    }
    slug = flags.slug.toLowerCase();
    const existing = db.prepare("SELECT 1 FROM providers WHERE slug = ?").get(slug);
    if (existing) {
      console.error(`Provider slug already exists: ${slug}`);
      return 1;
    }
  } else {
    slug = generateUniqueSlug(db, flags.name);
  }

  const encrypted = encryptJSON(db, config);
  const now = Date.now();
  db.prepare(
    `INSERT INTO providers (slug, name, type, config, position, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  ).run(slug, flags.name, type, encrypted, now);

  if (type === "local") {
    console.log(`Added provider ${slug} (${flags.name}) → ${flags["root-path"]}`);
  } else {
    console.log(`Added provider ${slug} (${flags.name}) → s3://${flags.bucket} (${flags.region})`);
  }
  return 0;
}
```

Note the boolean `pathStyle` parsing — `--path-style` is treated as a flag (presence = true). The `parseFlags` helper assigns the next argv value to it (which might be undefined, but `hasOwnProperty` only cares about presence).

Actually `parseFlags` always grabs the next argv as the value. So `--path-style` followed by `--region` would assign `flags["path-style"] = "--region"` and skip a real arg. That's a bug we'd hit with the existing parser. Make it explicit instead by accepting `--path-style true|false`:

Replace the `pathStyle` line with:
```js
      pathStyle: flags["path-style"] === "true" || flags["path-style"] === undefined,
```

…actually that still creates ambiguity. Simplest reliable change: require `--path-style true|false`. Update the help text + the test.

Replace the test invocation `--path-style` (no value) with `--path-style`, `"true"`. Update the help text to say `--path-style true|false (default: false)`.

Also update the `cmdAddProvider` to require an explicit value:
```js
      pathStyle: flags["path-style"] === "true",
```

(Default is `false` per S3 conventions.)

Update the test (Step 1) to use `--path-style true`. The test already shows `--path-style` without a value; change it to `--path-style`, `"true"`.

- [ ] **Step 4: Update help text**

Replace the `usage()` Provider commands section:

```js
function usage() {
  console.log(`minifold — admin CLI

User commands:
  list-users                              List all users.
  reset-admin   --username <name>         Reset the password for an admin user (creates one if missing).
  promote       --username <name>         Promote a user to admin.
  demote        --username <name>         Demote an admin to user (refuses if last admin).
  delete-user   --username <name>         Delete a user (refuses if last admin).

Provider commands:
  list-providers                          List configured storage providers.
  add-provider  --name <n> [--type local|s3] [--slug <s>] ...
      type=local (default):
                  --root-path <p>         Absolute path inside the container.
      type=s3:
                  --bucket <b>            Bucket name.
                  --region <r>            AWS region or compatible.
                  --access-key-id <k>
                  --secret-access-key <s>
                  --endpoint <url>        Optional; for non-AWS S3-compatible.
                  --path-style true|false Optional; default false.
  remove-provider --slug <s>              Remove a provider.

Environment:
  DATABASE_PATH   Path to the SQLite DB. Defaults to /app/data/minifold.db in the image,
                  or ./data/minifold.db locally.
`);
}
```

- [ ] **Step 5: Run + commit**

```bash
pnpm test tests/bin/cli.test.ts
pnpm typecheck && pnpm lint && pnpm test
git add bin/cli.mjs tests/bin/cli.test.ts
git commit -m "feat(cli): add-provider supports --type s3 with credential flags"
```

---

## Task 7: Final verification + manual deploy

- [ ] **Step 1: Local gauntlet**

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all green. Test count grows by ~25 (s3 provider + factory + CLI).

- [ ] **Step 2: Local Docker smoke test**

```bash
docker build -t minifold:phase35 .
docker rm -f mf-p35 2>/dev/null
docker volume rm mf-p35-data 2>/dev/null
docker run -d --rm --name mf-p35 -p 3010:3000 -v mf-p35-data:/app/data minifold:phase35
sleep 5

# Seed an admin and a fake S3 provider via CLI:
docker exec mf-p35 minifold reset-admin --username admin
docker exec mf-p35 minifold add-provider \
  --type s3 \
  --name "Test S3" \
  --bucket fake \
  --region us-east-1 \
  --access-key-id AKIA \
  --secret-access-key fake-secret \
  --endpoint https://s3.example.com \
  --path-style true

# Verify it's there:
docker exec mf-p35 minifold list-providers
# Expected: shows "test-s3 ... s3 ..."

# /  redirects to /login (setup complete: admin + provider)
curl -si http://localhost:3010/ | grep -i "^location:"
# Expected: location: /login

docker stop mf-p35
docker volume rm mf-p35-data
```

- [ ] **Step 3: Push + watch CI**

```bash
git push origin main
gh run watch --exit-status
```

- [ ] **Step 4: Manual Coolify deploy**

```bash
coolify deploy uuid kl2kjsmt42md6ct7zt4g9wsk
for i in {1..18}; do
  s=$(coolify app get kl2kjsmt42md6ct7zt4g9wsk --format json | jq -r .status)
  echo "[$i] $s"
  [[ "$s" == "running:healthy" ]] && break
  sleep 5
done
```

- [ ] **Step 5: Live sanity check**

```bash
APP_URL=https://minifold.apps.janjaap.de
curl -sI "$APP_URL/" | head -2
# Expected: 307 → /login (or 200 if a session cookie is still valid)
```

The S3 provider only matters once the user adds one; nothing visibly changes on the live URL after this phase. Tell the user: "Phase 3.5 is shipped. To add an S3 provider on the live deploy, SSH and run `docker exec <container> minifold add-provider --type s3 --name 'X' --bucket … --region … --access-key-id … --secret-access-key … [--endpoint …] [--path-style true]`. The provider will appear in the sidebar."

---

## Phase 3.5 exit criteria

- ✅ `S3StorageProvider` implements all 5 methods of the `StorageProvider` interface.
- ✅ Path traversal (`..`) is rejected; leading `/` is stripped (consistent with `LocalStorageProvider`).
- ✅ List handles pagination; stat/exists handle both file (HeadObject) and directory (prefix probe) cases.
- ✅ `read()` returns a Web `ReadableStream<Uint8Array>` regardless of how the SDK wraps the response body.
- ✅ Factory constructs S3 providers from `ProviderRow` with `type=s3`.
- ✅ CLI `add-provider --type s3` validates required flags, encrypts the credential bundle, and stores it.
- ✅ Full test suite green, including ~21 new s3 cases, factory case swap, and ~3 new CLI cases.
- ✅ Docker image builds; CLI works via `docker exec`.

---

## Self-Review

**Spec coverage (Phase 3.5 only):**
- §4 S3 provider config fields (endpoint/bucket/region/keys/pathStyle) — Tasks 2 (constructor) + 6 (CLI flags + factory mapping in Task 5).
- §4 `StorageProvider` interface methods — Tasks 2-4.
- §4 URL ↔ path mapping (slug + path) — already in Phase 3; this phase produces the second concrete impl behind that mapping.

**Placeholder scan:** every step has complete code or concrete commands. The fallback `--path-style` parsing approach in Task 6 step 3 is documented as an explicit pivot — code blocks for both the buggy and correct version are shown so the engineer doesn't guess.

**Type consistency:**
- `S3Options` in Task 2 matches what the factory passes in Task 5 and what the CLI builds in Task 6.
- `S3Config` is imported from `@/server/db/providers` (defined in Phase 3) and the field names match across factory/CLI.
- `Entry`, `StorageProvider`, `PathTraversalError`, `NotFoundError` are reused from Phase 3's `types.ts`.
- `isNotFound` is an internal helper used by `stat` and `read`.
