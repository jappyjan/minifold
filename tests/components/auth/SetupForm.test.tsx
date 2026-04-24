import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { SetupForm } from "@/components/auth/SetupForm";

vi.mock("@/app/setup/actions", () => ({
  createAdmin: vi.fn(async () => ({})),
}));

describe("SetupForm", () => {
  it("renders name, username, password fields + submit", () => {
    render(<SetupForm />);
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create admin/i }),
    ).toBeInTheDocument();
  });

  it("submits form values", async () => {
    const { createAdmin } = await import("@/app/setup/actions");
    render(<SetupForm />);
    await userEvent.type(screen.getByLabelText(/^name$/i), "Jane");
    await userEvent.type(screen.getByLabelText(/username/i), "jane");
    await userEvent.type(
      screen.getByLabelText(/password/i),
      "correct-horse-staple",
    );
    await userEvent.click(screen.getByRole("button", { name: /create admin/i }));
    expect(createAdmin).toHaveBeenCalled();
  });
});
