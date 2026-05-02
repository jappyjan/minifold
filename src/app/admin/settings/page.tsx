import { getDatabase } from "@/server/db";
import { getAllSettings } from "@/server/db/settings";
import { SettingsPageClient } from "@/components/admin/SettingsPageClient";

export default async function AdminSettingsPage() {
  const settings = getAllSettings(getDatabase());
  return (
    <SettingsPageClient
      appName={settings.app_name || "Minifold"}
      logoUrl={settings.logo_url || ""}
      accentColor={settings.accent_color || "#3b82f6"}
    />
  );
}
