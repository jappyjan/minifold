// Shown by Next.js during RSC streaming while the page awaits S3 data.
// No client-side JS — pure server component.

const PLACEHOLDER_COUNT = 12;

export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb placeholder */}
      <div className="flex items-center gap-2">
        <div className="h-4 w-24 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        <span className="text-neutral-300 dark:text-neutral-700">/</span>
        <div className="h-4 w-32 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      </div>

      {/* Grid of placeholder cards matching FolderGrid columns */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: PLACEHOLDER_COUNT }).map((_, i) => (
          <div
            key={i}
            className="aspect-square animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-900"
          />
        ))}
      </div>
    </div>
  );
}
