# Minifold

Self-hosted file browser for 3D print files (STL, 3MF), documents (Markdown, PDF), and arbitrary folder structures.

## Deployment

[`docker-compose.yml`](docker-compose.yml) deploys both the main app and the optional thumbnail worker (Puppeteer + Three.js, generates `.minifold_thumb_*.webp` sidecars on first view of each `.stl`/`.3mf`):

```bash
docker compose up -d
```

Don't want server-side thumbnails? Comment out the `minifold-thumbs` service and the `MINIFOLD_THUMB_SERVICE_URL` env var. The grid falls back to type icons; the interactive 3D viewer on file detail pages still works.

The `MINIFOLD_THUMB_SERVICE_URL` env var is what gates the `/api/thumb/*` endpoint at runtime — flip it on or off and restart, no rebuild needed.

## Development

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000>. The first run launches a setup wizard to create the admin user and configure storage providers.

Testing:

```bash
pnpm test                                   # main app
pnpm --filter @minifold/thumb-worker test   # worker
pnpm typecheck
pnpm lint
pnpm build
```

## Project structure

- `src/` — Next.js app (App Router), tRPC server, storage providers (local FS + S3).
- `thumb-worker/` — optional thumbnail rendering service (Puppeteer + Three.js). Built into a separate Docker image.
- `docs/superpowers/` — design specs and implementation plans.
- `bin/cli.mjs` — admin CLI for user/provider management.
