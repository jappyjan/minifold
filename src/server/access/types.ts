// src/server/access/types.ts
//
// Access-control type vocabulary shared across the access subsystem.

/** Levels that can appear in `.minifold_access.yaml` and provider/global defaults. */
export type SimpleLevel = "public" | "signed-in";

/** Full level shape including user-list — only present in YAML files, not in DB defaults. */
export type Level = SimpleLevel | string[]; // string[] = lowercased usernames (user-list)

/** Outcome of an access check for a specific (user, path). */
export type Decision = "allow" | "deny-anonymous" | "deny-authed";

/** Result of parsing a `.minifold_access.yaml` file. */
export type ParsedAccess = {
  default?: Level;
  overrides: Record<string, Level>;
  warnings: string[];
};

/** Type guard: is the level a user-list? */
export function isUserList(level: Level): level is string[] {
  return Array.isArray(level);
}
