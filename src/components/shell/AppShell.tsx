"use client";

import { useState, type ReactNode } from "react";
import { TopBar } from "./TopBar";

export function AppShell({
  children,
  sidebar,
}: {
  children: ReactNode;
  sidebar: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Desktop sidebar */}
      <div className="hidden md:block">{sidebar}</div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setDrawerOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              setDrawerOpen(false);
            }
          }}
        >
          <div
            className="h-full w-64"
            onClick={(e) => e.stopPropagation()}
            role="presentation"
          >
            {sidebar}
          </div>
        </div>
      )}

      <div className="flex min-h-screen flex-1 flex-col">
        <TopBar onToggleMenu={() => setDrawerOpen((v) => !v)} />
        <main className="flex-1 overflow-auto p-4">{children}</main>
      </div>
    </div>
  );
}
