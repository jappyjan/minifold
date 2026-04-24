import { LoginForm } from "@/components/auth/LoginForm";

type SearchParams = { callbackUrl?: string };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <h1 className="mb-1 text-2xl font-semibold">Sign in to Minifold</h1>
      <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-400">
        Enter your credentials to continue.
      </p>
      <LoginForm callbackUrl={params.callbackUrl} />
    </div>
  );
}
