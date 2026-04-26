import type { Entry } from "@/server/storage/types";
import { EntryCard } from "./EntryCard";

type Props = {
  providerSlug: string;
  parentPath: string;
  entries: readonly Entry[];
};

export function FolderGrid({ providerSlug, parentPath, entries }: Props) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        This folder is empty.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {entries.map((e) => (
        <EntryCard
          key={e.name}
          providerSlug={providerSlug}
          parentPath={parentPath}
          entry={e}
        />
      ))}
    </div>
  );
}
