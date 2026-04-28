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
import { isHiddenEntry } from "@/server/browse/hidden";
import { sortEntries } from "@/server/browse/sort";
import { computeDirHash } from "@/server/browse/dir-hash";
import { findFolderDescription } from "@/server/browse/description-file";
import { findSidecarMarkdowns } from "@/server/browse/find-sidecars";
import { decodePathSegments } from "@/server/browse/encode-path";
import { listWithCache } from "@/server/browse/list-cache";
import { isThumbnailServiceEnabled } from "@/server/thumb/config";
import { Breadcrumbs } from "@/components/browse/Breadcrumbs";
import { FolderBrowser } from "@/components/browse/FolderBrowser";
import { FolderDescription } from "@/components/browse/FolderDescription";
import { FileDetail } from "@/components/browse/FileDetail";
import { getCurrentUser } from "@/server/auth/current-user";
import { createAccessResolver } from "@/server/access/resolver";
import { getGlobalDefaultAccess } from "@/server/access/global-default";

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

  if (entry.type === "directory") {
    const allEntries = await listWithCache(provider, path);
    const hash = computeDirHash(allEntries);
    const visibleAfterHidden = allEntries.filter((e) => !isHiddenEntry(e.name));

    // Filter children by the resolver — per-path enforcement on every entry.
    const allowedChildren: Entry[] = [];
    for (const child of visibleAfterHidden) {
      const childPath = path === "" ? child.name : `${path}/${child.name}`;
      const childDecision = await resolver.resolve(childPath, child.type);
      if (childDecision === "allow") allowedChildren.push(child);
    }
    const visible = sortEntries(allowedChildren);

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
          thumbnailsEnabled={isThumbnailServiceEnabled()}
        />
      </div>
    );
  }

  // File detail page — load siblings for sidecar lookup.
  const parentSegments = segments.slice(0, -1);
  const parentPath = parentSegments.join("/");
  const rawSiblings = (await listWithCache(provider, parentPath)).filter(
    (e) => !isHiddenEntry(e.name),
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
