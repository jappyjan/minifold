import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Entry } from "@/server/storage/types";
import { ColumnDetailStrip } from "@/components/browse/ColumnDetailStrip";

const sampleFile: Entry = {
  name: "anchor.stl",
  type: "file",
  size: 1234567,
  modifiedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("ColumnDetailStrip", () => {
  it("renders file name, type, size, and modified date", () => {
    render(
      <ColumnDetailStrip
        providerSlug="nas"
        parentPath="prints"
        entry={sampleFile}
        searchSuffix=""
      />,
    );
    expect(screen.getByText("anchor.stl")).toBeInTheDocument();
    expect(screen.getByText(/STL/)).toBeInTheDocument();
    expect(screen.getByText(/1\.2 MB/)).toBeInTheDocument();
    expect(screen.getByText(/2026-01-01/)).toBeInTheDocument();
  });

  it("renders an Open link to the file detail page WITHOUT view=column", () => {
    render(
      <ColumnDetailStrip
        providerSlug="nas"
        parentPath="prints"
        entry={sampleFile}
        searchSuffix=""
      />,
    );
    const link = screen.getByRole("link", { name: /open/i });
    expect(link.getAttribute("href")).toBe("/nas/prints/anchor.stl");
  });

  it("preserves other query params on the Open link (no view)", () => {
    render(
      <ColumnDetailStrip
        providerSlug="nas"
        parentPath="prints"
        entry={sampleFile}
        searchSuffix="show=3d"
      />,
    );
    const link = screen.getByRole("link", { name: /open/i });
    expect(link.getAttribute("href")).toBe("/nas/prints/anchor.stl?show=3d");
  });

  it("URL-encodes filenames", () => {
    const exotic: Entry = { ...sampleFile, name: "draft #2.stl" };
    render(
      <ColumnDetailStrip
        providerSlug="nas"
        parentPath="prints"
        entry={exotic}
        searchSuffix=""
      />,
    );
    const link = screen.getByRole("link", { name: /open/i });
    expect(link.getAttribute("href")).toBe(
      "/nas/prints/draft%20%232.stl",
    );
  });

  it("works for files at provider root (no parentPath)", () => {
    render(
      <ColumnDetailStrip
        providerSlug="nas"
        parentPath=""
        entry={sampleFile}
        searchSuffix=""
      />,
    );
    const link = screen.getByRole("link", { name: /open/i });
    expect(link.getAttribute("href")).toBe("/nas/anchor.stl");
  });
});
