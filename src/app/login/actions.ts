"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDatabase } from "@/server/db";
import { findUserByUsername, setLastLogin } from "@/server/db/users";
import { verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { writeSessionCookie } from "@/server/auth/cookies";

const schema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
  callbackUrl: z.string().optional(),
});

export type LoginFormState = { error?: string };

export async function login(
  _prev: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const parsed = schema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
    callbackUrl: formData.get("callbackUrl"),
  });
  if (!parsed.success) {
    return { error: "Please enter a valid username and password." };
  }

  const db = getDatabase();
  const user = findUserByUsername(db, parsed.data.username);
  if (!user || user.deactivated === 1) {
    return { error: "Invalid username or password." };
  }

  const ok = await verifyPassword(parsed.data.password, user.password);
  if (!ok) {
    return { error: "Invalid username or password." };
  }

  setLastLogin(db, user.id);
  const { token, expiresAt } = createSession(db, user.id);
  await writeSessionCookie(token, expiresAt);

  const dest =
    parsed.data.callbackUrl && parsed.data.callbackUrl.startsWith("/")
      ? parsed.data.callbackUrl
      : "/";
  revalidatePath("/", "layout");
  redirect(dest);
}
