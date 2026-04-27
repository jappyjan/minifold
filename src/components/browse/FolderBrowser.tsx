"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { sortEntries } from "@/server/browse/sort";
import { setCachedDir } from "@/lib/dir-cache-idb";
import {
  type Category,
  DEFAULT_VISIBLE,
  categoryOfKind,
  parseShowParam,
  readPersistedVisible,
  writePersistedVisible,
} from "@/lib/browse-filter";
import { fileKindOf } from "@/server/browse/file-kind";
import type { Entry } from "@/server/storage/types";
import { FolderGrid } from "./FolderGrid";
import { FilterDropdown } from "./FilterDropdown";

type Props = {
  providerSlug: string;
  path: string;
  parentPath: string;
  initialEntries: readonly Entry[]; // visible (non-hidden), sorted; NOT pre-filtered for description/sidecar
  initialHash: string;
  descriptionName: string | null;
  sidecarNames: readonly string[]; // already showAll-resolved by the page
  thumbnailsEnabled: boolean;
};

function applyGridFilter(
  entries: readonly Entry[],
  descriptionName: string | null,
  sidecarSet: ReadonlySet<string>,
  visibleCategories: ReadonlySet<Category>,
): Entry[] {
  return sortEntries(
    entries.filter((e) => {
      if (descriptionName && e.name === descriptionName) return false;
      if (sidecarSet.has(e.name)) return false;
      if (e.type === "file") {
        const cat = categoryOfKind(fileKindOf(e.name));
        if (!visibleCategories.has(cat)) return false;
      }
      return true;
    }),
  );
}

function resolveInitialVisible(showParam: string | null): Set<Category> {
  const fromUrl = parseShowParam(showParam);
  if (fromUrl) return new Set(fromUrl);
  const fromStorage = readPersistedVisible();
  if (fromStorage) return new Set(fromStorage);
  return new Set(DEFAULT_VISIBLE);
}

export function FolderBrowser({
  providerSlug,
  path,
  parentPath,
  initialEntries,
  initialHash,
  descriptionName,
  sidecarNames,
  thumbnailsEnabled,
}: Props) {
  const searchParams = useSearchParams();
  // Capture the ?show= param value at render time so we can pass it to the
  // useState lazy initializer below without accessing a ref during render.
  const showParam = searchParams.get("show");

  const [visibleSet, setVisibleSet] = useState<Set<Category>>(
    () => resolveInitialVisible(showParam),
  );

  // Seed IDB with the SSR-fresh listing for future PWA / offline use.
  // This component intentionally does NOT call browse.list — SSR is the
  // source of truth and a redundant client-side fetch competes for S3
  // connections with the RSC's own listing.
  useEffect(() => {
    void setCachedDir(`${providerSlug}/${path}`, {
      hash: initialHash,
      entries: [...initialEntries],
      cachedAt: Date.now(),
    });
  }, [providerSlug, path, initialHash, initialEntries]);

  const handleFilterChange = (next: Set<Category>) => {
    setVisibleSet(next);
    writePersistedVisible(Array.from(next));
  };

  const sidecarSet = useMemo(() => new Set(sidecarNames), [sidecarNames]);
  const displayed = useMemo(
    () =>
      applyGridFilter(initialEntries, descriptionName, sidecarSet, visibleSet),
    [initialEntries, descriptionName, sidecarSet, visibleSet],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <FilterDropdown visible={visibleSet} onChange={handleFilterChange} />
      </div>
      <FolderGrid
        providerSlug={providerSlug}
        parentPath={parentPath}
        entries={displayed}
        thumbnailsEnabled={thumbnailsEnabled}
      />
    </div>
  );
}
