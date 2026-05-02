"use client";

import { useState, useRef, useEffect } from "react";
import type { UserRow } from "@/server/db/users";

export type UserRowActionsProps = {
  user: UserRow;
  isSelf: boolean;
  isLastActiveAdmin: boolean;
  onAction: (action: ActionKind) => void;
};

export type ActionKind =
  | "reset-password"
  | "deactivate"
  | "activate"
  | "promote"
  | "demote"
  | "delete";

export function UserRowActions(props: UserRowActionsProps) {
  const { user, isSelf, isLastActiveAdmin, onAction } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const items: { kind: ActionKind; label: string; show: boolean }[] = [
    { kind: "reset-password", label: "Reset password", show: !isSelf },
    { kind: "deactivate", label: "Deactivate", show: !isSelf && user.deactivated === 0 && !(user.role === "admin" && isLastActiveAdmin) },
    { kind: "activate", label: "Activate", show: user.deactivated === 1 },
    { kind: "promote", label: "Promote to admin", show: user.role === "user" },
    { kind: "demote", label: "Demote to user", show: user.role === "admin" && !(isLastActiveAdmin) },
    { kind: "delete", label: "Delete", show: !isSelf && !(user.role === "admin" && isLastActiveAdmin) },
  ];

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Row actions"
        className="rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        ⋯
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-48 rounded border border-neutral-200 bg-white shadow-md dark:border-neutral-800 dark:bg-neutral-900"
        >
          {items.filter((i) => i.show).map((i) => (
            <button
              key={i.kind}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onAction(i.kind);
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              {i.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
