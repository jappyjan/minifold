"use client";

import { useState } from "react";
import {
  saveLogo,
  clearLogo,
  type SimpleFormState,
} from "@/app/admin/settings/actions";

type Source = "url" | "upload";

function deriveSource(value: string): Source {
  return value.startsWith("internal:") ? "upload" : "url";
}

function deriveDisplayUrl(value: string): string {
  if (!value) return "";
  if (value.startsWith("internal:")) return "/api/logo";
  return value;
}

export function LogoForm({ initialValue }: { initialValue: string }) {
  const [source, setSource] = useState<Source>(deriveSource(initialValue));
  const [state, setState] = useState<SimpleFormState<"url" | "file">>({});
  const [pending, setPending] = useState(false);
  const display = deriveDisplayUrl(initialValue);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setState({});
    const fd = new FormData(e.currentTarget);
    fd.set("source", source);
    const result = await saveLogo(state, fd);
    setPending(false);
    setState(result);
    if (result.success) {
      // Reload to pick up the new logo and trigger context refresh.
      window.location.reload();
    }
  }

  async function onClear() {
    setPending(true);
    await clearLogo();
    setPending(false);
    window.location.reload();
  }

  return (
    <div className="space-y-3">
      {display ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500">Current:</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={display} alt="Current logo" className="h-12 w-12 rounded border border-neutral-200 object-contain dark:border-neutral-800" />
        </div>
      ) : null}

      <fieldset className="space-y-1">
        <legend className="text-sm">Source</legend>
        <label className="block text-sm">
          <input type="radio" checked={source === "url"} onChange={() => setSource("url")} /> URL
        </label>
        <label className="block text-sm">
          <input type="radio" checked={source === "upload"} onChange={() => setSource("upload")} /> Upload
        </label>
      </fieldset>

      <form onSubmit={onSubmit} className="space-y-2">
        {source === "url" ? (
          <label className="block">
            <span className="text-sm">URL</span>
            <input
              name="url"
              type="text"
              defaultValue={initialValue.startsWith("internal:") ? "" : initialValue}
              placeholder="https://… or /static/logo.png"
              className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
            />
            {state.fieldErrors?.url ? (
              <span className="text-xs text-red-600">{state.fieldErrors.url}</span>
            ) : null}
          </label>
        ) : (
          <label className="block">
            <span className="text-sm">File (PNG / SVG / WebP, ≤256 KB)</span>
            <input
              name="file"
              type="file"
              accept=".png,.svg,.webp,image/png,image/svg+xml,image/webp"
              className="mt-1 block w-full text-sm"
            />
            {state.fieldErrors?.file ? (
              <span className="text-xs text-red-600">{state.fieldErrors.file}</span>
            ) : null}
          </label>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          {initialValue ? (
            <button
              type="button"
              onClick={onClear}
              disabled={pending}
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
            >
              Clear logo
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
