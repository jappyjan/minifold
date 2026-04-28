import type { StorageProvider } from "@/server/storage/types";
import type { UserRow } from "@/server/db/users";
import type { Decision, Level, ParsedAccess, SimpleLevel } from "./types";
import { isUserList } from "./types";
import { readAccessFile } from "./read-access-file";

export type ResolverOptions = {
  user: UserRow | null;
  storage: StorageProvider;
  providerDefault: SimpleLevel | undefined;
  globalDefault: SimpleLevel;
};

export type EntryKind = "file" | "directory";

export interface Resolver {
  resolve(path: string, kind: EntryKind): Promise<Decision>;
}

export function createAccessResolver(opts: ResolverOptions): Resolver {
  const cache = new Map<string, ParsedAccess | null>();

  async function loadAccess(dir: string): Promise<ParsedAccess | null> {
    const cached = cache.get(dir);
    if (cached !== undefined) return cached;
    const fresh = await readAccessFile(opts.storage, dir);
    cache.set(dir, fresh);
    return fresh;
  }

  async function resolve(path: string, kind: EntryKind): Promise<Decision> {
    if (opts.user?.role === "admin") return "allow";

    let dir: string;
    let overrideKey: string | null = null;

    if (kind === "file") {
      dir = parentPath(path);
      overrideKey = baseName(path);
    } else {
      dir = path;
    }

    let levelToApply: Level | null = null;
    let firstIteration = true;

    while (true) {
      const access = await loadAccess(dir);
      if (access) {
        if (firstIteration && overrideKey !== null) {
          const ov = access.overrides[overrideKey];
          if (ov !== undefined) {
            levelToApply = ov;
            break;
          }
        }
        if (access.default !== undefined) {
          levelToApply = access.default;
          break;
        }
      }
      if (dir === "") break;
      dir = parentPath(dir);
      firstIteration = false;
    }

    if (levelToApply === null && opts.providerDefault !== undefined) {
      levelToApply = opts.providerDefault;
    }
    if (levelToApply === null) {
      levelToApply = opts.globalDefault;
    }

    return applyLevel(levelToApply, opts.user);
  }

  return { resolve };
}

function applyLevel(level: Level, user: UserRow | null): Decision {
  if (level === "public") return "allow";
  if (level === "signed-in") return user ? "allow" : "deny-anonymous";
  if (isUserList(level)) {
    if (!user) return "deny-anonymous";
    return level.includes(user.username.toLowerCase()) ? "allow" : "deny-authed";
  }
  // Defensive: unknown level shape — fail closed for non-admins.
  return user ? "deny-authed" : "deny-anonymous";
}

function parentPath(p: string): string {
  if (p === "") return "";
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function baseName(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}
