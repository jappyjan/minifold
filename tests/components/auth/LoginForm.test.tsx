import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { LoginForm } from "@/components/auth/LoginForm";

vi.mock("@/app/login/actions", () => ({
  login: vi.fn(async () => ({})),
}));

describe("LoginForm", () => {
  it("renders username + password + submit", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("submits form values", async () => {
    const { login } = await import("@/app/login/actions");
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/username/i), "jane");
    await userEvent.type(screen.getByLabelText(/password/i), "pw");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(login).toHaveBeenCalled();
  });
});
