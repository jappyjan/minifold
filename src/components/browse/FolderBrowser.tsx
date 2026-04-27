"use client";

import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/trpc/client";
import { sortEntries } from "@/server/browse/sort";
import {
  clearCachedDir,
  getCachedDir,
  setCachedDir,
  type CachedDir,
} from "@/lib/dir-cache-idb";
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

type IdbCheck =
  | { state: "pending" }
  | { state: "checked"; key: string; cached: CachedDir | null };

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
  const currentKey = cacheKey(providerSlug, path);

  // IndexedDB check is the only state we actually need — everything else
  // is derived from props + query result + this lookup.
  const [idbCheck, setIdbCheck] = useState<IdbCheck>({ state: "pending" });

  useEffect(() => {
    let cancelled = false;
    getCachedDir(currentKey)
      .then((cached) => {
        if (!cancelled) setIdbCheck({ state: "checked", key: currentKey, cached });
      })
      .catch(() => {
        // IDB broken — proceed as if nothing is cached.
        if (!cancelled) setIdbCheck({ state: "checked", key: currentKey, cached: null });
      });
    return () => {
      cancelled = true;
    };
  }, [currentKey]);

  // The IDB result is only valid for the path it was read for. If the URL
  // changes, treat IDB as still pending until the next read resolves.
  const idbReady = idbCheck.state === "checked" && idbCheck.key === currentKey;
  const cached = idbReady ? idbCheck.cached : null;

  // We send the cached hash if we have one, otherwise the SSR-computed hash.
  // Until IDB resolves, knownHash is null and the query is gated.
  const knownHash: string | null = idbReady
    ? (cached?.hash ?? initialHash)
    : null;

  const query = trpc.browse.list.useQuery(
    { providerSlug, path, knownHash: knownHash ?? undefined },
    { enabled: knownHash !== null },
  );

  // Derive raw entries directly: prefer fresh query data, then cached, then SSR.
  const rawEntries: readonly Entry[] =
    query.data?.changed === true
      ? query.data.entries
      : cached
        ? cached.entries
        : initialEntries;

  // Persist cache writes as a side effect of new server data. No setState inside.
  useEffect(() => {
    const data = query.data;
    if (!data) return;
    if (data.changed) {
      void setCachedDir(currentKey, {
        hash: data.hash,
        entries: [...data.entries],
        cachedAt: Date.now(),
      });
    } else if (idbReady && !cached) {
      // Server confirmed initialEntries are fresh; seed IDB so the next
      // navigation hits the cache.
      void setCachedDir(currentKey, {
        hash: data.hash,
        entries: [...initialEntries],
        cachedAt: Date.now(),
      });
    }
  }, [query.data, currentKey, idbReady, cached, initialEntries]);

  // Drop a stale cache on query failure.
  useEffect(() => {
    if (query.error) {
      void clearCachedDir(currentKey);
    }
  }, [query.error, currentKey]);

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
