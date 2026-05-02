import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current-user";
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";

export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="mb-2 text-xl font-semibold">Change password</h1>
      {user.must_change_password === 1 ? (
        <p className="mb-4 text-sm text-amber-700 dark:text-amber-300">
          You must change your password before continuing.
        </p>
      ) : null}
      <ChangePasswordForm />
    </div>
  );
}
