"use client";

export function LogoForm({ initialValue }: { initialValue: string }) {
  return (
    <p className="text-sm text-neutral-500">
      Logo form coming soon. Current value: <code>{initialValue || "(none)"}</code>
    </p>
  );
}
