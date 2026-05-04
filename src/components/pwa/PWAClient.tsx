"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { PWAInstallElement } from "@khmyznikov/pwa-install";

declare global {
  interface Window {
    __minifoldInstallEvent?: Event;
  }
}

// Routes where we never want to render the install prompt:
// - /login, /setup, /change-password are pre-auth or forced-state pages
//   where prompting an install is noise.
// All other behaviour (when to actually show the dialog, dismissal state,
// already-installed detection, iOS-specific share-button instructions vs
// Chromium beforeinstallprompt, etc.) is delegated to @khmyznikov/pwa-install.
function shouldRender(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname.startsWith("/login")) return false;
  if (pathname.startsWith("/setup")) return false;
  if (pathname === "/change-password") return false;
  return true;
}

export function PWAClient() {
  const pathname = usePathname();
  const [libLoaded, setLibLoaded] = useState(false);

  // Service worker registration (production only — prebuild-built sw.js
  // doesn't exist in dev).
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch((err) => console.warn("[minifold] SW registration failed:", err));
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  // Lazy-load the web component module the first time we render on an
  // allowed route. Once loaded, the library auto-mounts itself, listens for
  // beforeinstallprompt, tracks dismissal in localStorage, and decides per
  // platform whether/when to show its UI.
  useEffect(() => {
    if (libLoaded) return;
    if (!shouldRender(pathname)) return;
    let cancelled = false;
    void import("@khmyznikov/pwa-install").then(() => {
      if (!cancelled) setLibLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname, libLoaded]);

  if (!shouldRender(pathname) || !libLoaded) return null;
  return (
    <pwa-install
      ref={(el: PWAInstallElement | null) => {
        if (!el) return;
        // Hand the early-captured beforeinstallprompt event to the component
        // (Chromium path). The inline script in app/layout.tsx stashes the
        // event before React hydrates so it isn't lost.
        if (window.__minifoldInstallEvent) {
          el.externalPromptEvent =
            window.__minifoldInstallEvent as unknown as PWAInstallElement["externalPromptEvent"];
        }
      }}
      // Without these attributes the library's dialog falls back to generic
      // placeholders ("PWA", "Progressive web application", literal "icon"
      // text). manifest-url lets the library read the live name (which
      // reflects the operator's app_name setting); icon points at the
      // dispatch route so the operator's uploaded logo is shown.
      manifest-url="/manifest.webmanifest"
      icon="/api/icon/512/any.png"
      description="Self-hosted file browser"
    />
  );
}
