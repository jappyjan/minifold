import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current-user";
import { AdminNav } from "@/components/admin/AdminNav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");
  return (
    <div>
      <AdminNav />
      <div className="p-4">{children}</div>
    </div>
  );
}
