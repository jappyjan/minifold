import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Sidebar } from "@/components/shell/Sidebar";

describe("Sidebar", () => {
  it("renders the app name", () => {
    render(<Sidebar />);
    expect(screen.getByText("Minifold")).toBeInTheDocument();
  });

  it("has an admin link at the bottom", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link", { name: /admin/i })).toBeInTheDocument();
  });
});
