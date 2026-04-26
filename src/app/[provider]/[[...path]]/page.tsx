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
import { findFolderDescription } from "@/server/browse/description-file";
import { decodePathSegments } from "@/server/browse/encode-path";
import { Breadcrumbs } from "@/components/browse/Breadcrumbs";
import { FolderGrid } from "@/components/browse/FolderGrid";
import { FolderDescription } from "@/components/browse/FolderDescription";
import { FileDetail } from "@/components/browse/FileDetail";

type Params = { provider: string; path?: string[] };

export default async function BrowsePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { provider: slug, path: rawSegments = [] } = await params;
  const segments = decodePathSegments(rawSegments);
  if (!segments) notFound();
  const row = findProviderBySlug(getDatabase(), slug);
  if (!row) notFound();
  const provider = providerFromRow(row);
  const path = segments.join("/");

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
    const allEntries = await provider.list(path);
    const visible = allEntries.filter((e) => !isHiddenEntry(e.name));
    const description = findFolderDescription(visible);
    const grid = sortEntries(
      visible.filter((e) => !description || e.name !== description.name),
    );
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
        <FolderGrid
          providerSlug={slug}
          parentPath={path}
          entries={grid}
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
