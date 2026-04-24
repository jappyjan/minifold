import Link from "next/link";
import { getCurrentUser } from "@/server/auth/current-user";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { getDatabase } from "@/server/db";
import { listProviders } from "@/server/db/providers";

export async function Sidebar() {
  const user = await getCurrentUser();
  const providers = user ? listProviders(getDatabase()) : [];

  return (
    <aside className="flex h-full w-64 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex h-14 items-center px-4 text-lg font-semibold">
        Minifold
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {providers.length > 0 && (
          <div>
            <div className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              Providers
            </div>
            <ul className="flex flex-col">
              {providers.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/${p.slug}`}
                    className="block rounded px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  >
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
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
