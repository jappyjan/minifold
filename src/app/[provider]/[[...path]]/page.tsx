import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDatabase } from "@/server/db";
import { findProviderBySlug } from "@/server/db/providers";
import { providerFromRow } from "@/server/storage/factory";
import {
  NotFoundError,
  PathTraversalError,
  type Entry,
} from "@/server/storage/types";
import {
  isHiddenEntry,
  isInternalEntry,
  isListableEntry,
} from "@/server/browse/hidden";
import { sortEntries } from "@/server/browse/sort";
import { computeDirHash } from "@/server/browse/dir-hash";
import { findFolderDescription } from "@/server/browse/description-file";
import { findSidecarMarkdowns } from "@/server/browse/find-sidecars";
import { decodePathSegments, encodePathSegments } from "@/server/browse/encode-path";
import { listWithCache } from "@/server/browse/list-cache";
import { columnAncestorChain } from "@/server/browse/ancestor-chain";
import { isThumbnailServiceEnabled } from "@/server/thumb/config";
import {
  firstSearchParam,
  mergeSearchParams,
  searchParamsFromRecord,
  stripViewParam,
} from "@/lib/browse-view";
import { Breadcrumbs } from "@/components/browse/Breadcrumbs";
import { FolderBrowser } from "@/components/browse/FolderBrowser";
import { FolderDescription } from "@/components/browse/FolderDescription";
import { FileDetail } from "@/components/browse/FileDetail";
import {
  ColumnBrowser,
  type ColumnData,
} from "@/components/browse/ColumnBrowser";
import { MobileColumnFallback } from "@/components/browse/MobileColumnFallback";
import { getCurrentUser } from "@/server/auth/current-user";
import { createAccessResolver, type Resolver } from "@/server/access/resolver";
import { getGlobalDefaultAccess } from "@/server/access/global-default";

type Params = { provider: string; path?: string[] };
type SearchParams = Record<string, string | string[] | undefined>;

function readViewParam(sp: SearchParams): "grid" | "column" {
  return firstSearchParam(sp.view) === "column" ? "column" : "grid";
}

function toggleBrowseParamHref(
  sp: SearchParams,
  key: "showAll" | "showHidden",
  enabled: boolean,
): string {
  const qs = mergeSearchParams(searchParamsFromRecord(sp), {
    [key]: enabled ? null : "1",
  });
  return qs ? `?${qs}` : "?";
}

async function loadAllowedListing(
  provider: ReturnType<typeof providerFromRow>,
  resolver: Resolver,
  path: string,
  showHidden: boolean,
): Promise<{ entries: Entry[]; hash: string; hiddenCount: number }> {
  const raw = await listWithCache(provider, path);
  const hash = computeDirHash(raw);
  const hiddenCount = raw.filter(
    (e) => isHiddenEntry(e.name) && !isInternalEntry(e.name),
  ).length;
  const visibleAfterHidden = raw.filter((e) =>
    isListableEntry(e.name, showHidden),
  );
  const allowed: Entry[] = [];
  for (const child of visibleAfterHidden) {
    const childPath = path === "" ? child.name : `${path}/${child.name}`;
    const decision = await resolver.resolve(childPath, child.type);
    if (decision === "allow") allowed.push(child);
  }
  return { entries: sortEntries(allowed), hash, hiddenCount };
}

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
  const showAll = firstSearchParam(sp.showAll) === "1";
  const showHidden = firstSearchParam(sp.showHidden) === "1";
  const view = readViewParam(sp);

  const user = await getCurrentUser();
  const config = row.config as { defaultAccess?: "public" | "signed-in" };
  const resolver = createAccessResolver({
    user,
    storage: provider,
    providerDefault: config.defaultAccess,
    globalDefault: getGlobalDefaultAccess(getDatabase()),
  });

  let entry: Entry;
  try {
    entry = await provider.stat(path);
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof PathTraversalError) {
      notFound();
    }
    throw err;
  }

  const decision = await resolver.resolve(path, entry.type);
  if (decision === "deny-anonymous") {
    const callbackUrl = encodeURIComponent(
      `/${slug}${path ? `/${path}` : ""}`,
    );
    redirect(`/login?callbackUrl=${callbackUrl}`);
  }
  if (decision === "deny-authed") {
    notFound();
  }

  // Column view branch
  if (view === "column") {
    const chain = columnAncestorChain(segments, entry.type);

    // The resolver's per-request cache is intentionally shared across these
    // parallel calls; concurrent cache-miss writes are idempotent.
    const columns: ColumnData[] = await Promise.all(
      chain.map(async (colPath) => {
        const { entries, hash, hiddenCount } = await loadAllowedListing(
          provider,
          resolver,
          colPath,
          showHidden,
        );
        return { path: colPath, entries, hash, hiddenCount };
      }),
    );

    // Per-column active row mapping: column at depth N highlights segments[N].
    const activeNames: (string | null)[] = chain.map((_, i) => segments[i] ?? null);

    const leafHiddenCount = columns[columns.length - 1]?.hiddenCount ?? 0;

    let selectedLeaf: Entry | null = null;
    let leafParentPath: string | null = null;
    if (entry.type === "file") {
      selectedLeaf = entry;
      leafParentPath = segments.slice(0, -1).join("/");
    }

    const encodedPath = path ? `/${encodePathSegments(path)}` : "";
    const incomingParams = searchParamsFromRecord(sp);
    const gridQs = stripViewParam(incomingParams);
    const gridHref = `/${slug}${encodedPath}${gridQs ? `?${gridQs}` : ""}`;

    return (
      <div className="flex flex-col gap-4">
        <Breadcrumbs
          providerSlug={slug}
          providerName={row.name}
          pathSegments={segments}
        />
        {leafHiddenCount > 0 && (
          <div className="flex justify-end">
            <Link
              href={toggleBrowseParamHref(sp, "showHidden", showHidden)}
              className="text-xs text-neutral-500 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              {showHidden
                ? `Hide hidden files (${leafHiddenCount})`
                : `Show hidden files (${leafHiddenCount})`}
            </Link>
          </div>
        )}
        <ColumnBrowser
          providerSlug={slug}
          providerName={row.name}
          columns={columns}
          activeNames={activeNames}
          selectedLeaf={selectedLeaf}
          leafParentPath={leafParentPath}
          thumbnailsEnabled={isThumbnailServiceEnabled()}
        />
        <MobileColumnFallback gridHref={gridHref} />
      </div>
    );
  }

  // Grid / detail (existing behaviour)
  if (entry.type === "directory") {
    const { entries: visible, hash, hiddenCount } = await loadAllowedListing(
      provider,
      resolver,
      path,
      showHidden,
    );
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
        {(sidecars.size > 0 || hiddenCount > 0) && (
          <div className="flex justify-end gap-4">
            {hiddenCount > 0 && (
              <Link
                href={toggleBrowseParamHref(sp, "showHidden", showHidden)}
                className="text-xs text-neutral-500 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              >
                {showHidden
                  ? `Hide hidden files (${hiddenCount})`
                  : `Show hidden files (${hiddenCount})`}
              </Link>
            )}
            {sidecars.size > 0 && (
              <Link
                href={toggleBrowseParamHref(sp, "showAll", showAll)}
                className="text-xs text-neutral-500 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              >
                {showAll
                  ? `Hide description files (${sidecars.size})`
                  : `Show description files (${sidecars.size})`}
              </Link>
            )}
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
          thumbnailsEnabled={isThumbnailServiceEnabled()}
        />
      </div>
    );
  }

  // File detail page — load siblings for sidecar lookup.
  const parentSegments = segments.slice(0, -1);
  const parentPath = parentSegments.join("/");
  const rawSiblings = (await listWithCache(provider, parentPath)).filter(
    (e) => isListableEntry(e.name, showHidden),
  );
  const siblings: Entry[] = [];
  for (const sib of rawSiblings) {
    const sibPath = parentPath === "" ? sib.name : `${parentPath}/${sib.name}`;
    const sibDecision = await resolver.resolve(sibPath, sib.type);
    if (sibDecision === "allow") siblings.push(sib);
  }

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
