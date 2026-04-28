// The browse routes used to gate every request on `getCurrentUser()` here,
// but Phase 7 access control means anonymous users may browse public folders.
// Per-path access is enforced inside `[[...path]]/page.tsx` via the resolver.
export default function ProviderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
