"use client";

import { useState } from "react";
import type { UserRow } from "@/server/db/users";
import {
  deactivateUser,
  activateUser,
  promoteUser,
  demoteUser,
  deleteUser,
  resetUserPassword,
  type SimpleFormState,
  type ResetFormState,
} from "@/app/admin/users/actions";
import { UserRowActions, type ActionKind } from "@/components/admin/UserRowActions";
import { AddUserSlideOver } from "@/components/admin/AddUserSlideOver";

function formatRelative(ts: number | null): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  const min = 60_000, hour = 60 * min, day = 24 * hour;
  if (diff < min) return "just now";
  if (diff < hour) return `${Math.floor(diff / min)} min ago`;
  if (diff < day) return `${Math.floor(diff / hour)} h ago`;
  return new Date(ts).toLocaleDateString();
}

export function UsersPageClient({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string | null;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [confirm, setConfirm] = useState<{
    user: UserRow;
    kind: ActionKind;
  } | null>(null);
  const [generated, setGenerated] = useState<string | null>(null);

  const activeAdminCount = users.filter((u) => u.role === "admin" && u.deactivated === 0).length;

  return (
    <div>
      <div className="flex items-center justify-between pb-4">
        <h1 className="text-xl font-semibold">Users</h1>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white"
        >
          + Add user
        </button>
      </div>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-neutral-500">
          <tr>
            <th className="py-2">Name</th>
            <th>Username</th>
            <th>Role</th>
            <th>Last login</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            const isLastActiveAdmin = u.role === "admin" && u.deactivated === 0 && activeAdminCount <= 1;
            return (
              <tr key={u.id} className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="py-2">{u.name}</td>
                <td className="font-mono text-xs">{u.username}</td>
                <td>{u.role}</td>
                <td>{formatRelative(u.last_login)}</td>
                <td>{u.deactivated === 1 ? "disabled" : "active"}</td>
                <td className="text-right">
                  <UserRowActions
                    user={u}
                    isSelf={isSelf}
                    isLastActiveAdmin={isLastActiveAdmin}
                    onAction={(kind) => setConfirm({ user: u, kind })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {addOpen ? (
        <AddUserSlideOver
          onClose={() => setAddOpen(false)}
          onCreatedWithGenerated={(pw) => setGenerated(pw)}
        />
      ) : null}

      {confirm ? (
        <ConfirmModal
          confirm={confirm}
          onResolve={(generatedPassword) => {
            setConfirm(null);
            if (generatedPassword) setGenerated(generatedPassword);
          }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}

      {generated ? (
        <PasswordOnceModal password={generated} onClose={() => setGenerated(null)} />
      ) : null}
    </div>
  );
}

// ── Modals ────────────────────────────────────────────────────────────────────

function ConfirmModal({
  confirm,
  onResolve,
  onCancel,
}: {
  confirm: { user: UserRow; kind: ActionKind };
  onResolve: (generatedPassword?: string) => void;
  onCancel: () => void;
}) {
  const { user, kind } = confirm;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const isDelete = kind === "delete";
  const titleMap: Record<ActionKind, string> = {
    "reset-password": `Reset password for ${user.username}?`,
    deactivate: `Deactivate ${user.username}?`,
    activate: `Activate ${user.username}`,
    promote: `Promote ${user.username} to admin?`,
    demote: `Demote ${user.username} to user?`,
    delete: `Delete ${user.username}?`,
  };

  async function go() {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.append("id", user.id);
    let result: SimpleFormState | ResetFormState;
    switch (kind) {
      case "reset-password":
        result = await resetUserPassword({}, fd);
        break;
      case "deactivate":
        result = await deactivateUser({}, fd);
        break;
      case "activate":
        result = await activateUser({}, fd);
        break;
      case "promote":
        result = await promoteUser({}, fd);
        break;
      case "demote":
        result = await demoteUser({}, fd);
        break;
      case "delete":
        result = await deleteUser({}, fd);
        break;
    }
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onResolve("generatedPassword" in result ? result.generatedPassword : undefined);
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded bg-white p-4 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold">{titleMap[kind]}</h2>
        {isDelete ? (
          <div className="mt-3 text-sm">
            Type <span className="font-mono font-bold">{user.username}</span> to confirm:
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="mt-2 block w-full rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>
        ) : null}
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={go}
            disabled={pending || (isDelete && confirmText !== user.username)}
            className="rounded bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {pending ? "…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PasswordOnceModal({ password, onClose }: { password: string; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded bg-white p-4 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold">New password</h2>
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
          This password will not be shown again. The user must change it on first login.
        </p>
        <code className="mt-3 block rounded bg-neutral-100 p-3 font-mono text-base dark:bg-neutral-800">
          {password}
        </code>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(password)}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
