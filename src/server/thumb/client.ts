export class ThumbnailServiceError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = "ThumbnailServiceError";
  }
}

type Args = {
  serviceUrl: string;
  data: Buffer;
  format: "stl" | "3mf";
  timeoutMs: number;
};

export async function fetchThumbnail({ serviceUrl, data, format, timeoutMs }: Args): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${serviceUrl}/render?format=${format}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array(data),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new ThumbnailServiceError(`render failed: ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf;
  } catch (err) {
    if (err instanceof ThumbnailServiceError) throw err;
    throw new ThumbnailServiceError("render request failed", err);
  } finally {
    clearTimeout(timer);
  }
}
