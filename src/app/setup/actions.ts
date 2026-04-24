"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { getDatabase } from "@/server/db";
import { createUser, hasAnyAdmin } from "@/server/db/users";
import { hashPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { writeSessionCookie } from "@/server/auth/cookies";

const schema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  username: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]{3,64}$/i, "Username: 3-64 chars, letters/digits/_/- only"),
  password: z.string().min(12, "Password must be at least 12 characters"),
});

export type SetupFormState = {
  error?: string;
  fieldErrors?: Partial<Record<"name" | "username" | "password", string>>;
};

export async function createAdmin(
  _prev: SetupFormState,
  formData: FormData,
): Promise<SetupFormState> {
  const db = getDatabase();
  if (hasAnyAdmin(db)) {
    return { error: "Setup has already been completed." };
  }

  const parsed = schema.safeParse({
    name: formData.get("name"),
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    const fieldErrors: SetupFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as "name" | "username" | "password";
      fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const user = createUser(db, {
    name: parsed.data.name,
    username: parsed.data.username,
    passwordHash,
    role: "admin",
    mustChangePassword: false,
  });

  const { token, expiresAt } = createSession(db, user.id);
  await writeSessionCookie(token, expiresAt);
  redirect("/");
}
