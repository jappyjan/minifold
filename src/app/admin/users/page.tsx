import { getDatabase } from "@/server/db";
import { listUsers } from "@/server/db/users";
import { getCurrentUser } from "@/server/auth/current-user";
import { UsersPageClient } from "@/components/admin/UsersPageClient";

export default async function AdminUsersPage() {
  const users = listUsers(getDatabase());
  const me = await getCurrentUser();
  return <UsersPageClient users={users} currentUserId={me?.id ?? null} />;
}
