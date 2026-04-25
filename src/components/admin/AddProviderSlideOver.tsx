// src/components/admin/AddProviderSlideOver.tsx
"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  addProvider,
  type AddProviderFormState,
} from "@/app/admin/providers/actions";
import { AddProviderForm } from "./AddProviderForm";

const initialState: AddProviderFormState = {};

export function AddProviderSlideOver({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    addProvider,
    initialState,
  );
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Close on successful submission
  useEffect(() => {
    if (state.success) onClose();
    // onClose is useCallback-memoized in the parent — safe dep
  }, [state.success, onClose]);

  // Focus first input when opened
  useEffect(() => {
    if (open) {
      const first = panelRef.current?.querySelector<HTMLElement>(
        "input, button, select, textarea",
      );
      first?.focus();
    }
  }, [open]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add provider"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-xl dark:bg-neutral-950"
      >
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h2 className="text-sm font-semibold">Add provider</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <AddProviderForm
            action={formAction}
            state={state}
            pending={pending}
          />
        </div>
      </div>
    </>
  );
}
