import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current-user";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");
  return <>{children}</>;
}
