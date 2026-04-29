"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  src: string;
  alt?: string;
  className?: string;
  fallback: ReactNode;
};

export function Thumbnail({ src, alt = "", className, fallback }: Props) {
  const skeletonRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const el = skeletonRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            obs.disconnect();
            return;
          }
        }
      },
      { rootMargin: "100px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView]);

  return (
    <div className={`${className ?? ""} relative overflow-hidden`}>
      <div
        ref={skeletonRef}
        data-testid="thumb-skeleton"
        className="absolute inset-0 rounded bg-neutral-200 dark:bg-neutral-800"
        aria-hidden="true"
      >
        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent motion-safe:animate-[shimmer_1.4s_infinite] dark:via-white/10" />
      </div>
      {/* Hidden suppressors — referenced props so TS doesn't complain on unused vars in this slice. */}
      <span hidden>{src}{alt}{fallback ? null : null}</span>
    </div>
  );
}
