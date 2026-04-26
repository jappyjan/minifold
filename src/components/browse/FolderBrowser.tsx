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
  initialEntries: readonly Entry[]; // visible (non-hidden), sorted; NOT pre-filtered for description/sidecar
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
  // null = IDB hasn't been checked yet (query is gated on this)
  // string = the hash we want to validate against the server
  const [knownHash, setKnownHash] = useState<string | null>(null);
  const [rawEntries, setRawEntries] = useState<readonly Entry[]>(initialEntries);
  const seededFromCache = useRef(false);

  // Hydrate from IndexedDB first. Once this resolves we know whether to
  // validate the cached hash or the SSR-computed initialHash.
  useEffect(() => {
    let cancelled = false;
    seededFromCache.current = false;
    getCachedDir(cacheKey(providerSlug, path))
      .then((cached) => {
        if (cancelled) return;
        if (cached) {
          seededFromCache.current = true;
          setRawEntries(cached.entries);
          setKnownHash(cached.hash);
        } else {
          setKnownHash(initialHash);
        }
      })
      .catch(() => {
        // IDB broken — fall back to validating the SSR hash.
        if (!cancelled) setKnownHash(initialHash);
      });
    return () => {
      cancelled = true;
    };
  }, [providerSlug, path, initialHash]);

  const query = trpc.browse.list.useQuery(
    { providerSlug, path, knownHash: knownHash ?? undefined },
    { enabled: knownHash !== null },
  );

  // Apply the tRPC response.
  useEffect(() => {
    const data = query.data;
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
      // Server confirmed initialEntries are fresh; seed IDB so the next
      // navigation hits the cache.
      void setCachedDir(cacheKey(providerSlug, path), {
        hash: data.hash,
        entries: [...initialEntries],
        cachedAt: Date.now(),
      });
    }
  }, [query.data, providerSlug, path, initialEntries]);

  // If the tRPC query throws, drop the cache entry so we don't keep
  // showing a phantom listing for a deleted/forbidden directory.
  useEffect(() => {
    if (query.error) {
      void clearCachedDir(cacheKey(providerSlug, path));
    }
  }, [query.error, providerSlug, path]);

  const sidecarSet = useMemo(() => new Set(sidecarNames), [sidecarNames]);
  const displayed = useMemo(
    () => applyGridFilter(rawEntries, descriptionName, sidecarSet),
    [rawEntries, descriptionName, sidecarSet],
  );

  return (
    <FolderGrid
      providerSlug={providerSlug}
      parentPath={parentPath}
      entries={displayed}
    />
  );
}
