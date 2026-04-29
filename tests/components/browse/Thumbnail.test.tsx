import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
