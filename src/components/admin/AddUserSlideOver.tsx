"use client";

import { useState, useEffect } from "react";
import { addUser, type AddUserFormState } from "@/app/admin/users/actions";

type Mode = "generate" | "manual";

export function AddUserSlideOver({
  onClose,
  onCreatedWithGenerated,
}: {
  onClose: () => void;
  onCreatedWithGenerated: (pw: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("generate");
  const [state, setState] = useState<AddUserFormState>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setState({});
    const fd = new FormData(e.currentTarget);
    fd.set("mode", mode);
    const result: AddUserFormState = await addUser(state, fd);
    setPending(false);
    setState(result);
    if (result.success) {
      if (result.generatedPassword) onCreatedWithGenerated(result.generatedPassword);
      onClose();
    }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add user</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-2xl leading-none">×</button>
        </div>

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <div>
            <label htmlFor="add-user-name" className="block text-sm">Name</label>
            <input
              id="add-user-name"
              name="name"
              type="text"
              required
              maxLength={200}
              className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {state.fieldErrors?.name ? (
              <span className="text-xs text-red-600">{state.fieldErrors.name}</span>
            ) : null}
          </div>

          <div>
            <label htmlFor="add-user-username" className="block text-sm">Username</label>
            <input
              id="add-user-username"
              name="username"
              type="text"
              autoComplete="username"
              required
              minLength={3}
              maxLength={64}
              pattern="[a-z0-9_\-]+"
              className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 font-mono dark:border-neutral-700 dark:bg-neutral-900"
            />
            {state.fieldErrors?.username ? (
              <span className="text-xs text-red-600">{state.fieldErrors.username}</span>
            ) : null}
          </div>

          <fieldset className="space-y-1">
            <legend className="text-sm">Password</legend>
            <label className="block text-sm">
              <input
                type="radio"
                name="mode-radio"
                checked={mode === "generate"}
                onChange={() => setMode("generate")}
              />{" "}
              Generate password
            </label>
            <label className="block text-sm">
              <input
                type="radio"
                name="mode-radio"
                checked={mode === "manual"}
                onChange={() => setMode("manual")}
              />{" "}
              Set password manually
            </label>
          </fieldset>

          {mode === "manual" ? (
            <div>
              <label htmlFor="add-user-password" className="block text-sm">Password</label>
              <input
                id="add-user-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
              />
              {state.fieldErrors?.password ? (
                <span className="text-xs text-red-600">{state.fieldErrors.password}</span>
              ) : null}
            </div>
          ) : null}

          {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {pending ? "Creating…" : "Create user"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
