# Phase 1.5 — CI/CD + Coolify Deployment Pipeline

> **For agentic workers:** This plan slots between Foundation (complete) and Phase 2 (Auth + Setup Wizard). It adds GitHub Actions CI/CD and wires up a continuously-deployed test instance on the user's self-hosted Coolify.

**Spec reference:** [2026-04-23-minifold-design.md §14 Deployment](../specs/2026-04-23-minifold-design.md) — the spec calls for a single GHCR image with Docker compose templates. This phase produces the image publishing pipeline and one live consumer of it.

**Goal:** Every push to `main` runs tests and publishes a fresh Docker image to GHCR. A persistent Coolify test instance pulls that image on demand — triggered manually by the controller (or the user) via `coolify deploy uuid …`. This separation keeps the CI pipeline simple (no shared secrets with the deploy target) and leaves deploy timing under human control.

**Architecture:**
- GitHub Actions workflow `.github/workflows/ci.yml` runs on push/PR. Two jobs only — no deploy step.
  - Job `verify` — installs pnpm deps, runs `pnpm lint && pnpm typecheck && pnpm test && pnpm build` on Ubuntu. Fast, no Docker.
  - Job `publish` — depends on `verify`, only runs on pushes to `main`. Uses `docker/build-push-action` with GHA layer caching to build the image and push `ghcr.io/jappyjan/minifold:latest` + `:<short-sha>`. Authenticates via `GITHUB_TOKEN`. No Coolify secrets are stored in GitHub.
- Coolify setup done once via CLI (this plan's tasks 4–5):
  - Project: `Minifold`
  - Environment: `production`
  - Application: `minifold-test`, type `dockerimage`, source `ghcr.io/jappyjan/minifold:latest`
  - Server: `netcup` (the internet-accessible host)
  - Port: 3000
  - Persistent volume: `/app/data` so the SQLite DB survives redeploys
  - Health-check path: `/`
  - Domain: auto-assigned by Coolify's Traefik (can be customised later)
- Redeploys are manual: `coolify deploy uuid kl2kjsmt42md6ct7zt4g9wsk` (or the web UI). The controller runs this after confirming CI published a new image.

**Tech:**
- GitHub Actions (native)
- `actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4`
- `docker/setup-buildx-action@v3`, `docker/login-action@v3`, `docker/build-push-action@v6`
- GHCR (`ghcr.io/jappyjan/minifold`) — repo is public, package will be set public
- Coolify CLI (v1.6.2, already configured with `selfhosted` context)
- `gh` CLI (already authenticated as `jappyjan`)

**Out of scope (future phases):**
- Production domain + TLS — auto-assigned for now, tune later
- Staging vs production separation — one test instance for now
- Rollback automation — Coolify retains prior image tags; manual rollback via CLI suffices
- Database backups — SQLite DB on the persistent volume; no automated dump yet

---

## Resolved identifiers (used below)

| Name | Value |
|---|---|
| GitHub repo | `JappyJan/minifold` (public, default branch `main`) |
| GHCR image | `ghcr.io/jappyjan/minifold` |
| Coolify server UUID (netcup) | `kh81iz9kolb82gsi0bsm94kw` |
| Coolify context | `selfhosted` (default) |

Project + environment + app UUIDs are created during this plan and captured into memory after Task 4.

---

## File Structure

```
minifold/
  .github/
    workflows/
      ci.yml                # verify → publish → deploy
```

No source code is modified in this phase beyond adding the workflow.

---

## Task 1: CI verification workflow (lint + typecheck + test + build)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    name: Verify (lint / typecheck / test / build)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck

      - name: Test
        run: pnpm test

      - name: Build
        run: pnpm build
```

- [ ] **Step 2: Commit + push**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add verify workflow (lint, typecheck, test, build)"
git push origin main
```

- [ ] **Step 3: Wait for the workflow to finish and confirm it's green**

```bash
sleep 10
gh run watch --exit-status
```

Expected: the run completes with status `success`. If it fails, inspect `gh run view --log-failed` and fix root causes, commit, push, wait again.

---

## Task 2: Add image build + GHCR publish to CI

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Extend the workflow with a `publish` job**

Append to `.github/workflows/ci.yml` (after the `verify` job):

```yaml
  publish:
    name: Build & push image to GHCR
    needs: verify
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - name: Setup Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Derive metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/jappyjan/minifold
          tags: |
            type=raw,value=latest
            type=sha,format=short

      - name: Build & push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 2: Commit + push**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: build and push image to GHCR on main"
git push origin main
```

- [ ] **Step 3: Wait for the run to complete**

```bash
gh run watch --exit-status
```

Expected: both `verify` and `publish` jobs succeed.

- [ ] **Step 4: Confirm the image is published**

```bash
gh api /users/jappyjan/packages/container/minifold | jq '.name, .visibility'
```

Expected: `"minifold"` and `"private"` (default on first push).

---

## Task 3: Make the GHCR package public

Coolify must pull the image anonymously (no registry creds configured). Public repo → public package is the simplest setup.

- [ ] **Step 1: Flip visibility to public**

```bash
gh api --method PATCH /user/packages/container/minifold/visibility -f visibility=public
```

Expected: empty 204 response. Re-running `gh api /users/jappyjan/packages/container/minifold | jq .visibility` returns `"public"`.

- [ ] **Step 2: Verify anonymous pull works**

```bash
docker pull ghcr.io/jappyjan/minifold:latest
```

Expected: successful pull (from a logged-out context, or after `docker logout ghcr.io`). If this fails, the package visibility change didn't take effect — re-check the PATCH response.

---

## Task 4: Create Coolify project + application

- [ ] **Step 1: Create the project**

```bash
coolify project create --name "Minifold" --description "Self-hosted file browser — test instance"
```

Capture the returned project UUID; export it for the next step:

```bash
PROJECT_UUID=$(coolify project list --format json | jq -r '.[] | select(.name == "Minifold") | .uuid')
echo "PROJECT_UUID=$PROJECT_UUID"
```

- [ ] **Step 2: Create the application (dockerimage type)**

```bash
coolify app create dockerimage \
  --server-uuid kh81iz9kolb82gsi0bsm94kw \
  --project-uuid "$PROJECT_UUID" \
  --environment-name production \
  --name minifold-test \
  --description "Minifold continuous test deploy from ghcr.io/jappyjan/minifold:latest" \
  --docker-registry-image-name "ghcr.io/jappyjan/minifold" \
  --docker-registry-image-tag "latest" \
  --ports-exposes 3000 \
  --health-check-enabled \
  --health-check-path "/"
```

Do NOT pass `--instant-deploy` — the persistent volume is configured in Task 5 first.

Capture the app UUID:

```bash
APP_UUID=$(coolify app list --format json | jq -r '.[] | select(.name == "minifold-test") | .uuid')
echo "APP_UUID=$APP_UUID"
```

- [ ] **Step 3: Record UUIDs to project memory**

Save a new memory file (outside the repo) at `/Users/jappy/.claude/projects/-Users-jappy-code-jappyjan-minifold/memory/reference_coolify.md` recording `$PROJECT_UUID` and `$APP_UUID` for future reference. Update `MEMORY.md` index accordingly.

---

## Task 5: Attach persistent storage + deploy

- [ ] **Step 1: Create a bind volume for `/app/data`**

```bash
coolify app storage create --help   # review flags first
coolify app storage create \
  --application-uuid "$APP_UUID" \
  --mount-path /app/data \
  --volume-name minifold-data \
  [other required flags per --help output]
```

If `coolify app storage create` requires host-path vs volume flags differently than expected, use the flag names shown by `--help` verbatim. Report the exact command used.

- [ ] **Step 2: Trigger the first deployment**

```bash
coolify deploy uuid "$APP_UUID"
```

Wait for the deployment to become healthy:

```bash
for i in {1..60}; do
  status=$(coolify app get "$APP_UUID" --format json | jq -r .status)
  echo "status: $status"
  [[ "$status" == "running:healthy" ]] && break
  sleep 5
done
```

Expected: `running:healthy`. If it stalls or fails, fetch logs:

```bash
coolify app logs "$APP_UUID" | tail -100
```

- [ ] **Step 3: Capture the public URL**

```bash
APP_URL=$(coolify app get "$APP_UUID" --format json | jq -r '.fqdn // .domains[0] // empty')
echo "APP_URL=$APP_URL"
curl -sf "$APP_URL/" | grep -q "Welcome to Minifold" && echo HOME_OK
curl -s "$APP_URL/api/trpc/health.check?batch=1&input=%7B%220%22%3A%7B%7D%7D" | grep -q '"status":"ok"' && echo TRPC_OK
```

Expected: `HOME_OK` and `TRPC_OK`. Record `APP_URL` to the same memory file created in Task 4, so future sessions can find the test instance.

---

## Task 6: Document the manual redeploy procedure

No GitHub-side wiring. The test instance is redeployed manually whenever we want to verify a pushed change live. GitHub Actions' responsibility ends at publishing the image; Coolify's responsibility starts at pulling it.

- [ ] **Step 1: Confirm the manual redeploy flow**

After a commit is pushed and CI finishes publishing the image:

```bash
# 1. Verify the image tag for the commit is on GHCR (optional sanity check):
gh run view --log $(gh run list --limit 1 --json databaseId -q '.[0].databaseId') | grep -E "digest|Tag"

# 2. Trigger a Coolify redeploy (will pull the fresh :latest):
coolify deploy uuid kl2kjsmt42md6ct7zt4g9wsk

# 3. Wait for healthy:
for i in {1..60}; do
  s=$(coolify app get kl2kjsmt42md6ct7zt4g9wsk --format json | jq -r .status)
  echo "$s"
  [[ "$s" == "running:healthy" ]] && break
  sleep 5
done

# 4. Smoke-test the URL:
curl -sf http://kl2kjsmt42md6ct7zt4g9wsk.202.61.192.119.sslip.io/ > /dev/null && echo OK
```

The UUID and URL are recorded in project memory (`reference_coolify.md`) so future sessions can replay this procedure without rediscovery.

- [ ] **Step 2: (Already done in Task 5) Verify the reference_coolify.md memory file exists**

```bash
ls /Users/jappy/.claude/projects/-Users-jappy-code-jappyjan-minifold/memory/reference_coolify.md
```

---

## Task 7: End-to-end smoke test

Prove the full loop: commit → CI verify → image published → manual Coolify deploy → change visible on live URL.

- [ ] **Step 1: Make a trivial user-visible change**

Edit `src/app/page.tsx` — change `"Welcome to Minifold."` to `"Welcome to Minifold — test deploy."` (or any observable tweak).

- [ ] **Step 2: Run tests locally, commit, push**

```bash
pnpm test
git add src/app/page.tsx
git commit -m "chore: smoke-test CI/CD pipeline by updating welcome text"
git push origin main
```

- [ ] **Step 3: Watch CI**

```bash
gh run watch --exit-status
```

Expected: `verify` + `publish` both succeed. No deploy job.

- [ ] **Step 4: Manually trigger Coolify redeploy**

```bash
coolify deploy uuid kl2kjsmt42md6ct7zt4g9wsk
for i in {1..60}; do
  s=$(coolify app get kl2kjsmt42md6ct7zt4g9wsk --format json | jq -r .status)
  echo "[$i] $s"
  [[ "$s" == "running:healthy" ]] && break
  sleep 5
done
```

- [ ] **Step 5: Curl the live URL and confirm the new copy**

```bash
APP_URL=http://kl2kjsmt42md6ct7zt4g9wsk.202.61.192.119.sslip.io
curl -s "$APP_URL/" | grep -q "test deploy" && echo DEPLOYED
```

Expected: `DEPLOYED`.

- [ ] **Step 6: Revert the cosmetic text change**

```bash
git revert HEAD --no-edit
git push origin main
gh run watch --exit-status
coolify deploy uuid kl2kjsmt42md6ct7zt4g9wsk
```

Verify the welcome text is back to `"Welcome to Minifold."` on the live URL. This second round proves repeated deploys remain stable.

---

## Phase 1.5 exit criteria

- ✅ `.github/workflows/ci.yml` exists with `verify` + `publish` jobs (no deploy job).
- ✅ `ghcr.io/jappyjan/minifold:latest` + `:<short-sha>` are published on every main push.
- ✅ GHCR package is publicly pullable.
- ✅ Coolify project `Minifold` + app `minifold-test` exist; persistent volume mounted at `/app/data`.
- ✅ No Coolify credentials in GitHub secrets (CI knows nothing about the deploy target).
- ✅ `APP_URL` recorded in memory; hitting it returns "Welcome to Minifold" and a working tRPC health endpoint.
- ✅ The controller or user can run `coolify deploy uuid kl2kjsmt42md6ct7zt4g9wsk` after a push to bring the test instance up to date.

## Self-review notes

- Spec coverage: §14 calls for GHCR-published images — Task 2 covers this.
- No new production code; no new tests required. Everything is wired via CI config + one-time Coolify setup.
- Later phases will benefit from this: every implementation plan's "verification" step can now include "push to main; verify at `$APP_URL`" as a real check.
