"use client";

import Link from "next/link";
import type { Entry } from "@/server/storage/types";
import { fileKindOf } from "@/server/browse/file-kind";
import { encodePathSegments } from "@/server/browse/encode-path";
import { Thumbnail } from "./Thumbnail";

type Props = {
  providerSlug: string;
  parentPath: string;
  entry: Entry;
  thumbnailsEnabled: boolean;
};

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function EntryCard({
  providerSlug,
  parentPath,
  entry,
  thumbnailsEnabled,
}: Props) {
  const childPath = joinPath(parentPath, entry.name);
  const href = `/${providerSlug}/${encodePathSegments(childPath)}`;

  const kind = entry.type === "file" ? fileKindOf(entry.name) : null;
  const showThumb = thumbnailsEnabled && (kind === "stl" || kind === "3mf");
  const thumbUrl = showThumb
    ? `/api/thumb/${providerSlug}/${encodePathSegments(childPath)}`
    : null;

  return (
    <Link
      href={href}
      className="group flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-center transition-colors hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-neutral-600 dark:hover:bg-neutral-900"
    >
      {thumbUrl ? (
        <Thumbnail
          src={thumbUrl}
          className="h-12 w-12 rounded"
          fallback={<Icon entry={entry} />}
        />
      ) : (
        <Icon entry={entry} />
      )}
      <span className="line-clamp-2 break-all text-xs text-neutral-700 dark:text-neutral-300">
        {entry.name}
      </span>
    </Link>
  );
}

function Icon({ entry }: { entry: Entry }) {
  if (entry.type === "directory") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="h-12 w-12 fill-neutral-300 group-hover:fill-neutral-400 dark:fill-neutral-700 dark:group-hover:fill-neutral-600"
        aria-hidden="true"
      >
        <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />
      </svg>
    );
  }
  const kind = fileKindOf(entry.name);
  const label = kind === "other" ? "FILE" : kind.toUpperCase();
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded border border-neutral-300 bg-neutral-100 text-[10px] font-medium uppercase text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
      {label}
    </div>
  );
}
