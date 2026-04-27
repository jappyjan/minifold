import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import {
  getCachedDir,
  IDB_DB_NAME,
} from "@/lib/dir-cache-idb";
import type { Entry } from "@/server/storage/types";
import { FolderBrowser } from "@/components/browse/FolderBrowser";
import { STORAGE_KEY } from "@/lib/browse-filter";

// Mock next/navigation for useSearchParams
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

function file(name: string): Entry {
  return { name, type: "file", size: 1, modifiedAt: new Date(0) };
}

function dir(name: string): Entry {
  return { name, type: "directory", size: 0, modifiedAt: new Date(0) };
}

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(IDB_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  await deleteDb();
  localStorage.clear();
});

function renderBrowser(entries: Entry[]) {
  return render(
    <FolderBrowser
      providerSlug="nas"
      path=""
      parentPath=""
      initialHash="h1"
      initialEntries={entries}
      descriptionName={null}
      sidecarNames={[]}
      thumbnailsEnabled={false}
    />,
  );
}

describe("FolderBrowser", () => {
  it("renders initialEntries", () => {
    renderBrowser([file("a.stl")]);
    expect(screen.getByText("a.stl")).toBeInTheDocument();
  });

  it("filters out description and sidecar entries from the grid", () => {
    render(
      <FolderBrowser
        providerSlug="nas"
        path=""
        parentPath=""
        initialHash="h1"
        initialEntries={[file("readme.md"), file("anchor.stl"), file("anchor.md")]}
        descriptionName="readme.md"
        sidecarNames={["anchor.md"]}
        thumbnailsEnabled={false}
      />,
    );
    expect(screen.getByText("anchor.stl")).toBeInTheDocument();
    expect(screen.queryByText("readme.md")).not.toBeInTheDocument();
    expect(screen.queryByText("anchor.md")).not.toBeInTheDocument();
  });

  it("seeds IDB with initialEntries and initialHash on mount", async () => {
    renderBrowser([file("a.stl")]);
    await waitFor(async () => {
      const cached = await getCachedDir("nas/");
      expect(cached).not.toBeNull();
      expect(cached?.hash).toBe("h1");
      expect(cached?.entries.map((e) => e.name)).toEqual(["a.stl"]);
      expect(typeof cached?.cachedAt).toBe("number");
    });
  });

  it("re-seeds IDB when initialHash changes", async () => {
    const { rerender } = renderBrowser([file("a.stl")]);

    await waitFor(async () => {
      const cached = await getCachedDir("nas/");
      expect(cached?.hash).toBe("h1");
    });

    rerender(
      <FolderBrowser
        providerSlug="nas"
        path=""
        parentPath=""
        initialHash="h2"
        initialEntries={[file("b.stl")]}
        descriptionName={null}
        sidecarNames={[]}
        thumbnailsEnabled={false}
      />,
    );

    await waitFor(async () => {
      const cached = await getCachedDir("nas/");
      expect(cached?.hash).toBe("h2");
      expect(cached?.entries.map((e) => e.name)).toEqual(["b.stl"]);
    });
  });

  describe("category filter", () => {
    it("shows only supported file types (3d, doc, image) by default", () => {
      renderBrowser([
        file("part.step"),   // 3d
        file("readme.md"),   // doc
        file("photo.png"),   // image
        file("misc.bin"),    // other
      ]);
      expect(screen.getByText("part.step")).toBeInTheDocument();
      expect(screen.getByText("readme.md")).toBeInTheDocument();
      expect(screen.getByText("photo.png")).toBeInTheDocument();
      expect(screen.queryByText("misc.bin")).not.toBeInTheDocument();
    });

    it("always shows directories regardless of filter", () => {
      // Default filter hides 'other', but directories should always be visible
      renderBrowser([
        file("misc.bin"),    // other — hidden by default
        dir("subfolder"),    // directory — always visible
      ]);
      expect(screen.queryByText("misc.bin")).not.toBeInTheDocument();
      expect(screen.getByText("subfolder")).toBeInTheDocument();
    });

    it("filters by category when user unchecks a category", async () => {
      const user = userEvent.setup();
      renderBrowser([
        file("part.step"),  // 3d
        file("readme.md"),  // doc
        dir("subfolder"),   // directory — always visible
        file("misc.bin"),   // other — hidden by default
      ]);

      // By default: part.step, readme.md, subfolder visible; misc.bin hidden
      expect(screen.getByText("part.step")).toBeInTheDocument();
      expect(screen.getByText("readme.md")).toBeInTheDocument();
      expect(screen.getByText("subfolder")).toBeInTheDocument();
      expect(screen.queryByText("misc.bin")).not.toBeInTheDocument();

      // Uncheck "3D models" (first checkbox)
      const checkboxes = screen.getAllByRole("checkbox");
      await user.click(checkboxes[0]!); // 3d

      // part.step (3d) should now be hidden; readme.md and subfolder still visible
      expect(screen.queryByText("part.step")).not.toBeInTheDocument();
      expect(screen.getByText("readme.md")).toBeInTheDocument();
      expect(screen.getByText("subfolder")).toBeInTheDocument();
    });

    it("persists filter changes to localStorage", async () => {
      const user = userEvent.setup();
      renderBrowser([file("part.step"), file("readme.md")]);

      // Uncheck "doc" (second checkbox)
      const checkboxes = screen.getAllByRole("checkbox");
      await user.click(checkboxes[1]!); // doc

      const stored = localStorage.getItem(STORAGE_KEY);
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.visible).toContain("3d");
      expect(parsed.visible).not.toContain("doc");
    });

    it("restores filter from localStorage on mount", async () => {
      // Pre-populate localStorage with only 'doc' visible
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ visible: ["doc"] }));

      renderBrowser([
        file("part.step"),  // 3d
        file("readme.md"),  // doc
        file("misc.bin"),   // other
      ]);

      // After mount effect, only doc should be visible (files)
      await waitFor(() => {
        expect(screen.queryByText("part.step")).not.toBeInTheDocument();
      });
      expect(screen.getByText("readme.md")).toBeInTheDocument();
      expect(screen.queryByText("misc.bin")).not.toBeInTheDocument();
    });
  });
});
