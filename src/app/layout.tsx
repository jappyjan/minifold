import "./globals.css";
import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { TRPCProvider } from "@/trpc/Provider";
import { AppShell } from "@/components/shell/AppShell";
import { Sidebar } from "@/components/shell/Sidebar";
import { SettingsProvider } from "@/components/SettingsContext";
import { getDatabase } from "@/server/db";
import { getAllSettings } from "@/server/db/settings";
import { getCurrentUser } from "@/server/auth/current-user";
import { PWAClient } from "@/components/pwa/PWAClient";

export async function generateMetadata() {
  const settings = getAllSettings(getDatabase());
  return {
    title: settings.app_name || "Minifold",
    description: "Self-hosted file browser",
  };
}

const BYPASS_PATHS = ["/change-password", "/logout", "/login", "/api/"];

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = getAllSettings(getDatabase());
  const appName = settings.app_name || "Minifold";
  const accent = settings.accent_color || "#3b82f6";
  const logoUrl = settings.logo_url || "";

  // Forced-change gate.
  const user = await getCurrentUser();
  if (user && user.must_change_password === 1) {
    const h = await headers();
    const pathname = h.get("x-pathname") ?? "";
    const isBypass = BYPASS_PATHS.some(
      (p) => pathname === p || pathname.startsWith(p),
    );
    if (!isBypass) {
      redirect("/change-password");
    }
  }

  return (
    <html lang="en" style={{ "--accent": accent } as CSSProperties}>
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/api/icon/180/any.png" />
        <meta name="theme-color" content={accent} />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                window.__minifoldInstallEvent = e;
              });
            `,
          }}
        />
      </head>
      <body className="bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-50">
        <TRPCProvider>
          <SettingsProvider value={{ appName, accent, logoUrl }}>
            <AppShell sidebar={<Sidebar appName={appName} />}>{children}</AppShell>
          </SettingsProvider>
        </TRPCProvider>
        <PWAClient />
      </body>
    </html>
  );
}
