"use client";

type Props = {
  onToggleMenu: () => void;
};

export function TopBar({ onToggleMenu }: Props) {
  return (
    <header className="flex h-14 items-center border-b border-neutral-200 bg-white px-4 md:hidden dark:border-neutral-800 dark:bg-neutral-950">
      <button
        type="button"
        aria-label="Menu"
        onClick={onToggleMenu}
        className="mr-3 rounded p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
          <path
            d="M3 5h14M3 10h14M3 15h14"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <span className="font-semibold">Minifold</span>
    </header>
  );
}
