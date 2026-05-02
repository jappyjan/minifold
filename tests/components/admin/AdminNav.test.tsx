import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminNav } from "@/components/admin/AdminNav";

const pathnameMock = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

beforeEach(() => {
  pathnameMock.mockReset();
});

describe("AdminNav", () => {
  it("renders three tabs", () => {
    pathnameMock.mockReturnValue("/admin/users");
    render(<AdminNav />);
    expect(screen.getByRole("link", { name: "Providers" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("marks the matching tab as active via aria-current", () => {
    pathnameMock.mockReturnValue("/admin/settings");
    render(<AdminNav />);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Users" })).not.toHaveAttribute("aria-current");
  });
});
