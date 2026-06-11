# Statok

Self-hosted застосунок для керування особистими фінансами.
Фокус: облік інвестицій / портфель (акції/ETF, крипта, облігації, депозити/готівка, мультивалюта), згодом — облік витрат і аналітика. Single-user, дані лишаються в межах власної інфраструктури.

> Назва: **статок** (укр.) — статок, чистий капітал, net worth.

## Що тут лежить

| Папка | Призначення |
|---|---|
| `research/` | Ресерч і аналіз: фінансовий скіл Anthropic, деплой-блюпринт із tardis |
| `specs/` | Вимоги, ТЗ, рішення (`*.decisions.md` → дистиляція у спеки) |
| `prompts/` | Промпти оркестрації пайплайну (вимоги → ТЗ → менеджер-агент) |
| `tasks/` | Задачі / трекінг |

## Пайплайн розробки (агентний)

1. **Вимоги** — `/design-decisions` (фінансова + продуктова рамка) → `specs/statok-requirements.decisions.md` (~28 питань) → дистиляція у `specs/requirements.md`.
2. **ТЗ** — `product-management:write-spec` перетворює відповіді у `specs/statok-tz.md` (PRD/ТЗ).
3. **Імплементація** — менеджер-агент через `Workflow` + підагенти реалізує по фазах.
4. **Деплой** — за патерном `tardis` (Bun/Hono/Drizzle/Postgres + Vue3/Vite/nginx, Traefik, Hetzner).

Промпти кожного кроку — у `prompts/`.

## Стек (попередньо, дзеркалить tardis)

- **Backend:** Bun + Hono + Drizzle ORM + PostgreSQL 16
- **Frontend:** Vue 3 + Vite + nginx
- **Деплой:** GHCR + GitHub Actions, Hetzner VPS за Traefik (`web` network), релізи по тегах
- **Dev-порти:** Postgres `5434`, backend `3100`, Vite `5273`

Деталі — `research/deployment-blueprint.md`. Фінальний стек фіксується після кроку «Вимоги».

## Монорепо

bun workspaces. Спільний код — `@statok/shared` (без build-степу, `main: src/index.ts`).

| Workspace | Пакет | Призначення |
|---|---|---|
| `packages/shared/` | `@statok/shared` | гроші (minor↔display, half-up), decimal (bigint fixed-point), enums, DTO |
| `backend/` | `statok-backend` | Bun + Hono + Drizzle + Postgres |
| `frontend/` | `statok-ui` | Vue 3 + Vite (Bun build) → nginx |

Єдине джерело версії — `version` у кореневому `package.json`.

## Quick Start (dev)

### 1. Підняти Postgres

```bash
docker compose -f docker-compose.dev.yml up -d
```

Postgres слухає на `localhost:5434`.

### 2. Запустити бекенд (порт 3100)

```bash
cp backend/.env.dev backend/.env   # або виставити env-змінні вручну
bun install                         # лінкує workspaces (@statok/shared)
bun run --cwd backend db:generate   # згенерувати SQL-міграції (потребує схеми ST-006+)
bun run --cwd backend dev           # hot-reload, слухає на :3100
```

Перевірка: `curl http://localhost:3100/health`

### 3. Запустити фронтенд (порт 5273, після ST-005)

```bash
bun run --cwd frontend dev
```

Vite слухає на `http://localhost:5273`.

Dev-порти: Postgres `5434`, backend `3100`, Vite `5273`.

> Зміна пароля адміна у v1 — лише вручну SQL або через зміну `ADMIN_PASSWORD` у `.env` і
> пересід (`DROP TABLE users; bun run db:migrate`). Сід не перезаписує наявного юзера.

## Документація

- `CLAUDE.md` — наскрізні інженерні правила для агентів.
- `ARCHITECTURE.md` — навігаційний огляд (канон — `specs/statok-tz.md` §7).
- `CICD.md` — релізи / деплой (заглушка до фази `deploy`).
