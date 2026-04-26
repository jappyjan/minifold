import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { S3ServiceException } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { S3StorageProvider } from "@/server/storage/s3";
import { PathTraversalError, NotFoundError } from "@/server/storage/types";

const s3Mock = mockClient(S3Client);

const makeProvider = () =>
  new S3StorageProvider({
    slug: "test-s3",
    bucket: "my-bucket",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  });

beforeEach(() => {
  s3Mock.reset();
});

describe("S3StorageProvider.list", () => {
  it("lists files and subdirectories from the bucket root", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        {
          Key: "hello.md",
          Size: 42,
          LastModified: new Date("2024-01-01"),
          ETag: '"abc123"',
        },
      ],
      CommonPrefixes: [{ Prefix: "prints/" }],
      IsTruncated: false,
    });

    const provider = makeProvider();
    const entries = await provider.list("");
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["hello.md", "prints"]);

    const file = entries.find((e) => e.name === "hello.md")!;
    expect(file.type).toBe("file");
    expect(file.size).toBe(42);
    expect(file.modifiedAt).toEqual(new Date("2024-01-01"));
    expect(file.etag).toBe("abc123");

    const dir = entries.find((e) => e.name === "prints")!;
    expect(dir.type).toBe("directory");
    expect(dir.size).toBe(0);
  });

  it("lists files and subdirectories from root when called with /", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: "readme.txt", Size: 10, LastModified: new Date("2024-02-01") },
      ],
      CommonPrefixes: [],
      IsTruncated: false,
    });

    const provider = makeProvider();
    const entries = await provider.list("/");
    expect(entries.map((e) => e.name)).toEqual(["readme.txt"]);
  });

  it("lists entries under a nested prefix", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        {
          Key: "prints/anchor.stl",
          Size: 1024,
          LastModified: new Date("2024-03-01"),
          ETag: '"deadbeef"',
        },
      ],
      CommonPrefixes: [{ Prefix: "prints/sub/" }],
      IsTruncated: false,
    });

    const provider = makeProvider();
    const entries = await provider.list("prints");
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["anchor.stl", "sub"]);

    const file = entries.find((e) => e.name === "anchor.stl")!;
    expect(file.type).toBe("file");
    expect(file.size).toBe(1024);
    expect(file.etag).toBe("deadbeef");

    const dir = entries.find((e) => e.name === "sub")!;
    expect(dir.type).toBe("directory");
    expect(dir.size).toBe(0);
  });

  it("follows pagination when IsTruncated=true", async () => {
    s3Mock
      .on(ListObjectsV2Command, { ContinuationToken: undefined })
      .resolves({
        Contents: [
          {
            Key: "file1.txt",
            Size: 10,
            LastModified: new Date("2024-01-01"),
          },
        ],
        CommonPrefixes: [],
        IsTruncated: true,
        NextContinuationToken: "token-page-2",
      })
      .on(ListObjectsV2Command, { ContinuationToken: "token-page-2" })
      .resolves({
        Contents: [
          {
            Key: "file2.txt",
            Size: 20,
            LastModified: new Date("2024-01-02"),
          },
        ],
        CommonPrefixes: [],
        IsTruncated: false,
      });

    const provider = makeProvider();
    const entries = await provider.list("");
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["file1.txt", "file2.txt"]);
  });

  it("returns an empty array when the directory is empty", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [],
      CommonPrefixes: [],
      IsTruncated: false,
    });

    const provider = makeProvider();
    const entries = await provider.list("empty-dir");
    expect(entries).toEqual([]);
  });

  it("returns an empty array when Contents and CommonPrefixes are undefined", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      IsTruncated: false,
    });

    const provider = makeProvider();
    const entries = await provider.list("");
    expect(entries).toEqual([]);
  });

  it("rejects with PathTraversalError for ../etc", async () => {
    const provider = makeProvider();
    await expect(provider.list("../etc")).rejects.toBeInstanceOf(
      PathTraversalError,
    );
  });

  it("rejects with PathTraversalError for foo/../../../etc", async () => {
    const provider = makeProvider();
    await expect(provider.list("foo/../../../etc")).rejects.toBeInstanceOf(
      PathTraversalError,
    );
  });

  it("normalizes leading slash: /prints behaves like prints", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        {
          Key: "prints/anchor.stl",
          Size: 512,
          LastModified: new Date("2024-04-01"),
        },
      ],
      CommonPrefixes: [],
      IsTruncated: false,
    });

    const provider = makeProvider();
    const entries = await provider.list("/prints");
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("anchor.stl");
  });

  it("strips quotes from ETag", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        {
          Key: "doc.pdf",
          Size: 999,
          LastModified: new Date("2024-05-01"),
          ETag: '"quoted-etag-value"',
        },
      ],
      IsTruncated: false,
    });

    const provider = makeProvider();
    const entries = await provider.list("");
    expect(entries[0].etag).toBe("quoted-etag-value");
  });

  it("skips S3 directory marker keys (key equals prefix exactly)", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        // This is the directory marker — key equals prefix
        {
          Key: "prints/",
          Size: 0,
          LastModified: new Date("2024-01-01"),
        },
        {
          Key: "prints/real-file.txt",
          Size: 100,
          LastModified: new Date("2024-01-02"),
        },
      ],
      CommonPrefixes: [],
      IsTruncated: false,
    });

    const provider = makeProvider();
    const entries = await provider.list("prints");
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("real-file.txt");
  });
});

// Helper to create a 404-like S3 error
function makeNotFoundError(): S3ServiceException {
  return Object.assign(new Error("Not Found"), {
    name: "NoSuchKey",
    $metadata: { httpStatusCode: 404 },
    $fault: "client" as const,
    $service: "S3",
  }) as S3ServiceException;
}

describe("S3StorageProvider.stat", () => {
  it("returns file entry when HeadObject succeeds", async () => {
    s3Mock.on(HeadObjectCommand).resolves({
      ContentLength: 512,
      LastModified: new Date("2024-06-01"),
      ETag: '"etag-value"',
    });

    const provider = makeProvider();
    const entry = await provider.stat("prints/anchor.stl");

    expect(entry.name).toBe("anchor.stl");
    expect(entry.type).toBe("file");
    expect(entry.size).toBe(512);
    expect(entry.modifiedAt).toEqual(new Date("2024-06-01"));
    expect(entry.etag).toBe("etag-value");
  });

  it("returns directory entry when HeadObject 404s but ListObjectsV2 finds content", async () => {
    s3Mock.on(HeadObjectCommand).rejects(makeNotFoundError());
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        {
          Key: "prints/anchor.stl",
          Size: 10,
          LastModified: new Date(),
        },
      ],
      IsTruncated: false,
    });

    const provider = makeProvider();
    const entry = await provider.stat("prints");

    expect(entry.name).toBe("prints");
    expect(entry.type).toBe("directory");
    expect(entry.size).toBe(0);
    expect(entry.modifiedAt).toEqual(new Date(0));
  });

  it("throws NotFoundError when HeadObject 404s and ListObjectsV2 is empty", async () => {
    s3Mock.on(HeadObjectCommand).rejects(makeNotFoundError());
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [],
      CommonPrefixes: [],
      IsTruncated: false,
    });

    const provider = makeProvider();
    await expect(provider.stat("missing/path")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("throws PathTraversalError for ../bad", async () => {
    const provider = makeProvider();
    await expect(provider.stat("../bad")).rejects.toBeInstanceOf(
      PathTraversalError,
    );
  });

  it("strips ETag quotes for files", async () => {
    s3Mock.on(HeadObjectCommand).resolves({
      ContentLength: 100,
      LastModified: new Date("2024-07-01"),
      ETag: '"double-quoted-etag"',
    });

    const provider = makeProvider();
    const entry = await provider.stat("doc.pdf");
    expect(entry.etag).toBe("double-quoted-etag");
  });
});

describe("S3StorageProvider.exists", () => {
  it("returns true for a file (HeadObject succeeds)", async () => {
    s3Mock.on(HeadObjectCommand).resolves({
      ContentLength: 256,
      LastModified: new Date("2024-06-15"),
      ETag: '"abc"',
    });

    const provider = makeProvider();
    expect(await provider.exists("prints/anchor.stl")).toBe(true);
  });

  it("returns true for a directory (HeadObject 404 + ListObjectsV2 has keys)", async () => {
    s3Mock.on(HeadObjectCommand).rejects(makeNotFoundError());
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "prints/file.stl", Size: 10, LastModified: new Date() }],
      IsTruncated: false,
    });

    const provider = makeProvider();
    expect(await provider.exists("prints")).toBe(true);
  });

  it("returns false for a missing path", async () => {
    s3Mock.on(HeadObjectCommand).rejects(makeNotFoundError());
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [],
      CommonPrefixes: [],
      IsTruncated: false,
    });

    const provider = makeProvider();
    expect(await provider.exists("no/such/thing")).toBe(false);
  });

  it("propagates PathTraversalError (does NOT return false)", async () => {
    const provider = makeProvider();
    await expect(provider.exists("../etc")).rejects.toBeInstanceOf(
      PathTraversalError,
    );
  });
});

describe("S3StorageProvider.read", () => {
  it("returns a ReadableStream whose content matches the mocked S3 body", async () => {
    const bodyContent = Buffer.from("hello s3");
    s3Mock.on(GetObjectCommand).resolves({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Body: Readable.from([bodyContent]) as any,
    });

    const provider = makeProvider();
    const stream = await provider.read("hello.md");
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const result = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    expect(result.toString("utf8")).toBe("hello s3");
  });

  it("throws NotFoundError when GetObjectCommand returns 404", async () => {
    const notFound = Object.assign(new Error("NoSuchKey"), {
      name: "NoSuchKey",
      $metadata: { httpStatusCode: 404 },
      $fault: "client",
      $service: "S3",
    });
    s3Mock.on(GetObjectCommand).rejects(notFound);

    const provider = makeProvider();
    await expect(provider.read("missing.txt")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("throws PathTraversalError for ../secret", async () => {
    const provider = makeProvider();
    await expect(provider.read("../secret")).rejects.toBeInstanceOf(
      PathTraversalError,
    );
  });
});

describe("S3StorageProvider.write", () => {
  it("calls PutObjectCommand with correct Bucket, Key, and Body", async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    const provider = makeProvider();
    await provider.write("output/result.txt", Buffer.from("data"));

    const calls = s3Mock.calls();
    const putCall = calls.find((c) => c.args[0] instanceof PutObjectCommand);
    const input = (putCall!.args[0] as PutObjectCommand).input;
    expect(input.Bucket).toBe("my-bucket");
    expect(input.Key).toBe("output/result.txt");
    expect(Buffer.from(input.Body as Buffer).toString()).toBe("data");
  });

  it("throws PathTraversalError for ../secret", async () => {
    const provider = makeProvider();
    await expect(
      provider.write("../secret", Buffer.from("evil")),
    ).rejects.toBeInstanceOf(PathTraversalError);
  });
});
