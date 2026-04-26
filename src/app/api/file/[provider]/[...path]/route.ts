import { getCurrentUser } from "@/server/auth/current-user";
import { loadProvider } from "@/server/browse/load-provider";
import { mimeFor } from "@/server/browse/mime";
import {
  NotFoundError,
  PathTraversalError,
} from "@/server/storage/types";

type Ctx = {
  params: Promise<{ provider: string; path: string[] }>;
};

export async function GET(req: Request, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { provider: slug, path: segments } = await ctx.params;
  const provider = loadProvider(slug);
  if (!provider) return new Response("Not Found", { status: 404 });

  const path = (segments ?? []).join("/");
  const fileName = segments?.[segments.length - 1] ?? "";

  let entry;
  try {
    entry = await provider.stat(path);
  } catch (err) {
    if (err instanceof PathTraversalError) {
      return new Response("Bad Request", { status: 400 });
    }
    if (err instanceof NotFoundError) {
      return new Response("Not Found", { status: 404 });
    }
    throw err;
  }
  if (entry.type !== "file") {
    return new Response("Bad Request", { status: 400 });
  }

  let body;
  try {
    body = await provider.read(path);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return new Response("Not Found", { status: 404 });
    }
    if (err instanceof PathTraversalError) {
      return new Response("Bad Request", { status: 400 });
    }
    throw err;
  }

  const inline = new URL(req.url).searchParams.get("inline") === "1";
  const disposition = inline
    ? `inline; filename="${encodeFilename(fileName)}"`
    : `attachment; filename="${encodeFilename(fileName)}"`;

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": mimeFor(fileName),
      "content-length": String(entry.size),
      "content-disposition": disposition,
      "cache-control": "private, max-age=0",
    },
  });
}

function encodeFilename(name: string): string {
  // Escape quotes and backslashes; keep it ASCII-safe inside the quoted string.
  return name.replace(/[\\"]/g, "\\$&");
}
