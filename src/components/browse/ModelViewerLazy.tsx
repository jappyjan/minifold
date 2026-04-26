"use client";

import dynamic from "next/dynamic";

const ModelViewer = dynamic(
  () => import("./ModelViewer").then((m) => m.ModelViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[60vh] w-full items-center justify-center rounded-lg border border-neutral-200 bg-neutral-100 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 md:h-[70vh]">
        Loading viewer…
      </div>
    ),
  },
);

export { ModelViewer as ModelViewerLazy };
