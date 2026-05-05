import Link from "next/link";
import type { Entry } from "@/server/storage/types";
import { fileKindOf } from "@/server/browse/file-kind";
import { encodePathSegments } from "@/server/browse/encode-path";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

type Props = {
  providerSlug: string;
  parentPath: string;
  entry: Entry;
  /** Other query params (no leading '?', no view key) — appended to the Open link. */
  searchSuffix: string;
};

export function ColumnDetailStrip({
  providerSlug,
  parentPath,
  entry,
  searchSuffix,
}: Props) {
  const fullPath = joinPath(parentPath, entry.name);
  const encoded = encodePathSegments(fullPath);
  const href = searchSuffix
    ? `/${providerSlug}/${encoded}?${searchSuffix}`
    : `/${providerSlug}/${encoded}`;

  const kind = fileKindOf(entry.name);
  const kindLabel = kind === "other" ? "FILE" : kind.toUpperCase();
  const modified = entry.modifiedAt.toISOString().slice(0, 10);

  return (
    <aside
      aria-live="polite"
      className="flex h-24 items-center gap-4 border-t border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-950"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-neutral-300 bg-neutral-100 text-xs font-semibold uppercase text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
        {kindLabel.slice(0, 3).toLowerCase()}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {entry.name}
        </h2>
        <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
          <span className="font-mono uppercase">{kindLabel}</span>
          <span> · </span>
          <span>{formatBytes(entry.size)}</span>
          <span> · </span>
          <span>{modified}</span>
        </p>
      </div>
      <Link
        href={href}
        className="shrink-0 rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        Open
      </Link>
    </aside>
  );
}
