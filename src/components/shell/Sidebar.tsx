import Link from "next/link";
import { getCurrentUser } from "@/server/auth/current-user";
import { SignOutButton } from "@/components/auth/SignOutButton";

export async function Sidebar() {
  const user = await getCurrentUser();

  return (
    <aside className="flex h-full w-64 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex h-14 items-center px-4 text-lg font-semibold">
        Minifold
      </div>
      <nav className="flex-1 overflow-y-auto px-2">
        {/* Provider list + folders populated in Phase 3+ */}
      </nav>
      <div className="flex flex-col gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
        {user && (
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            Signed in as <span className="font-medium">{user.name}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <Link
            href="/admin"
            className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            Admin
          </Link>
          {user && <SignOutButton />}
        </div>
      </div>
    </aside>
  );
}
