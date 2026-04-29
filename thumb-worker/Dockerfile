# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY thumb-worker/package.json thumb-worker/
RUN pnpm install --frozen-lockfile --filter @minifold/thumb-worker

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/thumb-worker/node_modules ./thumb-worker/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY thumb-worker thumb-worker
RUN pnpm --filter @minifold/thumb-worker build

# Standalone production install — installs only the three runtime deps
# (p-queue, puppeteer-core, three) without workspace overhead or .pnpm symlinks.
# The resulting node_modules has real files, no symlinks into a pnpm store.
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
COPY thumb-worker/package.json ./package.json
RUN npm install --omit=dev --no-package-lock 2>&1

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# Chromium's crashpad helper needs a writable HOME. The 'worker' user is
# created with --system below, which leaves /home/worker missing — point HOME
# at /tmp (worker has write access) so puppeteer.launch can boot Chromium.
ENV HOME=/tmp

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libc6 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libexpat1 \
      libfontconfig1 \
      libgbm1 \
      libgcc-s1 \
      libglib2.0-0 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libpangocairo-1.0-0 \
      libstdc++6 \
      libx11-6 \
      libx11-xcb1 \
      libxcb1 \
      libxcomposite1 \
      libxcursor1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxi6 \
      libxrandr2 \
      libxrender1 \
      libxss1 \
      libxtst6 \
      lsb-release \
      wget \
      xdg-utils \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs worker \
 && mkdir -p /app

# dist/ and node_modules/ are siblings under /app so that createRequire()
# in dist/render.js walks up from /app/dist to /app/node_modules/three/...
# The prod-deps stage produces a flat npm node_modules (real files, no pnpm
# symlinks) so the resolution works without a .pnpm store.
COPY --from=prod-deps --chown=worker:nodejs /app/node_modules ./node_modules
COPY --from=build     --chown=worker:nodejs /app/thumb-worker/dist ./dist

USER worker
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD \
  wget --quiet --tries=1 --spider http://127.0.0.1:3001/health || exit 1

CMD ["node", "dist/index.js"]
