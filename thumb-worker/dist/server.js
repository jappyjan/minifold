import { createServer as createHttpServer } from "node:http";
import { ThumbQueue } from "./queue.js";
const SUPPORTED_FORMATS = new Set(["stl", "3mf"]);
export function createServer(opts) {
    const queue = new ThumbQueue({ concurrency: opts.concurrency });
    const http = createHttpServer(async (req, res) => {
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
                const chunks = [];
                for await (const chunk of req)
                    chunks.push(chunk);
                const body = Buffer.concat(chunks);
                const out = await queue.add(() => opts.render(body, format));
                res.writeHead(200, { "content-type": "image/webp" });
                res.end(out);
            }
            catch (err) {
                res.writeHead(500, { "content-type": "application/json" });
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
    });
    return {
        listen(port) {
            return new Promise((resolve, reject) => {
                http.once("error", reject);
                http.listen(port, () => {
                    const addr = http.address();
                    if (typeof addr === "object" && addr)
                        resolve(addr.port);
                    else
                        reject(new Error("listen returned no address"));
                });
            });
        },
        close() {
            return new Promise((resolve, reject) => {
                http.close((err) => (err ? reject(err) : resolve()));
            });
        },
    };
}
