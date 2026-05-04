import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { PWAClient } from "@/components/pwa/PWAClient";

// Mock the dynamic import — happy-dom can't load the real web component.
vi.mock("@khmyznikov/pwa-install", () => ({}));
const usePathname = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => usePathname() }));

beforeEach(() => {
  usePathname.mockReturnValue("/");
  vi.stubEnv("NODE_ENV", "production");
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      register: vi.fn().mockResolvedValue(undefined),
      ready: Promise.resolve(undefined),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("PWAClient", () => {
  it("registers the service worker on window load in production", async () => {
    render(<PWAClient />);
    window.dispatchEvent(new Event("load"));
    await Promise.resolve();
    expect(navigator.serviceWorker.register).toHaveBeenCalledWith(
      "/sw.js",
      expect.objectContaining({ scope: "/", updateViaCache: "none" }),
    );
  });

  it("does NOT register the service worker in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    render(<PWAClient />);
    window.dispatchEvent(new Event("load"));
    await Promise.resolve();
    expect(navigator.serviceWorker.register).not.toHaveBeenCalled();
  });

  it("mounts <pwa-install> on / once the library module has loaded", async () => {
    const { container, findByTestId: _ignored } = render(<PWAClient />);
    void _ignored;
    // Wait for the dynamic import promise to resolve and React to commit.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector("pwa-install")).toBeTruthy();
  });

  it("does NOT mount <pwa-install> on /login", async () => {
    usePathname.mockReturnValue("/login");
    const { container } = render(<PWAClient />);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector("pwa-install")).toBeNull();
  });

  it("does NOT mount <pwa-install> on /setup/...", async () => {
    usePathname.mockReturnValue("/setup/admin");
    const { container } = render(<PWAClient />);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector("pwa-install")).toBeNull();
  });

  it("does NOT mount <pwa-install> on /change-password", async () => {
    usePathname.mockReturnValue("/change-password");
    const { container } = render(<PWAClient />);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector("pwa-install")).toBeNull();
  });
});
