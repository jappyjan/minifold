import { parse as parseYaml, YAMLParseError } from "yaml";
import type { Level, ParsedAccess } from "./types";

const SIMPLE_LEVELS = new Set(["public", "signed-in"]);

function coerceLevel(
  value: unknown,
  pushWarning: (msg: string) => void,
  context: string,
): Level | undefined {
  if (typeof value === "string") {
    if (SIMPLE_LEVELS.has(value)) return value as Level;
    pushWarning(`${context}: invalid level "${value}"`);
    return undefined;
  }
  if (Array.isArray(value)) {
    const usernames: string[] = [];
    for (const item of value) {
      if (typeof item === "string") {
        usernames.push(item.toLowerCase());
      } else {
        pushWarning(`${context}: list contains non-string entry`);
      }
    }
    return usernames;
  }
  pushWarning(`${context}: expected string or list`);
  return undefined;
}

export function parseAccessFile(text: string): ParsedAccess {
  const warnings: string[] = [];
  const result: ParsedAccess = { overrides: {}, warnings };

  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    warnings.push(
      `failed to parse YAML: ${err instanceof YAMLParseError ? err.message : String(err)}`,
    );
    return result;
  }

  if (raw === null || raw === undefined) return result;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push("root must be a mapping (key: value)");
    return result;
  }

  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key === "default") continue;
    if (key === "overrides") continue;
    warnings.push(`unknown top-level key "${key}"`);
  }

  if ("default" in obj) {
    const lvl = coerceLevel(obj.default, (m) => warnings.push(m), "default");
    if (lvl !== undefined) result.default = lvl;
  }

  if ("overrides" in obj) {
    const ov = obj.overrides;
    if (ov === null || ov === undefined) {
      // treat as empty
    } else if (typeof ov !== "object" || Array.isArray(ov)) {
      warnings.push("overrides must be a mapping");
    } else {
      for (const [name, value] of Object.entries(ov as Record<string, unknown>)) {
        const lvl = coerceLevel(value, (m) => warnings.push(m), `overrides.${name}`);
        if (lvl !== undefined) result.overrides[name] = lvl;
      }
    }
  }

  return result;
}
