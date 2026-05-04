"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { usePathname } from "next/navigation";
import type { PWAInstallElement } from "@khmyznikov/pwa-install";

const DISMISSED_KEY = "minifold:pwa-dismissed";
const PROMPT_DELAY_MS = 30_000;

declare global {
  interface Window {
    __minifoldInstallEvent?: Event;
  }
}

function shouldShowPrompt(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname.startsWith("/login")) return false;
  if (pathname.startsWith("/setup")) return false;
  if (pathname === "/change-password") return false;
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return false;
  if (window.localStorage.getItem(DISMISSED_KEY)) return false;
  return true;
}

export function PWAClient() {
  const pathname = usePathname();
  const [showPrompt, setShowPrompt] = useState(false);
  const elementRef = useRef<PWAInstallElement | null>(null);

  // Service worker registration (production only).
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

  // 30-second install-prompt timer.
  useEffect(() => {
    if (!shouldShowPrompt(pathname)) return;
    const id = window.setTimeout(() => flushSync(() => setShowPrompt(true)), PROMPT_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [pathname]);

  // Lazy-load the web component module + wire externalPromptEvent + showDialog.
  useEffect(() => {
    if (!showPrompt) return;
    let cancelled = false;
    void import("@khmyznikov/pwa-install").then(() => {
      if (cancelled) return;
      const el = elementRef.current;
      if (!el) return;
      // Hand the captured beforeinstallprompt event to the component (Chromium path).
      // The library reads this via the `externalPromptEvent` JS property.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      el.externalPromptEvent = (window.__minifoldInstallEvent ?? null) as any;
      const onChoice = () => {
        try {
          window.localStorage.setItem(DISMISSED_KEY, "1");
        } catch {
          // ignore — quota or private mode
        }
      };
      el.addEventListener("pwa-install-success-event", onChoice);
      el.addEventListener("pwa-install-user-choice-result-event", onChoice);
      el.addEventListener("pwa-install-fail-event", onChoice);
      el.showDialog?.(true);
    });
    return () => {
      cancelled = true;
    };
  }, [showPrompt]);

  if (!showPrompt) return null;
  return (
    <pwa-install
      ref={elementRef}
      manual-chrome="true"
      manual-apple="true"
      disable-screenshots="true"
    />
  );
}
