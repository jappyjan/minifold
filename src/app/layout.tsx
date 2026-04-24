import type { Metadata } from "next";
import "./globals.css";
import { TRPCProvider } from "@/trpc/Provider";
import { AppShell } from "@/components/shell/AppShell";
import { Sidebar } from "@/components/shell/Sidebar";

export const metadata: Metadata = {
  title: "Minifold",
  description: "Self-hosted file browser",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-50">
        <TRPCProvider>
          <AppShell sidebar={<Sidebar />}>{children}</AppShell>
        </TRPCProvider>
      </body>
    </html>
  );
}
