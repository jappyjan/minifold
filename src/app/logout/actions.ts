"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDatabase } from "@/server/db";
import { destroySession } from "@/server/auth/session";
import { clearSessionCookie, readSessionCookie } from "@/server/auth/cookies";

export async function logout(): Promise<void> {
  const token = await readSessionCookie();
  if (token) {
    destroySession(getDatabase(), token);
  }
  await clearSessionCookie();
  revalidatePath("/", "layout");
  redirect("/login");
}
