import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isThumbnailServiceEnabled, getThumbnailServiceUrl } from "@/server/thumb/config";

const ORIG = process.env.MINIFOLD_THUMB_SERVICE_URL;

beforeEach(() => {
  delete process.env.MINIFOLD_THUMB_SERVICE_URL;
});

afterEach(() => {
  if (ORIG) process.env.MINIFOLD_THUMB_SERVICE_URL = ORIG;
  else delete process.env.MINIFOLD_THUMB_SERVICE_URL;
});

describe("thumb config", () => {
  it("disabled when env var unset", () => {
    expect(isThumbnailServiceEnabled()).toBe(false);
    expect(getThumbnailServiceUrl()).toBeNull();
  });

  it("enabled when env var set", () => {
    process.env.MINIFOLD_THUMB_SERVICE_URL = "http://thumbs:3001";
    expect(isThumbnailServiceEnabled()).toBe(true);
    expect(getThumbnailServiceUrl()).toBe("http://thumbs:3001");
  });

  it("treats whitespace-only env as disabled", () => {
    process.env.MINIFOLD_THUMB_SERVICE_URL = "   ";
    expect(isThumbnailServiceEnabled()).toBe(false);
  });

  it("strips trailing slash", () => {
    process.env.MINIFOLD_THUMB_SERVICE_URL = "http://thumbs:3001/";
    expect(getThumbnailServiceUrl()).toBe("http://thumbs:3001");
  });
});
