import { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/current-user";
import { loadProvider } from "@/server/browse/load-provider";
import { decodePathSegments } from "@/server/browse/encode-path";
import { thumbSidecarPath } from "@/server/thumb/sidecar-name";
import { getThumbnailServiceUrl } from "@/server/thumb/config";
import { fetchThumbnail, ThumbnailServiceError } from "@/server/thumb/client";
import { NotFoundError, PathTraversalError } from "@/server/storage/types";

const SUPPORTED_EXT = new Set(["stl", "3mf"]);
const TIMEOUT_MS = 30_000;

type Ctx = {
  params: Promise<{ provider: string; path: string[] }>;
};

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { provider: slug, path: rawSegments = [] } = await ctx.params;
  const segments = decodePathSegments(rawSegments);
  if (!segments) return new Response("Bad Request", { status: 400 });
  const path = segments.join("/");

  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (!SUPPORTED_EXT.has(ext)) return new Response("Unsupported", { status: 400 });

  const provider = loadProvider(slug);
  if (!provider) return new Response("Not Found", { status: 404 });

  const serviceUrl = getThumbnailServiceUrl();
  if (!serviceUrl) return new Response("Thumbnails Disabled", { status: 404 });

  const sidecar = thumbSidecarPath(path);

  // Serve cached sidecar if available.
  try {
    if (await provider.exists(sidecar)) {
      const stream = await provider.read(sidecar);
      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": "image/webp",
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    }
  } catch {
    // Fall through to regenerate.
  }

  // Read the source file.
  let source: Buffer;
  try {
    const stream = await provider.read(path);
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    source = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof PathTraversalError) {
      return new Response("Not Found", { status: 404 });
    }
    throw err;
  }

  // Generate thumbnail via worker service.
  let thumb: Buffer;
  try {
    thumb = await fetchThumbnail({
      serviceUrl,
      data: source,
      format: ext as "stl" | "3mf",
      timeoutMs: TIMEOUT_MS,
    });
  } catch (err) {
    if (err instanceof ThumbnailServiceError) {
      return new Response("Thumbnail Service Error", { status: 502 });
    }
    throw err;
  }

  // Cache the sidecar (best-effort — don't block the response on write errors).
  void provider.write(sidecar, thumb).catch(() => {});

  return new Response(new Uint8Array(thumb), {
    status: 200,
    headers: {
      "content-type": "image/webp",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
