import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { EntryCard } from "@/components/browse/EntryCard";

const file = (name: string) => ({
  name,
  type: "file" as const,
  size: 0,
  modifiedAt: new Date(0),
});
const dir = (name: string) => ({
  name,
  type: "directory" as const,
  size: 0,
  modifiedAt: new Date(0),
});

describe("EntryCard", () => {
  it("renders a folder card linking into the folder", () => {
    render(<EntryCard providerSlug="nas" parentPath="prints" entry={dir("benchy")} />);
    const link = screen.getByRole("link", { name: /benchy/i });
    expect(link.getAttribute("href")).toBe("/nas/prints/benchy");
  });

  it("renders a file card linking to the file detail page", () => {
    render(<EntryCard providerSlug="nas" parentPath="prints" entry={file("anchor.stl")} />);
    const link = screen.getByRole("link", { name: /anchor\.stl/i });
    expect(link.getAttribute("href")).toBe("/nas/prints/anchor.stl");
  });

  it("renders at the provider root when parentPath is empty", () => {
    render(<EntryCard providerSlug="nas" parentPath="" entry={file("readme.md")} />);
    const link = screen.getByRole("link", { name: /readme\.md/i });
    expect(link.getAttribute("href")).toBe("/nas/readme.md");
  });
});
