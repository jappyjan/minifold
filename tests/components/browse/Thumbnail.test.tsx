import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Thumbnail } from "@/components/browse/Thumbnail";

// Default stub: IntersectionObserver does NOT fire (so component stays in
// pre-intersection state). Individual tests override this when they want
// intersection to fire.
beforeEach(() => {
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
});

describe("Thumbnail", () => {
  it("renders a skeleton and no <img> before intersection", () => {
    render(
      <Thumbnail
        src="/api/thumb/nas/prints/anchor.stl"
        className="h-12 w-12 rounded object-contain"
        fallback={<div data-testid="fallback">FALLBACK</div>}
      />,
    );

    expect(screen.getByTestId("thumb-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fallback")).not.toBeInTheDocument();
  });

  it("mounts the <img> with the given src after intersection", () => {
    // Override default stub: this IO fires immediately on observe().
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

    render(
      <Thumbnail
        src="/api/thumb/nas/prints/anchor.stl"
        className="h-12 w-12 rounded object-contain"
        fallback={<div>fallback</div>}
      />,
    );

    const img = screen.getByAltText("");
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("src")).toBe("/api/thumb/nas/prints/anchor.stl");
    // Skeleton still present (image hasn't loaded yet)
    expect(screen.getByTestId("thumb-skeleton")).toBeInTheDocument();
  });

  it("removes the skeleton when the image fires onLoad", () => {
    // Firing IO stub
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

    render(
      <Thumbnail
        src="/api/thumb/nas/prints/anchor.stl"
        className="h-12 w-12 rounded object-contain"
        fallback={<div>fallback</div>}
      />,
    );

    const img = screen.getByAltText("");
    expect(screen.getByTestId("thumb-skeleton")).toBeInTheDocument();

    fireEvent.load(img);

    expect(screen.queryByTestId("thumb-skeleton")).not.toBeInTheDocument();
    expect(img).toBeInTheDocument();
  });

  it("renders the fallback when the image fires onError", () => {
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

    render(
      <Thumbnail
        src="/api/thumb/nas/prints/anchor.stl"
        className="h-12 w-12 rounded object-contain"
        fallback={<div data-testid="fallback">FALLBACK</div>}
      />,
    );

    const img = screen.getByAltText("");
    fireEvent.error(img);

    expect(screen.getByTestId("fallback")).toBeInTheDocument();
    expect(screen.queryByAltText("")).not.toBeInTheDocument();
    expect(screen.queryByTestId("thumb-skeleton")).not.toBeInTheDocument();
  });

  it("short-circuits to ready when img.complete is already true at mount", () => {
    // Firing IO stub
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

    // Force HTMLImageElement.complete to return true so the ref callback
    // sees a "cached" image at mount time.
    const completeSpy = vi
      .spyOn(HTMLImageElement.prototype, "complete", "get")
      .mockReturnValue(true);

    try {
      render(
        <Thumbnail
          src="/api/thumb/nas/prints/anchor.stl"
          className="h-12 w-12 rounded object-contain"
          fallback={<div>fallback</div>}
        />,
      );

      // Skeleton should be removed immediately, no fireEvent.load needed.
      expect(screen.queryByTestId("thumb-skeleton")).not.toBeInTheDocument();
      expect(screen.getByAltText("")).toBeInTheDocument();
    } finally {
      completeSpy.mockRestore();
    }
  });
});
