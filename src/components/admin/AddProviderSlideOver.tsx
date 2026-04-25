// src/components/admin/AddProviderSlideOver.tsx
"use client";

export function AddProviderSlideOver({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose}>
      <div
        className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white p-4 shadow-xl dark:bg-neutral-950"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <p className="text-sm text-neutral-500">Add provider form — coming in next task</p>
      </div>
    </div>
  );
}
