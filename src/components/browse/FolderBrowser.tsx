"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/trpc/client";
import { sortEntries } from "@/server/browse/sort";
import { clearCachedDir, getCachedDir, setCachedDir } from "@/lib/dir-cache-idb";
import type { Entry } from "@/server/storage/types";
import { FolderGrid } from "./FolderGrid";

type Props = {
  providerSlug: string;
  path: string;
  parentPath: string;
  initialEntries: readonly Entry[]; // visible (non-hidden), sorted; NOT yet filtered for description/sidecar
  initialHash: string;
  descriptionName: string | null;
  sidecarNames: readonly string[]; // already showAll-resolved by the page
};

function cacheKey(slug: string, path: string): string {
  return `${slug}/${path}`;
}

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
  const [rawEntries, setRawEntries] = useState<readonly Entry[]>(initialEntries);
  const [knownHash, setKnownHash] = useState<string>(initialHash);
  const seededFromCache = useRef(false);

  // Hydrate from IndexedDB on mount (and whenever the URL changes).
  useEffect(() => {
    let cancelled = false;
    seededFromCache.current = false;
    getCachedDir(cacheKey(providerSlug, path))
      .then((cached) => {
        if (cancelled || !cached) return;
        seededFromCache.current = true;
        setKnownHash(cached.hash);
        setRawEntries(cached.entries);
      })
      .catch(() => {
        // Best-effort: a broken IDB just means we keep showing initialEntries.
      });
    return () => {
      cancelled = true;
    };
  }, [providerSlug, path]);

  const query = trpc.browse.list.useQuery({
    providerSlug,
    path,
    knownHash,
  });

  // Apply the tRPC response.
  useEffect(() => {
    const data = query.data as
      | { changed: true; hash: string; entries: Entry[] }
      | { changed: false; hash: string }
      | undefined;
    if (!data) return;
    if (data.changed) {
      setKnownHash(data.hash);
      setRawEntries(data.entries);
      void setCachedDir(cacheKey(providerSlug, path), {
        hash: data.hash,
        entries: [...data.entries],
        cachedAt: Date.now(),
      });
    } else if (!seededFromCache.current) {
      // Server confirmed our initial render is fresh — seed IDB so the
      // next navigation hits the cache.
      void setCachedDir(cacheKey(providerSlug, path), {
        hash: data.hash,
        entries: [...initialEntries],
        cachedAt: Date.now(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  // If the tRPC query throws, drop a stale cache so we don't keep showing
  // a phantom listing for a deleted/forbidden directory.
  useEffect(() => {
    if (query.error) {
      void clearCachedDir(cacheKey(providerSlug, path));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.error]);

  const sidecarKey = sidecarNames.join("|");
  const displayed = useMemo(
    () => applyGridFilter(rawEntries, descriptionName, new Set(sidecarNames)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawEntries, descriptionName, sidecarKey],
  );

  return (
    <FolderGrid
      providerSlug={providerSlug}
      parentPath={parentPath}
      entries={displayed}
    />
  );
}
