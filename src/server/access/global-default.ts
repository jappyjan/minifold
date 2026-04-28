import type { Database } from "better-sqlite3";
import { getSetting } from "@/server/db/settings";
import type { SimpleLevel } from "./types";

const KEY = "global_default_access";

export function getGlobalDefaultAccess(db: Database): SimpleLevel {
  const raw = getSetting(db, KEY);
  if (raw === "public" || raw === "signed-in") return raw;
  return "signed-in";
}
