"use client";

import { useActionState } from "react";
import { changePassword, type ChangePasswordState } from "@/app/change-password/actions";

const INITIAL: ChangePasswordState = {};

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, INITIAL);
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="text-sm">Current password</span>
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.currentPassword ? (
          <span className="text-xs text-red-600">{state.fieldErrors.currentPassword}</span>
        ) : null}
      </label>
      <label className="block">
        <span className="text-sm">New password</span>
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.newPassword ? (
          <span className="text-xs text-red-600">{state.fieldErrors.newPassword}</span>
        ) : null}
      </label>
      <label className="block">
        <span className="text-sm">Confirm new password</span>
        <input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.confirmPassword ? (
          <span className="text-xs text-red-600">{state.fieldErrors.confirmPassword}</span>
        ) : null}
      </label>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50"
      >
        {pending ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}
