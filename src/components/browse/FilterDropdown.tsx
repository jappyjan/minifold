"use client";

import { CATEGORIES, type Category } from "@/lib/browse-filter";

const LABELS: Record<Category, string> = {
  "3d": "3D models",
  doc: "Documents",
  image: "Images",
  other: "Other",
};

type Props = {
  visible: ReadonlySet<Category>;
  onChange: (next: Set<Category>) => void;
};

export function FilterDropdown({ visible, onChange }: Props) {
  const summary =
    visible.size === CATEGORIES.length
      ? "All file types"
      : visible.size === 0
        ? "No file types"
        : `${visible.size} of ${CATEGORIES.length} types`;

  return (
    <details className="relative inline-block text-sm">
      <summary
        className="cursor-pointer select-none rounded border border-neutral-200 bg-white px-3 py-1 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200 dark:hover:bg-neutral-900"
        data-testid="filter-summary"
      >
        Filter: {summary}
      </summary>
      <div className="absolute right-0 z-10 mt-1 flex flex-col gap-1 rounded border border-neutral-200 bg-white p-2 shadow dark:border-neutral-800 dark:bg-neutral-950">
        {CATEGORIES.map((cat) => {
          const checked = visible.has(cat);
          return (
            <label
              key={cat}
              className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  const next = new Set(visible);
                  if (e.target.checked) next.add(cat);
                  else next.delete(cat);
                  onChange(next);
                }}
              />
              <span>{LABELS[cat]}</span>
            </label>
          );
        })}
      </div>
    </details>
  );
}
