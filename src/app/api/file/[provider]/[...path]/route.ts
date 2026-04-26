import { getCurrentUser } from "@/server/auth/current-user";
import { loadProvider } from "@/server/browse/load-provider";
import { mimeFor } from "@/server/browse/mime";
import { decodePathSegments } from "@/server/browse/encode-path";
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

  const { provider: slug, path: rawSegments } = await ctx.params;
  const segments = decodePathSegments(rawSegments ?? []);
  if (!segments) return new Response("Bad Request", { status: 400 });
  const provider = loadProvider(slug);
  if (!provider) return new Response("Not Found", { status: 404 });

  const path = segments.join("/");
  const fileName = segments[segments.length - 1] ?? "";

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
  const dispositionType = inline ? "inline" : "attachment";

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": mimeFor(fileName),
      "content-length": String(entry.size),
      "content-disposition": `${dispositionType}; ${dispositionFilename(fileName)}`,
      "cache-control": "private, max-age=0",
    },
  });
}

// RFC 6266 / RFC 5987: emit both `filename=` (ASCII fallback) and
// `filename*=UTF-8''…` (percent-encoded UTF-8) so browsers handle non-ASCII
// names correctly. CR/LF are stripped to avoid header injection.
function dispositionFilename(name: string): string {
  const safe = name.replace(/[\r\n]/g, "");
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "\\$&");
  const encoded = encodeURIComponent(safe);
  return `filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
