import type { StorageProvider } from "@/server/storage/types";
import { parseAccessFile } from "./format";
import type { ParsedAccess } from "./types";

const ACCESS_FILE_NAME = ".minifold_access.yaml";

export function accessFilePath(dirPath: string): string {
  return dirPath === "" ? ACCESS_FILE_NAME : `${dirPath}/${ACCESS_FILE_NAME}`;
}

/**
 * Reads and parses `<dirPath>/.minifold_access.yaml` via the storage provider.
 * Returns `null` if the file does not exist (or could not be read at all).
 * Returns a `ParsedAccess` (possibly with warnings) otherwise.
 *
 * Logs malformed-file warnings to `console.warn` so operators see them in
 * server logs without locking out the subtree.
 */
export async function readAccessFile(
  storage: StorageProvider,
  dirPath: string,
): Promise<ParsedAccess | null> {
  const path = accessFilePath(dirPath);
  let exists: boolean;
  try {
    exists = await storage.exists(path);
  } catch {
    return null;
  }
  if (!exists) return null;

  let text: string;
  try {
    const stream = await storage.read(path);
    text = await readStreamToString(stream);
  } catch {
    return null;
  }

  const parsed = parseAccessFile(text);
  if (parsed.warnings.length > 0) {
    for (const w of parsed.warnings) {
      console.warn(`[access] ${storage.slug}/${path}: ${w}`);
    }
  }
  return parsed;
}

async function readStreamToString(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return new TextDecoder("utf-8").decode(buf);
}
