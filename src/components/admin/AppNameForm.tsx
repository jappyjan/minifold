"use client";

import { useActionState } from "react";
import {
  saveAppName,
  type SimpleFormState,
} from "@/app/admin/settings/actions";

const INITIAL: SimpleFormState<"value"> = {};

export function AppNameForm({ initialValue }: { initialValue: string }) {
  const [state, action, pending] = useActionState(saveAppName, INITIAL);
  return (
    <form action={action} className="flex items-start gap-2">
      <label className="flex-1">
        <input
          name="value"
          type="text"
          defaultValue={initialValue}
          maxLength={60}
          required
          className="block w-full rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.value ? (
          <span className="text-xs text-red-600">{state.fieldErrors.value}</span>
        ) : null}
        {state.success ? <span className="text-xs text-green-600">Saved.</span> : null}
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
