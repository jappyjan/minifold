import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { TopBar } from "@/components/shell/TopBar";

describe("TopBar", () => {
  it("shows the app name", () => {
    render(<TopBar onToggleMenu={() => {}} />);
    expect(screen.getByText("Minifold")).toBeInTheDocument();
  });

  it("calls onToggleMenu when the hamburger is clicked", async () => {
    const onToggle = vi.fn();
    render(<TopBar onToggleMenu={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: /menu/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
