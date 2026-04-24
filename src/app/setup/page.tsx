import { redirect } from "next/navigation";
import { getDatabase } from "@/server/db";
import { hasAnyAdmin } from "@/server/db/users";
import { hasAnyProvider } from "@/server/db/providers";
import { SetupForm } from "@/components/auth/SetupForm";
import { ProviderForm } from "@/components/setup/ProviderForm";

export default function SetupPage() {
  const db = getDatabase();
  const adminExists = hasAnyAdmin(db);
  const providerExists = hasAnyProvider(db);

  if (adminExists && providerExists) {
    redirect("/");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      {!adminExists ? (
        <>
          <h1 className="mb-1 text-2xl font-semibold">Welcome to Minifold</h1>
          <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-400">
            Step 1 of 2 — create your admin account.
          </p>
          <SetupForm />
        </>
      ) : (
        <>
          <h1 className="mb-1 text-2xl font-semibold">Add your first files</h1>
          <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-400">
            Step 2 of 2 — point Minifold at a folder on this host.
          </p>
          <ProviderForm />
        </>
      )}
    </div>
  );
}
