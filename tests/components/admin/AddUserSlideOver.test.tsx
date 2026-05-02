import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddUserSlideOver } from "@/components/admin/AddUserSlideOver";

const addUserMock = vi.fn();
vi.mock("@/app/admin/users/actions", () => ({
  addUser: (...args: unknown[]) => addUserMock(...args),
}));

beforeEach(() => {
  addUserMock.mockReset();
});

describe("AddUserSlideOver", () => {
  it("submits with mode=generate by default", async () => {
    addUserMock.mockResolvedValue({ success: true, generatedPassword: "ABCDEFGHJKMNPQRS" });
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<AddUserSlideOver onClose={onClose} onCreatedWithGenerated={onCreated} />);

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Alice" } });
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "alice" } });
    fireEvent.click(screen.getByRole("button", { name: /create user/i }));

    await waitFor(() => expect(addUserMock).toHaveBeenCalled());
    const fd = addUserMock.mock.calls[0]![1] as FormData;
    expect(fd.get("mode")).toBe("generate");
    expect(fd.get("name")).toBe("Alice");
    expect(fd.get("username")).toBe("alice");
  });

  it("on success with generated password, calls onCreatedWithGenerated and closes", async () => {
    addUserMock.mockResolvedValue({ success: true, generatedPassword: "ABCDEFGHJKMNPQRS" });
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<AddUserSlideOver onClose={onClose} onCreatedWithGenerated={onCreated} />);

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Alice" } });
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "alice" } });
    fireEvent.click(screen.getByRole("button", { name: /create user/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("ABCDEFGHJKMNPQRS"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("on success without generated password (manual mode), only calls onClose", async () => {
    addUserMock.mockResolvedValue({ success: true });
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<AddUserSlideOver onClose={onClose} onCreatedWithGenerated={onCreated} />);

    // Switch to manual mode
    fireEvent.click(screen.getByLabelText(/set password manually/i));

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Alice" } });
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "supersecret" } });
    fireEvent.click(screen.getByRole("button", { name: /create user/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("displays fieldErrors when action returns them", async () => {
    addUserMock.mockResolvedValue({ fieldErrors: { username: "taken" } });
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<AddUserSlideOver onClose={onClose} onCreatedWithGenerated={onCreated} />);

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Alice" } });
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "alice" } });
    fireEvent.click(screen.getByRole("button", { name: /create user/i }));

    expect(await screen.findByText("taken")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
