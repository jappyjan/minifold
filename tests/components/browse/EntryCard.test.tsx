import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// Stub IntersectionObserver so it fires immediately on observe()
beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      cb: (entries: { isIntersecting: boolean; target: Element }[]) => void;
      constructor(
        cb: (entries: { isIntersecting: boolean; target: Element }[]) => void,
      ) {
        this.cb = cb;
      }
      observe(el: Element) {
        this.cb([{ isIntersecting: true, target: el }]);
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "";
      thresholds: number[] = [];
    },
  );
});

describe("EntryCard", () => {
  it("renders a folder card linking into the folder", () => {
    render(
      <EntryCard
        providerSlug="nas"
        parentPath="prints"
        entry={dir("benchy")}
        thumbnailsEnabled={false}
      />,
    );
    const link = screen.getByRole("link", { name: /benchy/i });
    expect(link.getAttribute("href")).toBe("/nas/prints/benchy");
  });

  it("renders a file card linking to the file detail page", () => {
    render(
      <EntryCard
        providerSlug="nas"
        parentPath="prints"
        entry={file("anchor.stl")}
        thumbnailsEnabled={false}
      />,
    );
    const link = screen.getByRole("link", { name: /anchor\.stl/i });
    expect(link.getAttribute("href")).toBe("/nas/prints/anchor.stl");
  });

  it("renders at the provider root when parentPath is empty", () => {
    render(
      <EntryCard
        providerSlug="nas"
        parentPath=""
        entry={file("readme.md")}
        thumbnailsEnabled={false}
      />,
    );
    const link = screen.getByRole("link", { name: /readme\.md/i });
    expect(link.getAttribute("href")).toBe("/nas/readme.md");
  });

  it("URL-encodes filenames containing reserved characters", () => {
    render(
      <EntryCard
        providerSlug="nas"
        parentPath="prints"
        entry={file("draft #2.md")}
        thumbnailsEnabled={false}
      />,
    );
    const link = screen.getByRole("link", { name: /draft #2\.md/i });
    expect(link.getAttribute("href")).toBe("/nas/prints/draft%20%232.md");
  });

  describe("thumbnail rendering", () => {
    it("renders an <img> for .stl when thumbnailsEnabled=true; src becomes the API URL after intersection", () => {
      render(
        <EntryCard
          providerSlug="nas"
          parentPath="prints"
          entry={file("anchor.stl")}
          thumbnailsEnabled={true}
        />,
      );
      // The IntersectionObserver stub fires immediately, so the img src should be the API URL
      // img has alt="" so role is "presentation" — query by alt text instead
      const img = screen.getByAltText("");
      expect(img).toBeInTheDocument();
      expect(img.getAttribute("src")).toBe(
        "/api/thumb/nas/prints/anchor.stl",
      );
    });

    it("renders an <img> for .3mf when thumbnailsEnabled=true", () => {
      render(
        <EntryCard
          providerSlug="nas"
          parentPath="prints"
          entry={file("model.3mf")}
          thumbnailsEnabled={true}
        />,
      );
      const img = screen.getByAltText("");
      expect(img).toBeInTheDocument();
      expect(img.getAttribute("src")).toBe(
        "/api/thumb/nas/prints/model.3mf",
      );
    });

    it("shows transparent placeholder before intersection (non-firing stub)", () => {
      // Override with a non-firing stub for this test only
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          observe() {}
          disconnect() {}
          unobserve() {}
          takeRecords() {
            return [];
          }
          root = null;
          rootMargin = "";
          thresholds: number[] = [];
        },
      );

      render(
        <EntryCard
          providerSlug="nas"
          parentPath="prints"
          entry={file("anchor.stl")}
          thumbnailsEnabled={true}
        />,
      );
      const img = screen.getByAltText("");
      expect(img.getAttribute("src")).toBe(TRANSPARENT_PIXEL);
    });

    it("does NOT render <img> for a .txt file even when thumbnailsEnabled=true", () => {
      render(
        <EntryCard
          providerSlug="nas"
          parentPath="prints"
          entry={file("readme.txt")}
          thumbnailsEnabled={true}
        />,
      );
      expect(screen.queryByAltText("")).not.toBeInTheDocument();
    });

    it("does NOT render <img> for an .stl file when thumbnailsEnabled=false", () => {
      render(
        <EntryCard
          providerSlug="nas"
          parentPath="prints"
          entry={file("anchor.stl")}
          thumbnailsEnabled={false}
        />,
      );
      expect(screen.queryByAltText("")).not.toBeInTheDocument();
    });

    it("falls back to icon when <img> fires onError", () => {
      render(
        <EntryCard
          providerSlug="nas"
          parentPath="prints"
          entry={file("anchor.stl")}
          thumbnailsEnabled={true}
        />,
      );
      const img = screen.getByAltText("");
      fireEvent.error(img);
      // After error, img should be gone, replaced by the icon text
      expect(screen.queryByAltText("")).not.toBeInTheDocument();
      expect(screen.getByText("STL")).toBeInTheDocument();
    });
  });
});
