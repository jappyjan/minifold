import { createServer as createHttpServer, type Server } from "node:http";
import { ThumbQueue } from "./queue.js";

export type RenderFn = (
  data: Buffer,
  format: "stl" | "3mf",
) => Promise<Buffer>;

export type ThumbServer = {
  listen(port: number): Promise<number>;
  close(): Promise<void>;
};

type Options = {
  render: RenderFn;
  concurrency: number;
};

const SUPPORTED_FORMATS = new Set(["stl", "3mf"]);

export function createServer(opts: Options): ThumbServer {
  const queue = new ThumbQueue({ concurrency: opts.concurrency });

  const http: Server = createHttpServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.method === "POST" && req.url?.startsWith("/render")) {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const format = url.searchParams.get("format");
      if (!format || !SUPPORTED_FORMATS.has(format)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "missing or unsupported format" }));
        return;
      }
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = Buffer.concat(chunks);
        const out = await queue.add(() => opts.render(body, format as "stl" | "3mf"));
        res.writeHead(200, { "content-type": "image/webp" });
        res.end(out);
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  return {
    listen(port: number): Promise<number> {
      return new Promise((resolve, reject) => {
        http.once("error", reject);
        http.listen(port, () => {
          const addr = http.address();
          if (typeof addr === "object" && addr) resolve(addr.port);
          else reject(new Error("listen returned no address"));
        });
      });
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        http.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
