import { createServer } from "./server";

async function main() {
  const port = Number(process.env.PORT ?? 3001);
  const concurrency = Number(process.env.THUMB_WORKER_CONCURRENCY ?? 2);

  const server = createServer({
    concurrency,
    render: async () => {
      throw new Error("renderer not yet wired (Task 3)");
    },
  });

  const actual = await server.listen(port);
  console.log(`minifold-thumb-worker listening on :${actual}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
