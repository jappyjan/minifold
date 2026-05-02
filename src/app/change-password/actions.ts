"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { getDatabase } from "@/server/db";
import { getCurrentUser } from "@/server/auth/current-user";
import { readSessionCookie } from "@/server/auth/cookies";
import { findUserById, updateUserPassword } from "@/server/db/users";
import { hashPassword, verifyPassword } from "@/server/auth/password";

export type ChangePasswordState = {
  success?: true;
  error?: string;
  fieldErrors?: Partial<Record<"currentPassword" | "newPassword" | "confirmPassword", string>>;
};

const schema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "New password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    path: ["newPassword"],
    message: "New password must differ from current",
  });

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const parsed = schema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? "form");
      if (!fieldErrors[k]) fieldErrors[k] = issue.message;
    }
    return { fieldErrors };
  }

  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };

  const fresh = findUserById(getDatabase(), user.id);
  if (!fresh) return { error: "Not authenticated" };

  if (!(await verifyPassword(parsed.data.currentPassword, fresh.password))) {
    return { fieldErrors: { currentPassword: "Current password is incorrect" } };
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  const db = getDatabase();
  updateUserPassword(db, fresh.id, newHash, { mustChangePassword: false });

  // Delete sessions other than the current one.
  const currentToken = await readSessionCookie();
  if (currentToken) {
    db.prepare(
      "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?",
    ).run(fresh.id, hashToken(currentToken));
  } else {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(fresh.id);
  }

  redirect("/");
}
