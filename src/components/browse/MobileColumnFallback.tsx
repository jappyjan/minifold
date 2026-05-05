import Link from "next/link";

type Props = {
  /** URL to the grid view (current path with ?view=column stripped). */
  gridHref: string;
};

export function MobileColumnFallback({ gridHref }: Props) {
  return (
    <div
      role="status"
      className="md:hidden flex flex-col items-start gap-2 rounded border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
    >
      <p>Column view is desktop-only. It needs more screen width to be useful.</p>
      <Link
        href={gridHref}
        className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        Open in grid view
      </Link>
    </div>
  );
}
