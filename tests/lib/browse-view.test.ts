import { describe, it, expect, beforeEach } from "vitest";
import {
  VIEW_STORAGE_KEY,
  mergeSearchParams,
  stripViewParam,
  readPersistedView,
  writePersistedView,
} from "@/lib/browse-view";

beforeEach(() => {
  localStorage.clear();
});

describe("mergeSearchParams", () => {
  it("adds a new param when not present", () => {
    const sp = new URLSearchParams("show=3d");
    expect(mergeSearchParams(sp, { view: "column" })).toBe("show=3d&view=column");
  });

  it("replaces an existing param", () => {
    const sp = new URLSearchParams("view=grid&show=3d");
    expect(mergeSearchParams(sp, { view: "column" })).toBe("view=column&show=3d");
  });

  it("removes a param when value is null", () => {
    const sp = new URLSearchParams("view=column&show=3d");
    expect(mergeSearchParams(sp, { view: null })).toBe("show=3d");
  });

  it("returns empty string when all params removed", () => {
    const sp = new URLSearchParams("view=column");
    expect(mergeSearchParams(sp, { view: null })).toBe("");
  });

  it("does not mutate the input URLSearchParams", () => {
    const sp = new URLSearchParams("view=grid");
    mergeSearchParams(sp, { view: "column" });
    expect(sp.get("view")).toBe("grid");
  });
});

describe("stripViewParam", () => {
  it("removes only the view param", () => {
    const sp = new URLSearchParams("view=column&show=3d&showAll=1");
    expect(stripViewParam(sp)).toBe("show=3d&showAll=1");
  });

  it("returns empty when only view was present", () => {
    expect(stripViewParam(new URLSearchParams("view=column"))).toBe("");
  });

  it("returns empty for already-empty params", () => {
    expect(stripViewParam(new URLSearchParams())).toBe("");
  });
});

describe("readPersistedView / writePersistedView", () => {
  it("returns null when nothing stored", () => {
    expect(readPersistedView()).toBeNull();
  });

  it("round-trips 'grid'", () => {
    writePersistedView("grid");
    expect(readPersistedView()).toBe("grid");
  });

  it("round-trips 'column'", () => {
    writePersistedView("column");
    expect(readPersistedView()).toBe("column");
  });

  it("returns null for malformed JSON", () => {
    localStorage.setItem(VIEW_STORAGE_KEY, "not-json{{{");
    expect(readPersistedView()).toBeNull();
  });

  it("returns null for unknown view value", () => {
    localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify({ view: "kanban" }));
    expect(readPersistedView()).toBeNull();
  });

  it("uses key minifold:browse-view", () => {
    expect(VIEW_STORAGE_KEY).toBe("minifold:browse-view");
  });
});
