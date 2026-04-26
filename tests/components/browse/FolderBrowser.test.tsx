import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import {
  getCachedDir,
  IDB_DB_NAME,
  setCachedDir,
} from "@/lib/dir-cache-idb";
import type { Entry } from "@/server/storage/types";

type QueryState = {
  data: unknown | undefined;
  error: Error | null;
};

const mockQueryState: QueryState = { data: undefined, error: null };
const lastInputRef: { input: unknown } = { input: undefined };

vi.mock("@/trpc/client", () => ({
  trpc: {
    browse: {
      list: {
        useQuery: (input: unknown) => {
          lastInputRef.input = input;
          return mockQueryState;
        },
      },
    },
  },
}));

// Vitest hoists vi.mock() calls above the imports, so this picks up the stub.
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
  mockQueryState.data = undefined;
  mockQueryState.error = null;
  lastInputRef.input = undefined;
});

describe("FolderBrowser", () => {
  it("renders initialEntries immediately when no cache exists and no data yet", () => {
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

  it("renders cached entries from IDB when present (overrides initialEntries)", async () => {
    await setCachedDir("nas/", {
      hash: "cached",
      entries: [file("from-cache.stl")],
      cachedAt: 1,
    });
    render(
      <FolderBrowser
        providerSlug="nas"
        path=""
        parentPath=""
        initialHash="initial"
        initialEntries={[file("from-initial.stl")]}
        descriptionName={null}
        sidecarNames={[]}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("from-cache.stl")).toBeInTheDocument(),
    );
  });

  it("updates entries and writes IDB when tRPC returns changed:true", async () => {
    mockQueryState.data = {
      changed: true,
      hash: "h2",
      entries: [file("fresh.stl")],
    };
    render(
      <FolderBrowser
        providerSlug="nas"
        path=""
        parentPath=""
        initialHash="h1"
        initialEntries={[file("stale.stl")]}
        descriptionName={null}
        sidecarNames={[]}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("fresh.stl")).toBeInTheDocument(),
    );
    expect(screen.queryByText("stale.stl")).not.toBeInTheDocument();
    await waitFor(async () => {
      const cached = await getCachedDir("nas/");
      expect(cached?.hash).toBe("h2");
      expect(cached?.entries.map((e) => e.name)).toEqual(["fresh.stl"]);
    });
  });

  it("seeds IDB from initialEntries when tRPC returns changed:false and there was no cache", async () => {
    mockQueryState.data = { changed: false, hash: "h-init" };
    render(
      <FolderBrowser
        providerSlug="nas"
        path=""
        parentPath=""
        initialHash="h-init"
        initialEntries={[file("a.stl"), file("b.stl")]}
        descriptionName={null}
        sidecarNames={[]}
      />,
    );
    await waitFor(async () => {
      const cached = await getCachedDir("nas/");
      expect(cached?.hash).toBe("h-init");
      expect(cached?.entries.map((e) => e.name)).toEqual(["a.stl", "b.stl"]);
    });
  });

  it("filters out description and sidecar entries from the grid", async () => {
    mockQueryState.data = {
      changed: true,
      hash: "h2",
      entries: [
        file("readme.md"), // description
        file("anchor.stl"),
        file("anchor.md"), // sidecar
      ],
    };
    render(
      <FolderBrowser
        providerSlug="nas"
        path=""
        parentPath=""
        initialHash="h1"
        initialEntries={[file("anchor.stl")]}
        descriptionName="readme.md"
        sidecarNames={["anchor.md"]}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("anchor.stl")).toBeInTheDocument(),
    );
    expect(screen.queryByText("readme.md")).not.toBeInTheDocument();
    expect(screen.queryByText("anchor.md")).not.toBeInTheDocument();
  });

  it("passes knownHash to the tRPC query (initialHash on first render)", () => {
    render(
      <FolderBrowser
        providerSlug="nas"
        path="prints"
        parentPath="prints"
        initialHash="known-hash"
        initialEntries={[]}
        descriptionName={null}
        sidecarNames={[]}
      />,
    );
    expect(lastInputRef.input).toMatchObject({
      providerSlug: "nas",
      path: "prints",
      knownHash: "known-hash",
    });
  });
});
