import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { FilterDropdown } from "@/components/browse/FilterDropdown";
import { CATEGORIES, type Category } from "@/lib/browse-filter";

describe("FilterDropdown", () => {
  it("renders one checkbox per category", () => {
    render(
      <FilterDropdown
        visible={new Set(CATEGORIES)}
        onChange={() => undefined}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(CATEGORIES.length);
  });

  it("reflects checked state from visible prop", () => {
    const visible: Set<Category> = new Set(["3d", "doc"]);
    render(<FilterDropdown visible={visible} onChange={() => undefined} />);
    const checkboxes = screen.getAllByRole("checkbox");
    // CATEGORIES order: 3d, doc, image, other
    expect(checkboxes[0]).toBeChecked(); // 3d
    expect(checkboxes[1]).toBeChecked(); // doc
    expect(checkboxes[2]).not.toBeChecked(); // image
    expect(checkboxes[3]).not.toBeChecked(); // other
  });

  it("calls onChange with updated set when checking a box", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FilterDropdown visible={new Set<Category>(["3d"])} onChange={onChange} />,
    );
    // "image" is the third checkbox (index 2)
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[2]!); // click image
    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0]![0] as Set<Category>;
    expect(next.has("3d")).toBe(true);
    expect(next.has("image")).toBe(true);
  });

  it("calls onChange with updated set when unchecking a box", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FilterDropdown
        visible={new Set<Category>(["3d", "doc"])}
        onChange={onChange}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]!); // uncheck 3d
    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0]![0] as Set<Category>;
    expect(next.has("3d")).toBe(false);
    expect(next.has("doc")).toBe(true);
  });

  it("shows 'All file types' when all categories are visible", () => {
    render(
      <FilterDropdown
        visible={new Set(CATEGORIES)}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByTestId("filter-summary")).toHaveTextContent(
      "All file types",
    );
  });

  it("shows 'No file types' when visible set is empty", () => {
    render(
      <FilterDropdown visible={new Set()} onChange={() => undefined} />,
    );
    expect(screen.getByTestId("filter-summary")).toHaveTextContent(
      "No file types",
    );
  });

  it("shows 'N of M types' when a partial set is visible", () => {
    render(
      <FilterDropdown
        visible={new Set<Category>(["3d", "doc"])}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByTestId("filter-summary")).toHaveTextContent(
      `2 of ${CATEGORIES.length} types`,
    );
  });
});
