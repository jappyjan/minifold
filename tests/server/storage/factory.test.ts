import { describe, it, expect } from "vitest";
import { providerFromRow } from "@/server/storage/factory";
import { LocalStorageProvider } from "@/server/storage/local";

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

  it("throws for type=s3 in Phase 3", () => {
    expect(() =>
      providerFromRow({
        slug: "s3",
        name: "S3",
        type: "s3",
        config: {
          endpoint: "https://s3.example.com",
          bucket: "x",
          region: "us-east-1",
          accessKeyId: "a",
          secretAccessKey: "b",
          pathStyle: true,
        },
        position: 0,
        created_at: Date.now(),
      }),
    ).toThrow(/s3 provider not yet implemented/i);
  });
});
