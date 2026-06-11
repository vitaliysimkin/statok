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
