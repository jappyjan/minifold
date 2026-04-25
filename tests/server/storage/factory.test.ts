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
      slug: "my-s3",
      name: "S3",
      type: "s3",
      config: {
        bucket: "my-bucket",
        region: "us-east-1",
        accessKeyId: "AKID",
        secretAccessKey: "SECRET",
      },
      position: 0,
      created_at: Date.now(),
    });
    expect(p).toBeInstanceOf(S3StorageProvider);
    expect(p.slug).toBe("my-s3");
  });
});
