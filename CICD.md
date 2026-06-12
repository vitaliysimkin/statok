# CI/CD — Statok

> Single-user self-hosted portfolio tracker.
> Images: `ghcr.io/vitaliysimkin/statok/{backend,frontend}`.
> VPS: Hetzner, behind shared external Traefik (`web` network).
> Domains: `statok.simk.in.ua` (frontend), `api.statok.simk.in.ua` (backend).

---

## Release flow

```
bun run release:patch          # or release:minor / release:major
  → scripts/release.mjs
      bumps version in root + backend + frontend package.json
      git commit "chore: release vX.Y.Z"
      git tag vX.Y.Z
      git push && git push origin vX.Y.Z
        → triggers build-backend.yml + build-frontend.yml
        → triggers deploy.yml
```

The single source of truth for the version is `version` in the root `package.json`.

### Automated (GitHub Actions `workflow_dispatch`)

You can also trigger a release without cloning:
1. Actions → **Release** → Run workflow → pick `patch | minor | major`.
   Requires `RELEASE_TOKEN` secret (fine-grained PAT with `contents: write`).

---

## Build workflows

### `.github/workflows/build-backend.yml`

- Trigger: push tag `v*`
- Context: repo root, Dockerfile: `backend/Dockerfile`
- Pushes:
  - `ghcr.io/vitaliysimkin/statok/backend:X.Y.Z`
  - `ghcr.io/vitaliysimkin/statok/backend:latest`
- Auth: `GITHUB_TOKEN` (no extra secret needed)

### `.github/workflows/build-frontend.yml`

- Trigger: push tag `v*`
- Context: repo root, Dockerfile: `frontend/Dockerfile`
- Build arg: `VITE_API_URL=https://api.statok.simk.in.ua`
- Pushes:
  - `ghcr.io/vitaliysimkin/statok/frontend:X.Y.Z`
  - `ghcr.io/vitaliysimkin/statok/frontend:latest`

---

## Deploy workflow (`.github/workflows/deploy.yml`)

Trigger: push tag `v*` (runs after both build jobs succeed).

Steps:
1. **Wait for builds** — polls `build-backend` and `build-frontend` check runs.
2. **scp `infra/`** to `/opt/statok/` on the VPS.
3. **SSH to VPS:**
   ```sh
   sed -i "s/^STATOK_VERSION=.*/STATOK_VERSION=X.Y.Z/" /opt/statok/.env
   docker compose -f docker-compose.yml pull
   docker compose -f docker-compose.yml up -d --remove-orphans
   ```
4. **Health check** — polls `https://api.statok.simk.in.ua/health` for `{"status":"ok"}`,
   retries every 5 s up to 120 s.
5. **GitHub Release** — auto-generated release notes via `softprops/action-gh-release`.
6. **Telegram notify** — posts deploy result to configured chat.

### Required GitHub secrets (`[manual-owner]`)

| Secret | Description |
|---|---|
| `VPS_HOST` | VPS IP or hostname |
| `VPS_USER` | SSH user (e.g. `deploy`) |
| `VPS_SSH_KEY` | Private SSH key (ed25519 or RSA, no passphrase) |
| `RELEASE_TOKEN` | Fine-grained PAT — `contents: write` on this repo (for `release.yml` to push tags) |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Numeric chat/channel ID |

---

## Manual redeploy / rollback

```sh
export VPS_HOST=<ip>
export VPS_USER=<user>
./deploy.sh 0.3.1      # any previous vX.Y.Z tag that has GHCR images
```

`deploy.sh` performs the same scp + ssh + health-check steps as the CI workflow.
The GHCR images for any released tag remain available indefinitely (not pruned by CI).

---

## One-time server bootstrap (`[manual-owner]`)

1. DNS A-records: `statok.simk.in.ua` and `api.statok.simk.in.ua` → VPS IP.
2. External Traefik (`dakara` repo) must be running with the `web` network and `le`
   certresolver. Statok joins it — no separate Traefik needed.
3. Create `/opt/statok/.env` on the VPS (see `infra/README.md` for full template).
   Minimum fields:
   ```
   STATOK_VERSION=
   DATABASE_URL=postgresql://statok:<pw>@postgres:5432/statok
   JWT_SECRET=<≥32 random chars>
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=<strong>
   POSTGRES_PASSWORD=<pw>
   BASE_CURRENCY=USD
   ```
4. Run `bun run release:patch` (or dispatch the Release workflow) — first deploy happens
   automatically.

---

## Local dev

See `README.md` Quick Start. Short version:

```sh
docker compose -f docker-compose.dev.yml up -d   # Postgres on :5434
cd backend && bun run --env-file .env.dev dev     # API on :3100
cd frontend && bun run dev                        # Vite on :5273
```
