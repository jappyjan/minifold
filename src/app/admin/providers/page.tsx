// src/app/admin/providers/page.tsx
import { getDatabase } from "@/server/db";
import { listProviders } from "@/server/db/providers";
import { ProvidersPageClient } from "@/components/admin/ProvidersPageClient";

export default function AdminProvidersPage() {
  const providers = listProviders(getDatabase());
  return <ProvidersPageClient providers={providers} />;
}
