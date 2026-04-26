import Link from "next/link";

type Props = {
  providerSlug: string;
  providerName: string;
  pathSegments: readonly string[];
};

export function Breadcrumbs({ providerSlug, providerName, pathSegments }: Props) {
  const crumbs: { label: string; href: string }[] = [
    { label: providerName, href: `/${providerSlug}` },
  ];
  let acc = "";
  for (const seg of pathSegments) {
    acc = acc ? `${acc}/${seg}` : seg;
    crumbs.push({ label: seg, href: `/${providerSlug}/${acc}` });
  }
  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <ol className="flex flex-wrap items-center gap-1 text-neutral-500 dark:text-neutral-400">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={c.href} className="flex items-center gap-1">
              {isLast ? (
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  {c.label}
                </span>
              ) : (
                <Link
                  href={c.href}
                  className="hover:text-neutral-900 dark:hover:text-neutral-100"
                >
                  {c.label}
                </Link>
              )}
              {!isLast && <span aria-hidden="true">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
