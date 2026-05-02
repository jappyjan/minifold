"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getDatabase } from "@/server/db";
import { findUserByUsername } from "@/server/db/users";
import {
  addUser as addUserCore,
  deactivateUserAdmin,
  activateUserAdmin,
  deleteUserAdmin,
  promoteUserAdmin,
  demoteUserAdmin,
  resetUserPasswordAdmin,
  LastAdminError,
} from "@/server/auth/users-admin";

// ── Form-state types ─────────────────────────────────────────────────────────

export type AddUserFormState = {
  success?: true;
  generatedPassword?: string;
  error?: string;
  fieldErrors?: Partial<Record<"name" | "username" | "password" | "mode" | "form", string>>;
};

export type SimpleFormState = { success?: true; error?: string };

export type ResetFormState = {
  success?: true;
  generatedPassword?: string;
  error?: string;
};

// ── Zod schemas ──────────────────────────────────────────────────────────────

const usernameField = z
  .string()
  .trim()
  .min(3, "Username: 3-64 chars, [a-z0-9_-]")
  .max(64, "Username: 3-64 chars, [a-z0-9_-]")
  .regex(/^[a-z0-9_-]+$/i, "Username: 3-64 chars, [a-z0-9_-]");

const baseAddUser = {
  name: z.string().trim().min(1, "Name is required").max(200),
  username: usernameField,
};
const manualSchema = z.object({
  ...baseAddUser,
  mode: z.literal("manual"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
const generateSchema = z.object({
  ...baseAddUser,
  mode: z.literal("generate"),
});
const addUserSchema = z.discriminatedUnion("mode", [manualSchema, generateSchema]);

const idField = z.string().uuid().or(z.string().min(1));
const idOnlySchema = z.object({ id: idField });

// ── Helpers ──────────────────────────────────────────────────────────────────

function fieldErrorsFromZod<K extends string>(
  err: z.ZodError,
): Partial<Record<K, string>> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out as Partial<Record<K, string>>;
}

function errorState(e: unknown): { error: string } {
  if (e instanceof LastAdminError) return { error: e.message };
  return { error: e instanceof Error ? e.message : "Unexpected error" };
}

// ── Actions ──────────────────────────────────────────────────────────────────

export async function addUser(
  _prev: AddUserFormState,
  formData: FormData,
): Promise<AddUserFormState> {
  const raw = {
    name: formData.get("name"),
    username: formData.get("username"),
    mode: formData.get("mode") ?? "generate",
    password: formData.get("password") ?? undefined,
  };
  const parsed = addUserSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFromZod(parsed.error) };
  }
  const db = getDatabase();
  if (findUserByUsername(db, parsed.data.username.toLowerCase())) {
    return { fieldErrors: { username: "Username already in use" } };
  }
  try {
    const result = await addUserCore(db, parsed.data);
    revalidatePath("/admin/users");
    return { success: true, generatedPassword: result.generatedPassword };
  } catch (e) {
    return errorState(e);
  }
}

export async function deactivateUser(
  _prev: SimpleFormState,
  formData: FormData,
): Promise<SimpleFormState> {
  const parsed = idOnlySchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "Missing user id" };
  try {
    deactivateUserAdmin(getDatabase(), parsed.data.id);
    revalidatePath("/admin/users");
    return { success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function activateUser(
  _prev: SimpleFormState,
  formData: FormData,
): Promise<SimpleFormState> {
  const parsed = idOnlySchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "Missing user id" };
  try {
    activateUserAdmin(getDatabase(), parsed.data.id);
    revalidatePath("/admin/users");
    return { success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function deleteUser(
  _prev: SimpleFormState,
  formData: FormData,
): Promise<SimpleFormState> {
  const parsed = idOnlySchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "Missing user id" };
  try {
    deleteUserAdmin(getDatabase(), parsed.data.id);
    revalidatePath("/admin/users");
    return { success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function promoteUser(
  _prev: SimpleFormState,
  formData: FormData,
): Promise<SimpleFormState> {
  const parsed = idOnlySchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "Missing user id" };
  try {
    promoteUserAdmin(getDatabase(), parsed.data.id);
    revalidatePath("/admin/users");
    return { success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function demoteUser(
  _prev: SimpleFormState,
  formData: FormData,
): Promise<SimpleFormState> {
  const parsed = idOnlySchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "Missing user id" };
  try {
    demoteUserAdmin(getDatabase(), parsed.data.id);
    revalidatePath("/admin/users");
    return { success: true };
  } catch (e) {
    return errorState(e);
  }
}

export async function resetUserPassword(
  _prev: ResetFormState,
  formData: FormData,
): Promise<ResetFormState> {
  const parsed = idOnlySchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { error: "Missing user id" };
  try {
    const { generatedPassword } = await resetUserPasswordAdmin(getDatabase(), parsed.data.id);
    revalidatePath("/admin/users");
    return { success: true, generatedPassword };
  } catch (e) {
    return errorState(e);
  }
}
