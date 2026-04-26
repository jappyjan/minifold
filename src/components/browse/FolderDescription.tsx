import type { StorageProvider, Entry } from "@/server/storage/types";
import { parseFrontmatter } from "@/server/browse/frontmatter";
import { readTextFile } from "@/server/browse/read-text";
import { Markdown } from "./Markdown";

type Props = {
  provider: StorageProvider;
  parentPath: string;
  descriptionEntry: Entry;
};

export async function FolderDescription({
  provider,
  parentPath,
  descriptionEntry,
}: Props) {
  const fullPath = parentPath
    ? `${parentPath}/${descriptionEntry.name}`
    : descriptionEntry.name;
  const raw = await readTextFile(provider, fullPath);
  const { body } = parseFrontmatter(raw);
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <Markdown source={body} />
    </section>
  );
}
