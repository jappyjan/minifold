import Link from "next/link";
import { notFound } from "next/navigation";
import { getDatabase } from "@/server/db";
import { findProviderBySlug } from "@/server/db/providers";
import { providerFromRow } from "@/server/storage/factory";
import {
  NotFoundError,
  PathTraversalError,
  type Entry,
} from "@/server/storage/types";
import { isHiddenEntry } from "@/server/browse/hidden";
import { sortEntries } from "@/server/browse/sort";
import { computeDirHash } from "@/server/browse/dir-hash";
import { findFolderDescription } from "@/server/browse/description-file";
import { findSidecarMarkdowns } from "@/server/browse/find-sidecars";
import { decodePathSegments } from "@/server/browse/encode-path";
import { listWithCache } from "@/server/browse/list-cache";
import { Breadcrumbs } from "@/components/browse/Breadcrumbs";
import { FolderBrowser } from "@/components/browse/FolderBrowser";
import { FolderDescription } from "@/components/browse/FolderDescription";
import { FileDetail } from "@/components/browse/FileDetail";

type Params = { provider: string; path?: string[] };
type SearchParams = { showAll?: string | string[] };

export default async function BrowsePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { provider: slug, path: rawSegments = [] } = await params;
  const segments = decodePathSegments(rawSegments);
  if (!segments) notFound();
  const row = findProviderBySlug(getDatabase(), slug);
  if (!row) notFound();
  const provider = providerFromRow(row);
  const path = segments.join("/");
  const sp = await searchParams;
  const showAll = sp.showAll === "1";

  let entry: Entry;
  try {
    entry = await provider.stat(path);
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof PathTraversalError) {
      notFound();
    }
    throw err;
  }

  if (entry.type === "directory") {
    const allEntries = await listWithCache(provider, path);
    const hash = computeDirHash(allEntries);
    const visible = sortEntries(allEntries.filter((e) => !isHiddenEntry(e.name)));
    const description = findFolderDescription(visible);
    const sidecars = findSidecarMarkdowns(visible);
    return (
      <div className="flex flex-col gap-4">
        <Breadcrumbs
          providerSlug={slug}
          providerName={row.name}
          pathSegments={segments}
        />
        {description && (
          <FolderDescription
            provider={provider}
            parentPath={path}
            descriptionEntry={description}
          />
        )}
        {sidecars.size > 0 && (
          <div className="flex justify-end">
            <Link
              href={showAll ? "?" : "?showAll=1"}
              className="text-xs text-neutral-500 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              {showAll
                ? `Hide description files (${sidecars.size})`
                : `Show description files (${sidecars.size})`}
            </Link>
          </div>
        )}
        <FolderBrowser
          providerSlug={slug}
          path={path}
          parentPath={path}
          initialEntries={visible}
          initialHash={hash}
          descriptionName={description?.name ?? null}
          sidecarNames={showAll ? [] : Array.from(sidecars)}
        />
      </div>
    );
  }

  // File detail page — load siblings for sidecar lookup.
  const parentSegments = segments.slice(0, -1);
  const parentPath = parentSegments.join("/");
  const siblings = (await provider.list(parentPath)).filter(
    (e) => !isHiddenEntry(e.name),
  );

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs
        providerSlug={slug}
        providerName={row.name}
        pathSegments={segments}
      />
      <FileDetail
        provider={provider}
        parentPath={parentPath}
        fileEntry={entry}
        siblings={siblings}
      />
    </div>
  );
}
