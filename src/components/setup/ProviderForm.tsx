"use client";

import { useActionState } from "react";
import {
  createFirstProvider,
  type ProviderFormState,
} from "@/app/setup/actions";

const initialState: ProviderFormState = {};

export function ProviderForm() {
  const [state, action, pending] = useActionState(createFirstProvider, initialState);

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
        <span>Root path</span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          Absolute path inside the container, e.g. <code>/files</code>.
        </span>
        <input
          name="rootPath"
          type="text"
          required
          defaultValue="/files"
          className="rounded border border-neutral-300 bg-white px-3 py-2 font-mono dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.rootPath && (
          <span className="text-xs text-red-600">{state.fieldErrors.rootPath}</span>
        )}
      </label>

      <details className="rounded border border-neutral-200 px-3 py-2 text-sm open:pb-3 dark:border-neutral-800">
        <summary className="cursor-pointer text-neutral-600 dark:text-neutral-400">
          Advanced
        </summary>
        <label className="mt-3 flex flex-col gap-1">
          <span>Slug</span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            URL-safe identifier — auto-generated from the name if left blank.
          </span>
          <input
            name="slug"
            type="text"
            placeholder="auto"
            className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          />
          {state.fieldErrors?.slug && (
            <span className="text-xs text-red-600">{state.fieldErrors.slug}</span>
          )}
        </label>
      </details>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {pending ? "Adding…" : "Add provider"}
      </button>
    </form>
  );
}
