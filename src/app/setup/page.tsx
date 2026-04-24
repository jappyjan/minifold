import { redirect } from "next/navigation";
import { getDatabase } from "@/server/db";
import { hasAnyAdmin } from "@/server/db/users";
import { SetupForm } from "@/components/auth/SetupForm";

export default function SetupPage() {
  if (hasAnyAdmin(getDatabase())) {
    redirect("/login");
  }
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <h1 className="mb-1 text-2xl font-semibold">Welcome to Minifold</h1>
      <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-400">
        Create your admin account to finish setting up this instance.
      </p>
      <SetupForm />
    </div>
  );
}
