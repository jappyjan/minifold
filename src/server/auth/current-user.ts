import { getDatabase } from "@/server/db";
import { validateSession } from "./session";
import { readSessionCookie } from "./cookies";
import type { UserRow } from "@/server/db/users";

export async function getCurrentUser(): Promise<UserRow | null> {
  const token = await readSessionCookie();
  if (!token) return null;
  const result = validateSession(getDatabase(), token);
  return result?.user ?? null;
}
