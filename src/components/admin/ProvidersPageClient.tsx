// src/components/admin/ProvidersPageClient.tsx
"use client";

import { useCallback, useState } from "react";
import type { ProviderRow } from "@/server/db/providers";
import { deleteProvider } from "@/app/admin/providers/actions";
import { AddProviderSlideOver } from "./AddProviderSlideOver";

export function ProvidersPageClient({
  providers,
}: {
  providers: ProviderRow[];
}) {
  const [open, setOpen] = useState(false);
  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Providers</h1>
        <button
          onClick={() => setOpen(true)}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          + Add provider
        </button>
      </div>

      {providers.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          No providers yet.{" "}
          <button
            onClick={() => setOpen(true)}
            className="underline hover:no-underline"
          >
            Add one
          </button>
          .
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {providers.map((p) => (
            <li
              key={p.slug}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{p.name}</span>
                <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
                  {p.slug}
                </span>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                  {p.type}
                </span>
              </div>
              <form
                action={deleteProvider.bind(null, undefined)}
                onSubmit={(e) => {
                  if (
                    !window.confirm(
                      `Remove provider "${p.name}"? This cannot be undone.`,
                    )
                  ) {
                    e.preventDefault();
                  }
                }}
              >
                <input type="hidden" name="slug" value={p.slug} />
                <button
                  type="submit"
                  className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                >
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <AddProviderSlideOver open={open} onClose={handleClose} />
    </div>
  );
}
