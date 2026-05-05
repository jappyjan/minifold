import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import type { Entry } from "@/server/storage/types";
import { getCachedDir, IDB_DB_NAME } from "@/lib/dir-cache-idb";
import { ColumnBrowser } from "@/components/browse/ColumnBrowser";

const f = (name: string): Entry => ({
  name,
  type: "file",
  size: 0,
  modifiedAt: new Date(0),
});
const d = (name: string): Entry => ({
  name,
  type: "directory",
  size: 0,
  modifiedAt: new Date(0),
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/nas",
}));

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

describe("ColumnBrowser", () => {
  it("renders one Column per ancestor", () => {
    render(
      <ColumnBrowser
        providerSlug="nas"
        providerName="NAS"
        columns={[
          { path: "", entries: [d("foo")], hash: "h0" },
          { path: "foo", entries: [d("bar")], hash: "h1" },
          { path: "foo/bar", entries: [f("a.stl")], hash: "h2" },
        ]}
        activeNames={["foo", "bar", null]}
        selectedLeaf={null}
        leafParentPath={null}
        thumbnailsEnabled={false}
      />,
    );
    expect(screen.getByText("NAS")).toBeInTheDocument();
    // "foo" appears twice: as a row in column 0 and as the header of column 1.
    expect(screen.getAllByText(/^foo$/)).toHaveLength(2);
    // "bar" appears twice: as a row in column 1 and as the header of column 2.
    expect(screen.getAllByText(/^bar$/)).toHaveLength(2);
    expect(screen.getByText("a.stl")).toBeInTheDocument();
  });

  it("highlights active rows via aria-current", () => {
    render(
      <ColumnBrowser
        providerSlug="nas"
        providerName="NAS"
        columns={[
          { path: "", entries: [d("foo"), d("baz")], hash: "h0" },
          { path: "foo", entries: [d("bar")], hash: "h1" },
        ]}
        activeNames={["foo", null]}
        selectedLeaf={null}
        leafParentPath={null}
        thumbnailsEnabled={false}
      />,
    );
    expect(screen.getByRole("link", { name: /^foo$/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("link", { name: /^baz$/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("renders the detail strip when selectedLeaf is provided", () => {
    render(
      <ColumnBrowser
        providerSlug="nas"
        providerName="NAS"
        columns={[
          { path: "", entries: [f("a.stl")], hash: "h0" },
        ]}
        activeNames={["a.stl"]}
        selectedLeaf={f("a.stl")}
        leafParentPath=""
        thumbnailsEnabled={false}
      />,
    );
    expect(screen.getByRole("link", { name: /open/i })).toBeInTheDocument();
  });

  it("does NOT render the detail strip when selectedLeaf is null", () => {
    render(
      <ColumnBrowser
        providerSlug="nas"
        providerName="NAS"
        columns={[{ path: "", entries: [d("foo")], hash: "h0" }]}
        activeNames={[null]}
        selectedLeaf={null}
        leafParentPath={null}
        thumbnailsEnabled={false}
      />,
    );
    expect(screen.queryByRole("link", { name: /open/i })).not.toBeInTheDocument();
  });

  it("renders the ViewToggle with current='column'", () => {
    render(
      <ColumnBrowser
        providerSlug="nas"
        providerName="NAS"
        columns={[{ path: "", entries: [], hash: "h0" }]}
        activeNames={[null]}
        selectedLeaf={null}
        leafParentPath={null}
        thumbnailsEnabled={false}
      />,
    );
    const column = screen.getByRole("button", { name: /column/i });
    expect(column).toHaveAttribute("aria-pressed", "true");
  });

  it("seeds IDB with each column's listing on mount", async () => {
    render(
      <ColumnBrowser
        providerSlug="nas"
        providerName="NAS"
        columns={[
          { path: "", entries: [d("foo")], hash: "h0" },
          { path: "foo", entries: [f("a.stl")], hash: "h1" },
        ]}
        activeNames={["foo", null]}
        selectedLeaf={null}
        leafParentPath={null}
        thumbnailsEnabled={false}
      />,
    );
    await waitFor(async () => {
      const root = await getCachedDir("nas/");
      expect(root?.hash).toBe("h0");
      expect(root?.entries.map((e) => e.name)).toEqual(["foo"]);
      const sub = await getCachedDir("nas/foo");
      expect(sub?.hash).toBe("h1");
      expect(sub?.entries.map((e) => e.name)).toEqual(["a.stl"]);
    });
  });

  it("applies the category filter per column", async () => {
    render(
      <ColumnBrowser
        providerSlug="nas"
        providerName="NAS"
        columns={[
          {
            path: "",
            entries: [f("part.step"), f("misc.bin"), d("subfolder")],
            hash: "h0",
          },
        ]}
        activeNames={[null]}
        selectedLeaf={null}
        leafParentPath={null}
        thumbnailsEnabled={false}
      />,
    );
    // Default filter shows 3d/doc/image and hides 'other'; directories always visible.
    expect(screen.getByText("part.step")).toBeInTheDocument();
    expect(screen.getByText("subfolder")).toBeInTheDocument();
    expect(screen.queryByText("misc.bin")).not.toBeInTheDocument();
  });
});
