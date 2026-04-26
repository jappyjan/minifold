import type { StorageProvider } from "@/server/storage/types";

export async function readTextFile(
  provider: StorageProvider,
  path: string,
): Promise<string> {
  const stream = await provider.read(path);
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf-8");
}
