import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import {
  getCachedDir,
  IDB_DB_NAME,
} from "@/lib/dir-cache-idb";
import type { Entry } from "@/server/storage/types";
import { FolderBrowser } from "@/components/browse/FolderBrowser";

function file(name: string): Entry {
  return { name, type: "file", size: 1, modifiedAt: new Date(0) };
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
});

describe("FolderBrowser", () => {
  it("renders initialEntries", () => {
    render(
      <FolderBrowser
        providerSlug="nas"
        path=""
        parentPath=""
        initialHash="h1"
        initialEntries={[file("a.stl")]}
        descriptionName={null}
        sidecarNames={[]}
      />,
    );
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
      />,
    );
    expect(screen.getByText("anchor.stl")).toBeInTheDocument();
    expect(screen.queryByText("readme.md")).not.toBeInTheDocument();
    expect(screen.queryByText("anchor.md")).not.toBeInTheDocument();
  });

  it("seeds IDB with initialEntries and initialHash on mount", async () => {
    render(
      <FolderBrowser
        providerSlug="nas"
        path=""
        parentPath=""
        initialHash="h1"
        initialEntries={[file("a.stl")]}
        descriptionName={null}
        sidecarNames={[]}
      />,
    );
    await waitFor(async () => {
      const cached = await getCachedDir("nas/");
      expect(cached).not.toBeNull();
      expect(cached?.hash).toBe("h1");
      expect(cached?.entries.map((e) => e.name)).toEqual(["a.stl"]);
      expect(typeof cached?.cachedAt).toBe("number");
    });
  });

  it("re-seeds IDB when initialHash changes", async () => {
    const { rerender } = render(
      <FolderBrowser
        providerSlug="nas"
        path=""
        parentPath=""
        initialHash="h1"
        initialEntries={[file("a.stl")]}
        descriptionName={null}
        sidecarNames={[]}
      />,
    );

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
      />,
    );

    await waitFor(async () => {
      const cached = await getCachedDir("nas/");
      expect(cached?.hash).toBe("h2");
      expect(cached?.entries.map((e) => e.name)).toEqual(["b.stl"]);
    });
  });
});
