import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { PWAClient } from "@/components/pwa/PWAClient";

// Mock the dynamic import — the test environment can't load the web component module.
vi.mock("@khmyznikov/pwa-install", () => ({}));
const usePathname = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => usePathname() }));

beforeEach(() => {
  usePathname.mockReturnValue("/");
  vi.useFakeTimers();
  // Default: production-mode (set via vi.stubEnv).
  vi.stubEnv("NODE_ENV", "production");
  // matchMedia: not standalone.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  // localStorage clean.
  window.localStorage.clear();
  // navigator.serviceWorker mock.
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: vi.fn().mockResolvedValue(undefined), ready: Promise.resolve(undefined) },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PWAClient", () => {
  it("registers the service worker on mount in production", async () => {
    render(<PWAClient />);
    // PWAClient registers on window 'load' — fire it.
    window.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(0);
    expect(navigator.serviceWorker.register).toHaveBeenCalledWith(
      "/sw.js",
      expect.objectContaining({ scope: "/", updateViaCache: "none" }),
    );
  });

  it("does NOT register the service worker in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    render(<PWAClient />);
    window.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(0);
    expect(navigator.serviceWorker.register).not.toHaveBeenCalled();
  });

  it("mounts <pwa-install> after 30 seconds on /", async () => {
    const { container } = render(<PWAClient />);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(container.querySelector("pwa-install")).toBeTruthy();
  });

  it("does NOT mount <pwa-install> on /login", async () => {
    usePathname.mockReturnValue("/login");
    const { container } = render(<PWAClient />);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(container.querySelector("pwa-install")).toBeNull();
  });

  it("does NOT mount <pwa-install> on /setup", async () => {
    usePathname.mockReturnValue("/setup/admin");
    const { container } = render(<PWAClient />);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(container.querySelector("pwa-install")).toBeNull();
  });

  it("does NOT mount <pwa-install> when running standalone", async () => {
    (window.matchMedia as ReturnType<typeof vi.fn>).mockImplementation((q: string) => ({
      matches: q === "(display-mode: standalone)",
      media: q, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const { container } = render(<PWAClient />);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(container.querySelector("pwa-install")).toBeNull();
  });

  it("does NOT mount <pwa-install> when previously dismissed", async () => {
    window.localStorage.setItem("minifold:pwa-dismissed", "1");
    const { container } = render(<PWAClient />);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(container.querySelector("pwa-install")).toBeNull();
  });
});
