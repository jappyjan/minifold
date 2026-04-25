"use client";

import { useActionState, useState } from "react";
import {
  createFirstProvider,
  type ProviderFormState,
} from "@/app/setup/actions";

const initialState: ProviderFormState = {};

export function ProviderForm() {
  const [state, action, pending] = useActionState(
    createFirstProvider,
    initialState,
  );
  const [type, setType] = useState<"local" | "s3">("local");

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="type" value={type} />

      {/* Type toggle */}
      <div>
        <p className="mb-2 text-sm font-medium">Type</p>
        <div className="flex gap-2">
          {(["local", "s3"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                type === t
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "border border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900"
              }`}
            >
              {t === "local" ? "Local" : "S3"}
            </button>
          ))}
        </div>
      </div>

      {/* Name — shared */}
      <label className="flex flex-col gap-1 text-sm">
        <span>Name</span>
        <input
          name="name"
          type="text"
          required
          placeholder="e.g. NAS Files"
          className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        />
        {state.fieldErrors?.name && (
          <span className="text-xs text-red-600">{state.fieldErrors.name}</span>
        )}
      </label>

      {/* Local fields */}
      {type === "local" && (
        <label className="flex flex-col gap-1 text-sm">
          <span>Root path</span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            Absolute path inside the container, e.g.{" "}
            <code className="font-mono">/files</code>
          </span>
          <input
            name="rootPath"
            type="text"
            required
            defaultValue="/files"
            className="rounded border border-neutral-300 bg-white px-3 py-2 font-mono dark:border-neutral-700 dark:bg-neutral-900"
          />
          {state.fieldErrors?.rootPath && (
            <span className="text-xs text-red-600">
              {state.fieldErrors.rootPath}
            </span>
          )}
        </label>
      )}

      {/* S3 fields */}
      {type === "s3" && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span>Bucket</span>
            <input
              name="bucket"
              type="text"
              required
              className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {state.fieldErrors?.bucket && (
              <span className="text-xs text-red-600">
                {state.fieldErrors.bucket}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>Region</span>
            <input
              name="region"
              type="text"
              required
              placeholder="us-east-1"
              className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {state.fieldErrors?.region && (
              <span className="text-xs text-red-600">
                {state.fieldErrors.region}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>Access Key ID</span>
            <input
              name="accessKeyId"
              type="text"
              required
              autoComplete="off"
              className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {state.fieldErrors?.accessKeyId && (
              <span className="text-xs text-red-600">
                {state.fieldErrors.accessKeyId}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>Secret Access Key</span>
            <input
              name="secretAccessKey"
              type="password"
              required
              autoComplete="new-password"
              className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {state.fieldErrors?.secretAccessKey && (
              <span className="text-xs text-red-600">
                {state.fieldErrors.secretAccessKey}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span>
              Endpoint URL{" "}
              <span className="font-normal text-neutral-500">(optional)</span>
            </span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              For MinIO, Backblaze B2, Cloudflare R2, etc.
            </span>
            <input
              name="endpoint"
              type="text"
              placeholder="https://s3.example.com"
              className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              name="pathStyle"
              type="checkbox"
              value="true"
              className="rounded"
            />
            <span>Path-style URLs</span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              (needed for some self-hosted S3)
            </span>
          </label>
        </>
      )}

      {/* Advanced: slug */}
      <details className="rounded border border-neutral-200 px-3 py-2 text-sm open:pb-3 dark:border-neutral-800">
        <summary className="cursor-pointer text-neutral-600 dark:text-neutral-400">
          Advanced
        </summary>
        <label className="mt-3 flex flex-col gap-1">
          <span>Slug</span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            URL-safe identifier — auto-generated from name if left blank.
          </span>
          <input
            name="slug"
            type="text"
            placeholder="auto"
            className="rounded border border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          />
          {state.fieldErrors?.slug && (
            <span className="text-xs text-red-600">
              {state.fieldErrors.slug}
            </span>
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
