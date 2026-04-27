# Minifold

Self-hosted file browser for 3D print files (STL, 3MF), documents (Markdown, PDF), and arbitrary folder structures.

## Deployment

Two ways to run Minifold from prebuilt images on GHCR.

### Minimal — single container, no thumbnails

The smallest deployment. 3D models render via icons in the grid; the interactive 3D viewer still works on file detail pages.

```yaml
services:
  minifold:
    image: ghcr.io/jappyjan/minifold:latest
    restart: unless-stopped
    environment:
      DATABASE_PATH: /data/minifold.db
    volumes:
      - minifold-data:/data
    ports:
      - "3000:3000"

volumes:
  minifold-data:
```

### Full — with server-side thumbnail rendering

Adds a second container (`minifold-thumbs`) running headless Chromium + Three.js. Thumbnails for `.stl` and `.3mf` files are generated lazily on first request and cached as `.minifold_thumb_<filename>.webp` sidecars next to the source files.

The full template is in [`docker-compose.example.yml`](docker-compose.example.yml). To enable thumbnails, set `MINIFOLD_THUMB_SERVICE_URL` on the main app to point at the worker (the example uses an internal Docker network so the worker is never exposed publicly).

```bash
docker compose -f docker-compose.example.yml up -d
```

### Toggling thumbnails on/off

The main image checks `MINIFOLD_THUMB_SERVICE_URL` at runtime. If unset (or empty), the `/api/thumb/*` endpoint returns 404 and the grid falls back to type icons. No code change or rebuild needed — flip the env var and restart the main container.

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
