import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ProviderForm } from "@/components/setup/ProviderForm";

vi.mock("@/app/setup/actions", () => ({
  createFirstProvider: vi.fn(async () => ({})),
}));

describe("ProviderForm", () => {
  it("renders slug, name, rootPath fields + submit", () => {
    render(<ProviderForm />);
    expect(screen.getByLabelText(/slug/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/root path/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add provider/i }),
    ).toBeInTheDocument();
  });

  it("submits form values", async () => {
    const { createFirstProvider } = await import("@/app/setup/actions");
    render(<ProviderForm />);
    await userEvent.type(screen.getByLabelText(/slug/i), "nas");
    await userEvent.type(screen.getByLabelText(/^name$/i), "NAS Files");
    await userEvent.type(screen.getByLabelText(/root path/i), "/files");
    await userEvent.click(screen.getByRole("button", { name: /add provider/i }));
    expect(createFirstProvider).toHaveBeenCalled();
  });
});
