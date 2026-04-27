import { createServer } from "./server.js";
import { renderThumbnail, shutdownBrowser } from "./render.js";
async function main() {
    const port = Number(process.env.PORT ?? 3001);
    const concurrency = Number(process.env.THUMB_WORKER_CONCURRENCY ?? 2);
    const server = createServer({
        concurrency,
        render: renderThumbnail,
    });
    const actual = await server.listen(port);
    console.log(`minifold-thumb-worker listening on :${actual}`);
    const shutdown = async () => {
        await server.close().catch(() => { });
        await shutdownBrowser().catch(() => { });
        process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
