import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccentColorForm } from "@/components/admin/AccentColorForm";

vi.mock("@/app/admin/settings/actions", () => ({
  saveAccentColor: vi.fn().mockResolvedValue({ success: true }),
}));

describe("AccentColorForm", () => {
  it("disables Save when initial colour fails contrast", () => {
    render(<AccentColorForm initialValue="#aaaaaa" />);
    const save = screen.getByRole("button", { name: /save/i });
    expect(save).toBeDisabled();
  });

  it("enables Save for a passing colour", () => {
    render(<AccentColorForm initialValue="#3b82f6" />);
    const save = screen.getByRole("button", { name: /save/i });
    expect(save).not.toBeDisabled();
  });

  it("shows 'Use nearest accessible' button when contrast fails", () => {
    render(<AccentColorForm initialValue="#aaaaaa" />);
    expect(screen.getByRole("button", { name: /use nearest accessible/i })).toBeInTheDocument();
  });

  it("clicking 'Use nearest accessible' updates the input value", () => {
    render(<AccentColorForm initialValue="#ff8888" />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    const oldValue = input.value;
    fireEvent.click(screen.getByRole("button", { name: /use nearest accessible/i }));
    expect(input.value).not.toBe(oldValue);
    expect(input.value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("updates contrast badges as input changes", () => {
    render(<AccentColorForm initialValue="#3b82f6" />);
    // Both passing badges visible initially.
    expect(screen.getAllByText(/aa/i).length).toBeGreaterThanOrEqual(2);
    // Change to failing colour.
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "#aaaaaa" } });
    // Now at least one "below AA" should appear.
    expect(screen.getAllByText(/below aa/i).length).toBeGreaterThanOrEqual(1);
  });
});
