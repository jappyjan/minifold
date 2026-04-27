import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type ThumbServer } from "../src/server";

let server: ThumbServer;
let port: number;
const fakeRender = async (_buf: Buffer, _format: "stl" | "3mf") =>
  Buffer.from([0x00, 0x01, 0x02, 0x03]);

beforeAll(async () => {
  server = createServer({ render: fakeRender, concurrency: 2 });
  port = await server.listen(0);
});

afterAll(async () => {
  await server.close();
});

describe("thumb-worker HTTP", () => {
  it("GET /health returns 200 ok", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("POST /render?format=stl returns the rendered bytes", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/render?format=stl`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array([1, 2, 3, 4, 5]),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf).toEqual(Buffer.from([0x00, 0x01, 0x02, 0x03]));
  });

  it("POST /render with missing format returns 400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/render`, {
      method: "POST",
      body: new Uint8Array([1, 2]),
    });
    expect(res.status).toBe(400);
  });

  it("POST /render with unknown format returns 400", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/render?format=obj`, {
      method: "POST",
      body: new Uint8Array([1, 2]),
    });
    expect(res.status).toBe(400);
  });

  it("POST to unknown route returns 404", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nope`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});
