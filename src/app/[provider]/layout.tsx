import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current-user";

// Auth guard for browse routes. The top-level proxy excludes paths containing
// a dot (so it doesn't redirect static-asset-looking URLs), which means a
// signed-out user hitting /nas/anything.md slips past the proxy entirely.
// This layout is the single point of enforcement for everything under
// /{provider}/.
export default async function ProviderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <>{children}</>;
}
