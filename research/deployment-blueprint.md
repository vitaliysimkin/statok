# Statok — Deployment Blueprint

> Reverse-engineered from the user's existing conventions and tailored for **Statok**
> (self-hosted, single-user personal-finance app: portfolio/investment tracking first,
> expenses/analytics later).
>
> Reference projects inspected: `O:\projects\tardis` (full reference) and
> `O:\projects\flatlog` (currently an empty stub — only `README.md` + initial commit,
> contributes nothing yet). **Everything below mirrors tardis**, which is the only
> materialized convention.

---

## 1. The pattern Statok should copy (from tardis)

Tardis is a **two-service web app (Vue SPA + Bun/Hono API) on Postgres**, containerized
to **GHCR images**, deployed to a **Hetzner VPS** behind a **shared external Traefik edge**,
driven by a **version-tag → GitHub Actions → SSH `docker compose pull && up -d`** pipeline.
Single source of truth for the release version is the root `package.json`.

Concrete stack from tardis:

| Layer | Tardis choice | Files |
| --- | --- | --- |
| Backend runtime | **Bun 1.2** (`oven/bun:1.2-alpine`) | `backend/Dockerfile`, `backend/package.json` |
| Backend framework | **Hono 4** | `backend/src/index.ts` |
| ORM / migrations | **Drizzle ORM** + `drizzle-kit`, raw SQL files in `backend/drizzle/`, run at startup via `drizzle-orm/.../migrator` | `backend/drizzle.config.ts`, `backend/src/db/migrate.ts` |
| DB | **Postgres** (16-alpine prod, 15-alpine dev) | `infra/docker-compose.yml`, `docker-compose.dev.yml` |
| Frontend | **Vue 3 + Vite** (rolldown-vite), TS, vue-router, vue-i18n | `frontend/package.json`, `frontend/vite.config.ts` |
| Frontend serving | Multi-stage Docker → static `dist` served by **nginx:stable-alpine** with SPA fallback | `frontend/Dockerfile`, `frontend/nginx.conf` |
| Registry | **ghcr.io/vitaliysimkin/<repo>/{frontend,backend}** | `.github/workflows/build-*.yml` |
| Edge / TLS | **External Traefik** (separate "dakara" repo) via Docker labels + `le` certresolver on the external `web` network | `infra/docker-compose.yml` labels |
| Release | Root `package.json` version → `bun run release:patch` (or Actions "Release") → tag `vX.Y.Z` | `scripts/release.mjs`, `.github/workflows/release.yml` |
| Deploy | Tag `v*` triggers build → `deploy.yml` waits for builds → `scp` infra → SSH `docker compose pull && up -d --remove-orphans` → `/health` check → GitHub Release → Telegram notify | `.github/workflows/deploy.yml`, `deploy.sh` |
| Secrets | `.env` lives **only on the VPS** at `/opt/<app>/.env`; CI updates just the version line via `sed`; templated config rendered with `envsubst` | `infra/README.md`, `deploy.yml` |

Notable conventions:
- Monorepo: `backend/` + `frontend/` + `packages/shared` + `infra/` + `scripts/`.
- Dev DB runs from a root `docker-compose.dev.yml` (Postgres only) on a **non-standard host port** (tardis uses `5433:5432`).
- Backend runs migrations + an admin seed automatically on boot (`runMigrations()` + `seedAdmin()` in `index.ts`).
- `/health` returns `{status:"ok", version}` and is what the deploy pipeline polls.
- Two env files: `backend/.env.dev` (committed, dummy secrets) and `backend/.env` (gitignored, real secrets).
- Image build args inject the public API URL into the frontend at build time (`VITE_API_URL`).
- Traefik routes both a dedicated API host (`api.<app>.simk.in.ua`) **and** path-prefixed
  `/api`,`/auth`,`/health` on the main host to the backend.

---

## 2. Recommended stack for Statok

Stay on the user's muscle memory — **clone tardis's stack exactly**:

- **Backend:** Bun 1.2 + Hono + Drizzle ORM + `postgres` driver. TS, ESM.
- **DB:** Postgres 16-alpine.
- **Frontend:** Vue 3 + Vite + TS + vue-router + vue-i18n, the user's own
  `@vitaliysimkin/t-components` component library, `system-uicons` icon set only
  (same icon rule as tardis CLAUDE.md). Served via nginx static image.
- **Auth:** single-user → JWT (`jose`) + bcrypt admin seed, identical to tardis.
- **Money correctness (Statok-specific, the one place to deviate):** store monetary
  amounts as integer **minor units + currency code** (or Postgres `numeric`), never JS
  floats. Add a daily FX-rate fetch job (tardis already has a `jobs/` folder pattern —
  `backend/src/jobs/syncIntegrations.ts`) and a prices job for quotes. Keep a
  `currencies`, `fx_rates`, `accounts`, `holdings`, `transactions` schema in
  `backend/src/db/schema.ts`.

### Domains (mirror tardis's simk.in.ua scheme)
- `statok.simk.in.ua` — frontend
- `api.statok.simk.in.ua` — backend

### Port plan

Already used by earlier deployments (avoid): **3333, 3001, 8081, 5006, 5000**.
In tardis prod, container ports are **not** host-published — Traefik reaches them on the
internal `web` network (frontend `:80`, backend `:3000`). So prod has **no host port
collision**. Host ports only matter for **local dev**.

| Purpose | Tardis | **Statok (proposed, collision-free)** |
| --- | --- | --- |
| Dev Postgres (host) | `5433` | **`5434`** |
| Dev backend (host) | `3000` | **`3100`** |
| Dev frontend / Vite (host) | `5173` | **`5273`** |
| Prod frontend (container, internal) | `80` | `80` (Traefik label `:80`) |
| Prod backend (container, internal) | `3000` | `3000` (Traefik label `:3000`) |

None of 5434 / 3100 / 5273 collide with 3333/3001/8081/5006/5000.

---

## 3. Repo directory structure

```
statok/
  package.json                 # root: name, version (single source of truth), release:* scripts
  docker-compose.dev.yml       # Postgres-only for local dev  (port 5434:5432)
  deploy.sh                    # manual redeploy / rollback helper
  .dockerignore
  .gitignore
  README.md                    # Quick Start (mirror tardis README)
  CICD.md                      # release + deploy docs
  ARCHITECTURE.md
  CLAUDE.md                    # project rules (icons set, MCP if any)
  scripts/
    release.mjs                # bump root+frontend+backend package.json, tag vX.Y.Z, push
  packages/
    shared/                    # shared TS types (money, currency, dto) used by both sides
  backend/
    Dockerfile                 # FROM oven/bun:1.2-alpine
    package.json               # name "statok-backend", scripts: dev/start/db:generate/db:migrate
    bun.lock
    drizzle.config.ts
    .env.dev                   # committed dummy dev secrets
    .env                       # gitignored real secrets (also lives on VPS)
    drizzle/                   # generated SQL migrations (0000_*.sql ...) + meta/
    src/
      index.ts                 # Hono app; runMigrations() + seedAdmin() on boot
      db/{index.ts,schema.ts,migrate.ts}
      routes/{auth,health,accounts,holdings,transactions,prices,fx,...}.ts
      services/                # portfolio valuation, P/L, allocation
      jobs/{syncPrices.ts,syncFxRates.ts}
      lib/{crypto,logger,version,seed}.ts
      middleware/
  frontend/
    Dockerfile                 # node:20-alpine build → nginx:stable-alpine
    nginx.conf                 # SPA try_files fallback + gzip
    package.json               # name "statok-ui"
    vite.config.ts             # __APP_VERSION__ define, @ alias
    index.html
    src/
  infra/
    README.md
    docker-compose.yml         # prod: frontend, backend, postgres (Traefik labels)
  .github/
    workflows/{release.yml,build-backend.yml,build-frontend.yml,deploy.yml}
```

---

## 4. docker-compose

### 4a. Dev (`docker-compose.dev.yml`, repo root) — Postgres only

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: statok
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5434:5432"      # avoid tardis 5433 + reserved ports
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

`backend/.env.dev` (committed):
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/statok
JWT_SECRET=dev-secret-change-me
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
BASE_CURRENCY=USD
```

### 4b. Prod (`infra/docker-compose.yml`) — mirrors tardis, drops openclaw

```yaml
services:
  frontend:
    image: ghcr.io/vitaliysimkin/statok/frontend:${STATOK_VERSION:-latest}
    networks: [web, default]
    labels:
      - traefik.enable=true
      - traefik.docker.network=web
      - traefik.http.routers.statok-web.rule=Host(`statok.simk.in.ua`)
      - traefik.http.routers.statok-web.entrypoints=websecure
      - traefik.http.routers.statok-web.tls.certresolver=le
      - traefik.http.services.statok-web.loadbalancer.server.port=80
    restart: unless-stopped

  backend:
    image: ghcr.io/vitaliysimkin/statok/backend:${STATOK_VERSION:-latest}
    env_file: .env
    environment:
      TZ: Europe/Kyiv
      APP_TZ: Europe/Kyiv
    networks: [web, default]
    labels:
      - traefik.enable=true
      - traefik.docker.network=web
      - traefik.http.routers.statok-api.rule=Host(`api.statok.simk.in.ua`)
      - traefik.http.routers.statok-api.entrypoints=websecure
      - traefik.http.routers.statok-api.tls.certresolver=le
      - traefik.http.routers.statok-api.service=statok-backend
      - traefik.http.routers.statok-app-paths.rule=Host(`statok.simk.in.ua`) && (PathPrefix(`/api`) || PathPrefix(`/auth`) || Path(`/health`))
      - traefik.http.routers.statok-app-paths.entrypoints=websecure
      - traefik.http.routers.statok-app-paths.tls.certresolver=le
      - traefik.http.routers.statok-app-paths.priority=100
      - traefik.http.routers.statok-app-paths.service=statok-backend
      - traefik.http.services.statok-backend.loadbalancer.server.port=3000
    depends_on:
      - postgres
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: statok
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: statok
    networks: [default]
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

networks:
  web:
    external: true     # the shared Traefik edge network (dakara repo)
  default: {}

volumes:
  postgres_data:
```

> Note: tardis mounts `/var/run/docker.sock` into the backend (for its openclaw container
> control) — **Statok does not need that**; omit it for a smaller attack surface.

### Prod `.env` (only on VPS, `/opt/statok/.env` — never in repo)
```
STATOK_VERSION=
DATABASE_URL=postgresql://statok:<pw>@postgres:5432/statok
JWT_SECRET=
ADMIN_USERNAME=
ADMIN_PASSWORD=
POSTGRES_PASSWORD=
BASE_CURRENCY=USD
# optional market-data / FX provider keys:
# ALPHAVANTAGE_API_KEY= / FINNHUB_API_KEY= / etc.
```

---

## 5. Dev workflow (copy of tardis README)

```sh
git clone <repo> && cd statok

# Postgres
docker compose -f docker-compose.dev.yml up -d

# Backend
cd backend && bun install
bun run --env-file .env.dev dev          # http://localhost:3100  (set PORT=3100)
# migrations + admin seed run automatically on boot

# Frontend (new terminal)
cd frontend && npm install
npm run dev                              # http://localhost:5273  (vite server.port)
```

Generate a new migration after editing `src/db/schema.ts`:
```sh
cd backend && bun run db:generate        # drizzle-kit writes drizzle/NNNN_*.sql
```
(They apply automatically next backend start; no manual `db:migrate` needed in normal flow.)

## 6. Deploy workflow (copy of tardis)

```
bun run release:patch        # bumps root+frontend+backend version, tags vX.Y.Z, pushes
  → build-backend.yml + build-frontend.yml push :X.Y.Z images to GHCR
  → deploy.yml waits for both builds, scp's infra/, SSHes to VPS,
    sed-updates STATOK_VERSION in /opt/statok/.env,
    docker compose pull && up -d --remove-orphans,
    polls https://api.statok.simk.in.ua/health for {status:"ok"},
    creates GitHub Release + Telegram notify
```
Manual redeploy / rollback: `./deploy.sh 0.3.1` (mirror of tardis `deploy.sh`).

One-time server bootstrap (same as tardis `server-setup.md` / `infra/README.md`):
1. DNS A-records `statok.simk.in.ua` + `api.statok.simk.in.ua` → VPS IP.
2. Ensure the **external `web` Traefik network** + `le` certresolver exist (shared dakara edge — already running for tardis; Statok just joins it).
3. Create `/opt/statok/.env` with the keys above.
4. First `release:patch` deploys.

GitHub secrets needed (same set as tardis): `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`,
`RELEASE_TOKEN` (fine-grained PAT, so the tag push triggers downstream workflows),
optionally `TELEGRAM_BOT_TOKEN` + a chat-id secret for notifications.

---

## 7. Decisions to confirm

1. **flatlog is empty.** It is just a stub (`README.md` = "# flatlog", one commit), so it
   provides **zero** deployment conventions. This blueprint follows **tardis only**.
   Confirm that's the intended template (or point me at the real flatlog if it lives elsewhere).
2. **Frontend package manager mismatch in tardis:** backend uses **Bun** (`bun.lock`) but
   the frontend Dockerfile uses **npm** (`npm ci`, `package-lock.json`) even though a
   `bun.lock` is also present. Pick one for Statok's frontend — recommend **npm** to match
   the working tardis frontend Dockerfile, or standardize on Bun everywhere.
3. **Shared Traefik edge vs bundled nginx:** tardis migrated from a bundled-nginx +
   certbot setup to a separate Traefik "dakara" repo (2026-05-17). Blueprint assumes
   Statok joins the **same external Traefik `web` network**. Confirm dakara is the current
   edge and Statok should attach to it (vs standing up its own).
4. **VPS placement:** deploy Statok to the **same Hetzner VPS** as tardis
   (`/opt/statok/`), or a separate host? Same host = reuse Traefik + zero new infra.
5. **Market-data / FX provider:** which API for quotes (stocks/ETF/crypto) and FX rates?
   This drives the `jobs/` + secret keys. Not present in tardis (Statok-specific).
6. **Money storage type:** integer minor-units vs Postgres `numeric` for amounts — pick
   before writing `schema.ts` (recommend integer minor-units + ISO currency code).
7. **Telegram notify:** reuse tardis's bot/chat for deploy notifications, or skip?
