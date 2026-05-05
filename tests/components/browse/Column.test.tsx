import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Entry } from "@/server/storage/types";
import { Column } from "@/components/browse/Column";

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

describe("Column", () => {
  it("renders the column header with the directory name", () => {
    render(
      <Column
        providerSlug="nas"
        path="foo/bar"
        headerLabel="bar"
        entries={[]}
        activeName={null}
        searchSuffix=""
      />,
    );
    expect(screen.getByText("bar")).toBeInTheDocument();
  });

  it("uses provider name as header label for the root column", () => {
    render(
      <Column
        providerSlug="nas"
        path=""
        headerLabel="NAS"
        entries={[]}
        activeName={null}
        searchSuffix=""
      />,
    );
    expect(screen.getByText("NAS")).toBeInTheDocument();
  });

  it("renders one row per entry as anchor links", () => {
    render(
      <Column
        providerSlug="nas"
        path=""
        headerLabel="NAS"
        entries={[d("foo"), f("a.stl")]}
        activeName={null}
        searchSuffix=""
      />,
    );
    expect(
      screen.getByRole("link", { name: /foo/ }).getAttribute("href"),
    ).toBe("/nas/foo?view=column");
    expect(
      screen.getByRole("link", { name: /a\.stl/ }).getAttribute("href"),
    ).toBe("/nas/a.stl?view=column");
  });

  it("appends searchSuffix (other params) to each link", () => {
    render(
      <Column
        providerSlug="nas"
        path=""
        headerLabel="NAS"
        entries={[d("foo")]}
        activeName={null}
        searchSuffix="show=3d"
      />,
    );
    expect(
      screen.getByRole("link", { name: /foo/ }).getAttribute("href"),
    ).toBe("/nas/foo?show=3d&view=column");
  });

  it("marks the active row with aria-current='true'", () => {
    render(
      <Column
        providerSlug="nas"
        path=""
        headerLabel="NAS"
        entries={[d("foo"), d("bar")]}
        activeName="foo"
        searchSuffix=""
      />,
    );
    expect(screen.getByRole("link", { name: /foo/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("link", { name: /bar/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("renders 'Empty folder' when entries is empty", () => {
    render(
      <Column
        providerSlug="nas"
        path="foo"
        headerLabel="foo"
        entries={[]}
        activeName={null}
        searchSuffix=""
      />,
    );
    expect(screen.getByText(/empty folder/i)).toBeInTheDocument();
  });

  it("renders directories with a chevron", () => {
    render(
      <Column
        providerSlug="nas"
        path=""
        headerLabel="NAS"
        entries={[d("foo")]}
        activeName={null}
        searchSuffix=""
      />,
    );
    expect(screen.getByText("›")).toBeInTheDocument();
  });

  it("does not render a chevron for files", () => {
    render(
      <Column
        providerSlug="nas"
        path=""
        headerLabel="NAS"
        entries={[f("a.stl")]}
        activeName={null}
        searchSuffix=""
      />,
    );
    expect(screen.queryByText("›")).not.toBeInTheDocument();
  });

  it("URL-encodes path segments containing reserved characters", () => {
    render(
      <Column
        providerSlug="nas"
        path="prints"
        headerLabel="prints"
        entries={[f("draft #2.md")]}
        activeName={null}
        searchSuffix=""
      />,
    );
    const link = screen.getByRole("link", { name: /draft #2\.md/ });
    expect(link.getAttribute("href")).toBe(
      "/nas/prints/draft%20%232.md?view=column",
    );
  });
});
