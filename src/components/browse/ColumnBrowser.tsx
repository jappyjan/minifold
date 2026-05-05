"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Entry } from "@/server/storage/types";
import { setCachedDir } from "@/lib/dir-cache-idb";
import {
  type Category,
  DEFAULT_VISIBLE,
  filterEntriesByCategory,
  parseShowParam,
  readPersistedVisible,
  writePersistedVisible,
} from "@/lib/browse-filter";
import { mergeSearchParams } from "@/lib/browse-view";
import { Column } from "./Column";
import { ColumnDetailStrip } from "./ColumnDetailStrip";
import { FilterDropdown } from "./FilterDropdown";
import { ViewToggle } from "./ViewToggle";

export type ColumnData = {
  path: string;
  entries: readonly Entry[];
  hash: string;
};

type Props = {
  providerSlug: string;
  providerName: string;
  columns: readonly ColumnData[];
  /** Per-column active-row name; null when no row is active in that column. Length matches columns. */
  activeNames: readonly (string | null)[];
  selectedLeaf: Entry | null;
  /** Parent dir of selectedLeaf (i.e. the deepest column's path). null when no leaf. */
  leafParentPath: string | null;
  thumbnailsEnabled: boolean;
};

function resolveInitialVisible(showParam: string | null): Set<Category> {
  const fromUrl = parseShowParam(showParam);
  if (fromUrl) return new Set(fromUrl);
  const fromStorage = readPersistedVisible();
  if (fromStorage) return new Set(fromStorage);
  return new Set(DEFAULT_VISIBLE);
}

export function ColumnBrowser({
  providerSlug,
  providerName,
  columns,
  activeNames,
  selectedLeaf,
  leafParentPath,
  thumbnailsEnabled,
}: Props) {
  void thumbnailsEnabled; // reserved for future thumbnail rows

  const searchParams = useSearchParams();
  const showParam = searchParams.get("show");
  const [visibleSet, setVisibleSet] = useState<Set<Category>>(
    () => resolveInitialVisible(showParam),
  );
  const stripRef = useRef<HTMLDivElement>(null);

  const handleFilterChange = (next: Set<Category>) => {
    setVisibleSet(next);
    writePersistedVisible(Array.from(next));
  };

  // Compute the suffix for child links: preserve other params, drop `view`.
  const linkSuffix = useMemo(
    () => mergeSearchParams(searchParams, { view: null }),
    [searchParams],
  );

  // Seed IDB for each column. Fire-and-forget; per-request resolver cache races
  // are benign (idempotent writes) — see column-view design spec §10.
  useEffect(() => {
    for (const col of columns) {
      const key = `${providerSlug}/${col.path}`;
      void setCachedDir(key, {
        hash: col.hash,
        entries: [...col.entries],
        cachedAt: Date.now(),
      });
    }
  }, [providerSlug, columns]);

  // Scroll the rightmost column into view on mount and when columns change.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollWidth, behavior: "instant" as ScrollBehavior });
  }, [columns.length]);

  return (
    <div className="hidden md:flex flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        <ViewToggle current="column" />
        <FilterDropdown visible={visibleSet} onChange={handleFilterChange} />
      </div>
      <div
        ref={stripRef}
        className="flex h-[70dvh] overflow-x-auto"
        style={{ scrollSnapType: "x proximity" }}
      >
        {columns.map((col, i) => {
          const filtered = filterEntriesByCategory(col.entries, visibleSet);
          const headerLabel =
            col.path === "" ? providerName : col.path.split("/").pop()!;
          return (
            <Column
              key={col.path || "__root__"}
              providerSlug={providerSlug}
              path={col.path}
              headerLabel={headerLabel}
              entries={filtered}
              activeName={activeNames[i] ?? null}
              searchSuffix={linkSuffix}
            />
          );
        })}
      </div>
      {selectedLeaf && leafParentPath !== null && (
        <ColumnDetailStrip
          providerSlug={providerSlug}
          parentPath={leafParentPath}
          entry={selectedLeaf}
          searchSuffix={linkSuffix}
        />
      )}
    </div>
  );
}
