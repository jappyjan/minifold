import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Sidebar } from "@/components/shell/Sidebar";

vi.mock("@/server/auth/current-user", () => ({
  getCurrentUser: vi.fn(async () => null),
}));
vi.mock("@/app/logout/actions", () => ({ logout: vi.fn() }));

describe("Sidebar", () => {
  it("renders the app name", async () => {
    const node = await Sidebar();
    render(node);
    expect(screen.getByText("Minifold")).toBeInTheDocument();
  });

  it("has an admin link", async () => {
    const node = await Sidebar();
    render(node);
    expect(screen.getByRole("link", { name: /admin/i })).toBeInTheDocument();
  });

  it("shows 'Signed in as' when a session exists", async () => {
    const { getCurrentUser } = await import("@/server/auth/current-user");
    vi.mocked(getCurrentUser).mockResolvedValueOnce({
      id: "u1",
      name: "Jane",
      username: "jane",
      password: "$hash",
      role: "admin",
      must_change_password: 0,
      deactivated: 0,
      created_at: Date.now(),
      last_login: null,
    });
    const node = await Sidebar();
    render(node);
    expect(screen.getByText(/signed in as/i)).toBeInTheDocument();
    expect(screen.getByText("Jane")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });
});
