"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type BrowseView,
  mergeSearchParams,
  writePersistedView,
} from "@/lib/browse-view";

type Props = {
  current: BrowseView;
};

export function ViewToggle({ current }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(next: BrowseView) {
    if (next === current) return;
    const qs = mergeSearchParams(searchParams, {
      view: next === "column" ? "column" : null,
    });
    router.push(qs ? `${pathname}?${qs}` : pathname);
    writePersistedView(next);
  }

  const baseBtn =
    "px-3 py-1 text-sm font-medium transition-colors first:rounded-l last:rounded-r border border-neutral-200 dark:border-neutral-800";
  const activeBtn = "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900";
  const inactiveBtn =
    "bg-white text-neutral-700 hover:bg-neutral-50 dark:bg-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900";

  return (
    <div className="hidden md:inline-flex" role="group" aria-label="View mode">
      <button
        type="button"
        aria-pressed={current === "grid"}
        onClick={() => go("grid")}
        className={`${baseBtn} ${current === "grid" ? activeBtn : inactiveBtn}`}
      >
        Grid
      </button>
      <button
        type="button"
        aria-pressed={current === "column"}
        onClick={() => go("column")}
        className={`${baseBtn} ${current === "column" ? activeBtn : inactiveBtn} -ml-px`}
      >
        Column
      </button>
    </div>
  );
}
