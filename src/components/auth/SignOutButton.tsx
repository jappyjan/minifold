import { logout } from "@/app/logout/actions";

export function SignOutButton() {
  return (
    <form action={logout}>
      <button
        type="submit"
        className="text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        Sign out
      </button>
    </form>
  );
}
