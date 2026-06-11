# CI/CD — Statok

> Стартова заглушка. Деталі деплою — `research/deployment-blueprint.md` і `specs/statok-tz.md`
> §7 (структура монорепо, ENV, безпека). GitHub Actions-воркфлоу й реліз-скрипт реалізуються
> у фазі `deploy` (див. `tasks/backlog.md`, епік деплою / ST-052).

## Версіонування та релізи

- Єдине джерело версії — `version` у кореневому `package.json`.
- `bun run release:patch | release:minor | release:major` → `scripts/release.mjs` (заглушка
  до ST-052): бампить версію root + backend + frontend, ставить git-тег `vX.Y.Z`, пушить.
- Білд-образів і деплой тригеряться тегом (патерн tardis).

## Заплановані воркфлоу (`.github/workflows/`)

| Воркфлоу | Тригер | Призначення |
|---|---|---|
| `release` | push tag `v*` | реліз / координація білдів |
| `build-backend` | tag / зміни backend | образ бекенда → GHCR |
| `build-frontend` | tag / зміни frontend | образ фронта (nginx) → GHCR |
| `deploy` | після білдів | викат на Hetzner VPS за Traefik |

## Образи

- **Backend:** `oven/bun:1.2-alpine` + `postgresql16-client` (для `pg_dump`-бекапу).
- **Frontend:** Bun-білд → `nginx:stable-alpine` (SPA fallback, gzip, security headers).
- Контекст білда фронта — корінь репо (`-f frontend/Dockerfile`), щоб у образ потрапив
  `packages/shared`.

## Dev

Локальний цикл — у `README.md` (Quick Start) і `docker-compose.dev.yml` (Postgres-only, ST-003).
