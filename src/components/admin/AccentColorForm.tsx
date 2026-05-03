"use client";

import { useState, useMemo } from "react";
import { validateAccent, nearestAccessible } from "@/server/auth/contrast";
import { saveAccentColor } from "@/app/admin/settings/actions";

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function AccentColorForm({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  const isValidHex = HEX_RE.test(value);
  const report = useMemo(() => (isValidHex ? validateAccent(value) : null), [value, isValidHex]);
  const suggestion = useMemo(
    () => (isValidHex && report && !report.passes ? nearestAccessible(value) : null),
    [value, report, isValidHex],
  );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setPending(true);
    const fd = new FormData();
    fd.append("value", value);
    const result = await saveAccentColor({}, fd);
    setPending(false);
    if (result.success) {
      setSuccess(true);
      // Reload so the new --accent CSS var takes effect.
      setTimeout(() => window.location.reload(), 600);
      return;
    }
    setError(result.fieldErrors?.value ?? result.error ?? "Could not save");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={isValidHex ? value : "#000000"}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Colour picker"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Hex colour"
          className="w-32 rounded border border-neutral-300 px-2 py-1 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <span
          aria-label="Preview"
          className="inline-block h-8 w-8 rounded"
          style={{ backgroundColor: isValidHex ? value : "transparent" }}
        />
      </div>

      {report ? (
        <ul className="text-sm">
          <li>
            Light bg: {report.light.ratio.toFixed(2)}:1 —{" "}
            <span className={report.light.passes ? "text-green-600" : "text-red-600"}>
              {report.light.passes ? "AA" : "below AA"}
            </span>
          </li>
          <li>
            Dark bg: {report.dark.ratio.toFixed(2)}:1 —{" "}
            <span className={report.dark.passes ? "text-green-600" : "text-red-600"}>
              {report.dark.passes ? "AA" : "below AA"}
            </span>
          </li>
        </ul>
      ) : null}

      {suggestion ? (
        <button
          type="button"
          onClick={() => setValue(suggestion)}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
        >
          Use nearest accessible:&nbsp;
          <span className="inline-block h-4 w-4 align-middle rounded" style={{ backgroundColor: suggestion }} />
          &nbsp;<code className="font-mono">{suggestion}</code>
        </button>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-green-600">Saved.</p> : null}

      <button
        type="submit"
        disabled={pending || !report || !report.passes}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
