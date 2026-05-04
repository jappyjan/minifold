# Minifold

Self-hosted file browser for 3D print files (STL, 3MF), documents (Markdown, PDF), and arbitrary folder structures.

## Deployment

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/jappyjan/minifold)

Pick the template that matches your environment:

| Template | Target |
|---|---|
| [`docker-compose.yml`](docker-compose.yml) | Generic Docker Compose. Self-hosted with your own reverse proxy. |
| [`docker-compose.coolify.yml`](docker-compose.coolify.yml) | Coolify v4. |
| [`docker-compose.traefik.yml`](docker-compose.traefik.yml) | Generic Traefik (set `MINIFOLD_DOMAIN` in `.env`). |
| [`unraid-template.xml`](unraid-template.xml) | Unraid Community Applications. |
| [`render.yaml`](render.yaml) | Render one-click deploy. |

For the Compose templates:

```bash
docker compose -f docker-compose.yml up -d
```

**Thumbnails are optional.** The Compose templates include the optional `minifold-thumbs` service (Puppeteer + Three.js, generates `.minifold_thumb_*.webp` sidecars on first view of each `.stl`/`.3mf`). To disable: comment out the `minifold-thumbs` service and the `MINIFOLD_THUMB_SERVICE_URL` env var. The grid falls back to type icons; the interactive 3D viewer on file detail pages still works. The `MINIFOLD_THUMB_SERVICE_URL` env var gates the `/api/thumb/*` endpoint at runtime — flip it on or off and restart, no rebuild needed. Unraid and Render templates do not include thumbs by default; add the `minifold-thumbs` container manually if you want server-side thumbnails.

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
