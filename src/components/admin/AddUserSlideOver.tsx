"use client";

export function AddUserSlideOver({
  onClose,
  onCreatedWithGenerated,
}: {
  onClose: () => void;
  onCreatedWithGenerated: (pw: string) => void;
}) {
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-sm bg-white p-4 dark:bg-neutral-900">
        <p>Coming soon</p>
        <button type="button" onClick={onClose}>Close</button>
        {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
        <span style={{ display: "none" }}>{onCreatedWithGenerated.toString()}</span>
      </div>
    </div>
  );
}
