"use client";

import { useEffect, useMemo } from "react";
import { sortEntries } from "@/server/browse/sort";
import { setCachedDir } from "@/lib/dir-cache-idb";
import type { Entry } from "@/server/storage/types";
import { FolderGrid } from "./FolderGrid";

type Props = {
  providerSlug: string;
  path: string;
  parentPath: string;
  initialEntries: readonly Entry[]; // visible (non-hidden), sorted; NOT pre-filtered for description/sidecar
  initialHash: string;
  descriptionName: string | null;
  sidecarNames: readonly string[]; // already showAll-resolved by the page
};

function applyGridFilter(
  entries: readonly Entry[],
  descriptionName: string | null,
  sidecarSet: ReadonlySet<string>,
): Entry[] {
  return sortEntries(
    entries.filter((e) => {
      if (descriptionName && e.name === descriptionName) return false;
      if (sidecarSet.has(e.name)) return false;
      return true;
    }),
  );
}

export function FolderBrowser({
  providerSlug,
  path,
  parentPath,
  initialEntries,
  initialHash,
  descriptionName,
  sidecarNames,
}: Props) {
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

  const sidecarSet = useMemo(() => new Set(sidecarNames), [sidecarNames]);
  const displayed = useMemo(
    () => applyGridFilter(initialEntries, descriptionName, sidecarSet),
    [initialEntries, descriptionName, sidecarSet],
  );

  return (
    <FolderGrid
      providerSlug={providerSlug}
      parentPath={parentPath}
      entries={displayed}
    />
  );
}
