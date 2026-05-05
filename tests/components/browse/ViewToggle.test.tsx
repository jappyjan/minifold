import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ViewToggle } from "@/components/browse/ViewToggle";
import { VIEW_STORAGE_KEY } from "@/lib/browse-view";

const pushMock = vi.fn();
let searchParamsValue = new URLSearchParams();
let pathnameValue = "/nas/foo";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  useSearchParams: () => searchParamsValue,
  usePathname: () => pathnameValue,
}));

beforeEach(() => {
  pushMock.mockClear();
  searchParamsValue = new URLSearchParams();
  pathnameValue = "/nas/foo";
  localStorage.clear();
});

describe("ViewToggle", () => {
  it("renders both Grid and Column buttons", () => {
    render(<ViewToggle current="grid" />);
    expect(screen.getByRole("button", { name: /grid/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /column/i })).toBeInTheDocument();
  });

  it("marks the active button with aria-pressed", () => {
    render(<ViewToggle current="grid" />);
    expect(screen.getByRole("button", { name: /grid/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /column/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("on Grid → Column click, pushes URL with ?view=column and writes localStorage", async () => {
    const user = userEvent.setup();
    render(<ViewToggle current="grid" />);
    await user.click(screen.getByRole("button", { name: /column/i }));
    expect(pushMock).toHaveBeenCalledWith("/nas/foo?view=column");
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe(
      JSON.stringify({ view: "column" }),
    );
  });

  it("on Column → Grid click, pushes URL with ?view= removed and writes localStorage", async () => {
    const user = userEvent.setup();
    searchParamsValue = new URLSearchParams("view=column&show=3d");
    render(<ViewToggle current="column" />);
    await user.click(screen.getByRole("button", { name: /grid/i }));
    expect(pushMock).toHaveBeenCalledWith("/nas/foo?show=3d");
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe(
      JSON.stringify({ view: "grid" }),
    );
  });

  it("preserves other query params on toggle", async () => {
    const user = userEvent.setup();
    searchParamsValue = new URLSearchParams("show=3d&showAll=1");
    render(<ViewToggle current="grid" />);
    await user.click(screen.getByRole("button", { name: /column/i }));
    expect(pushMock).toHaveBeenCalledWith(
      "/nas/foo?show=3d&showAll=1&view=column",
    );
  });

  it("clicking the already-active button is a no-op", async () => {
    const user = userEvent.setup();
    render(<ViewToggle current="grid" />);
    await user.click(screen.getByRole("button", { name: /grid/i }));
    expect(pushMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBeNull();
  });

  it("does not render anything when forceMobileHidden is true on small viewports (CSS-only check)", () => {
    render(<ViewToggle current="grid" />);
    const wrapper = screen.getByRole("button", { name: /grid/i }).parentElement!;
    expect(wrapper.className).toContain("hidden");
    expect(wrapper.className).toContain("md:inline-flex");
  });
});
