import Link from "next/link";
import type { Entry } from "@/server/storage/types";
import { fileKindOf } from "@/server/browse/file-kind";
import { encodePathSegments } from "@/server/browse/encode-path";

type Props = {
  providerSlug: string;
  path: string;
  headerLabel: string;
  entries: readonly Entry[];
  activeName: string | null;
  /** Other query params (no leading '?', no view key) — appended to each link's URL. */
  searchSuffix: string;
};

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function buildHref(
  providerSlug: string,
  path: string,
  name: string,
  searchSuffix: string,
): string {
  const target = joinPath(path, name);
  const encoded = encodePathSegments(target);
  const qs = searchSuffix ? `${searchSuffix}&view=column` : "view=column";
  return `/${providerSlug}/${encoded}?${qs}`;
}

function FileTypeIcon({ entry }: { entry: Entry }) {
  if (entry.type === "directory") {
    return (
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 shrink-0 fill-neutral-400 dark:fill-neutral-600"
        aria-hidden="true"
      >
        <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />
      </svg>
    );
  }
  const kind = fileKindOf(entry.name);
  const label = kind === "other" ? "FILE" : kind.toUpperCase();
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-neutral-300 bg-neutral-100 text-[8px] font-medium uppercase text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
      {label.slice(0, 3)}
    </span>
  );
}

export function Column({
  providerSlug,
  path,
  headerLabel,
  entries,
  activeName,
  searchSuffix,
}: Props) {
  return (
    <nav
      aria-label={headerLabel}
      className="flex h-full w-60 shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800"
      style={{ scrollSnapAlign: "start" }}
    >
      <div className="h-8 truncate border-b border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-medium uppercase tracking-wide text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
        {headerLabel}
      </div>
      {entries.length === 0 ? (
        <div className="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400">
          Empty folder
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {entries.map((e) => {
            const isActive = e.name === activeName;
            return (
              <li key={e.name}>
                <Link
                  href={buildHref(providerSlug, path, e.name, searchSuffix)}
                  aria-current={isActive ? "true" : undefined}
                  className={`flex h-8 items-center gap-2 px-3 text-sm ${
                    isActive
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
                  }`}
                >
                  <FileTypeIcon entry={e} />
                  <span className="flex-1 truncate">{e.name}</span>
                  {e.type === "directory" && (
                    <span aria-hidden="true" className="text-neutral-400">
                      ›
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
