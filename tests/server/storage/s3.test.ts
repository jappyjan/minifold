import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { S3StorageProvider } from "@/server/storage/s3";
import { PathTraversalError } from "@/server/storage/types";

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
