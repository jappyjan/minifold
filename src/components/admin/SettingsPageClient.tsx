"use client";

import { AppNameForm } from "@/components/admin/AppNameForm";
import { LogoForm } from "@/components/admin/LogoForm";
import { AccentColorForm } from "@/components/admin/AccentColorForm";

export function SettingsPageClient({
  appName,
  logoUrl,
  accentColor,
}: {
  appName: string;
  logoUrl: string;
  accentColor: string;
}) {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <SectionCard title="App name" description="Shown in the UI and PWA manifest">
        <AppNameForm initialValue={appName} />
      </SectionCard>
      <SectionCard title="Logo" description="PNG, SVG, or WebP up to 256 KB. Or paste a URL.">
        <LogoForm initialValue={logoUrl} />
      </SectionCard>
      <SectionCard title="Accent colour" description="Used for highlights, links, active states.">
        <AccentColorForm initialValue={accentColor} />
      </SectionCard>
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-neutral-500">{description}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}
