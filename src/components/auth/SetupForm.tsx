"use client";

import { useActionState } from "react";
import { createAdmin, type SetupFormState } from "@/app/setup/actions";

const initialState: SetupFormState = {};

export function SetupForm() {
  const [state, action, pending] = useActionState(createAdmin, initialState);

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span>Name</span>
        <input
          name="name"
          type="text"
          required
          className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.name && (
          <span className="text-xs text-red-600">{state.fieldErrors.name}</span>
        )}
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>Username</span>
        <input
          name="username"
          type="text"
          required
          autoComplete="username"
          className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.username && (
          <span className="text-xs text-red-600">{state.fieldErrors.username}</span>
        )}
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.password && (
          <span className="text-xs text-red-600">
            {state.fieldErrors.password}
          </span>
        )}
      </label>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {pending ? "Creating…" : "Create admin"}
      </button>
    </form>
  );
}
