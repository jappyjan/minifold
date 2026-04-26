import type { StorageProvider, Entry } from "@/server/storage/types";
import { fileKindOf, type FileKind } from "@/server/browse/file-kind";
import { parseFrontmatter } from "@/server/browse/frontmatter";
import { findFileDescription } from "@/server/browse/description-file";
import { readTextFile } from "@/server/browse/read-text";
import { encodePathSegments } from "@/server/browse/encode-path";
import { Markdown } from "./Markdown";
import { ModelViewerLazy } from "./ModelViewerLazy";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

type Props = {
  provider: StorageProvider;
  parentPath: string;
  fileEntry: Entry;
  siblings: readonly Entry[];
};

export async function FileDetail({
  provider,
  parentPath,
  fileEntry,
  siblings,
}: Props) {
  const kind = fileKindOf(fileEntry.name);
  const fullPath = joinPath(parentPath, fileEntry.name);
  const fileApi = `/api/file/${provider.slug}/${encodePathSegments(fullPath)}`;

  const sidecar = findFileDescription(siblings, fileEntry.name);
  let sidecarBody: string | null = null;
  let sidecarTags: string[] = [];
  if (sidecar) {
    const sidecarPath = joinPath(parentPath, sidecar.name);
    const parsed = parseFrontmatter(await readTextFile(provider, sidecarPath));
    sidecarBody = parsed.body;
    sidecarTags = parsed.tags;
  }

  return (
    <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
      <div>
        <Viewer
          kind={kind}
          fileApi={fileApi}
          entry={fileEntry}
          provider={provider}
          parentPath={parentPath}
        />
      </div>
      <aside className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
        <div>
          <h1 className="break-all text-base font-semibold">{fileEntry.name}</h1>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
            <dt>Type</dt>
            <dd className="font-mono uppercase">{kind}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(fileEntry.size)}</dd>
            <dt>Modified</dt>
            <dd>{fileEntry.modifiedAt.toISOString().slice(0, 10)}</dd>
          </dl>
        </div>

        {sidecarTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {sidecarTags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <a
          href={fileApi}
          download={fileEntry.name}
          className="inline-block rounded bg-neutral-900 px-3 py-1.5 text-center text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          Download
        </a>

        {sidecarBody !== null && (
          <div className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
            <Markdown source={sidecarBody} />
          </div>
        )}
      </aside>
    </div>
  );
}

async function MdViewer({
  provider,
  parentPath,
  entry,
}: {
  provider: StorageProvider;
  parentPath: string;
  entry: Entry;
}) {
  const fullPath = joinPath(parentPath, entry.name);
  const raw = await readTextFile(provider, fullPath);
  const { body } = parseFrontmatter(raw);
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
      <Markdown source={body} />
    </div>
  );
}

function Viewer({
  kind,
  fileApi,
  entry,
  provider,
  parentPath,
}: {
  kind: FileKind;
  fileApi: string;
  entry: Entry;
  provider: StorageProvider;
  parentPath: string;
}) {
  if (kind === "md") {
    return <MdViewer provider={provider} parentPath={parentPath} entry={entry} />;
  }
  if (kind === "pdf") {
    return (
      <iframe
        src={`${fileApi}?inline=1`}
        title={entry.name}
        className="h-[80vh] w-full rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
      />
    );
  }
  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`${fileApi}?inline=1`}
        alt={entry.name}
        className="max-h-[80vh] w-auto rounded-lg border border-neutral-200 dark:border-neutral-800"
      />
    );
  }
  if (kind === "stl" || kind === "3mf") {
    return (
      <ModelViewerLazy
        fileApi={fileApi}
        fileSize={entry.size}
        kind={kind}
        fileName={entry.name}
      />
    );
  }
  return (
    <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-neutral-50 text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
      Preview not available — use the Download button.
    </div>
  );
}
