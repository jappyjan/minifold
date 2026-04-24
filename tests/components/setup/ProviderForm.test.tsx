import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ProviderForm } from "@/components/setup/ProviderForm";

vi.mock("@/app/setup/actions", () => ({
  createFirstProvider: vi.fn(async () => ({})),
}));

describe("ProviderForm", () => {
  it("renders name + rootPath + submit; slug lives under Advanced", () => {
    render(<ProviderForm />);
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/root path/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add provider/i }),
    ).toBeInTheDocument();

    // "Advanced" disclosure contains the slug input. The input is in the DOM
    // (so overrides work without extra plumbing) but tucked under <details>.
    expect(screen.getByText(/advanced/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/slug/i)).toBeInTheDocument();
  });

  it("submits with name + rootPath only (slug auto-generates)", async () => {
    const { createFirstProvider } = await import("@/app/setup/actions");
    render(<ProviderForm />);
    await userEvent.type(screen.getByLabelText(/^name$/i), "NAS Files");
    await userEvent.clear(screen.getByLabelText(/root path/i));
    await userEvent.type(screen.getByLabelText(/root path/i), "/files");
    await userEvent.click(screen.getByRole("button", { name: /add provider/i }));
    expect(createFirstProvider).toHaveBeenCalled();
  });

  it("submits with a custom slug when provided", async () => {
    const { createFirstProvider } = await import("@/app/setup/actions");
    render(<ProviderForm />);
    await userEvent.type(screen.getByLabelText(/^name$/i), "NAS Files");
    await userEvent.clear(screen.getByLabelText(/root path/i));
    await userEvent.type(screen.getByLabelText(/root path/i), "/files");
    await userEvent.type(screen.getByLabelText(/slug/i), "my-nas");
    await userEvent.click(screen.getByRole("button", { name: /add provider/i }));
    expect(createFirstProvider).toHaveBeenCalled();
  });
});
