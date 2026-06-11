# Architecture — Statok

> Стартова заглушка. Канонічне джерело архітектури — `specs/statok-tz.md`, **розділ 7**
> (модель даних, REST API, доменні сервіси, фонові джоби, структура монорепо, фронтенд,
> ENV і безпека). Цей файл — короткий навігаційний огляд; деталі не дублюємо.

## Огляд

Statok — self-hosted single-user трекер особистого капіталу (net worth) з фокусом на
інвестиційному портфелі (акції/ETF, крипта, облігації, депозити/готівка, мультивалюта).

## Монорепо

```
statok/
  packages/shared/   # @statok/shared — гроші, decimal, enums, DTO (без build-степу)
  backend/           # Bun + Hono + Drizzle + Postgres
  frontend/          # Vue 3 + Vite (Bun build) → nginx
  infra/             # prod docker-compose, restore-процедура
  scripts/           # release.mjs, backup.sh
```

bun workspaces `["backend", "frontend", "packages/*"]`. `@statok/shared` лінкується через
`workspace:*`, споживається і бекендом (виконує TS напряму), і фронтом (збирає Vite).

## Шари

- **Дані** — Postgres / Drizzle (`backend/src/db/schema.ts`). Позиції — похідні (fold по
  транзакціях), єдина матеріалізована похідна — `net_worth_snapshots` (ТЗ §7.1, §7.0).
- **API** — Hono REST: `/health`, `/auth` без префікса, решта під `/api/*` (ТЗ §7.2).
- **Домен** — сервіси `valuation`, `pnl`, `bond`, `fx`, `snapshot`, `cashAssets` (ТЗ §7.3).
- **Джоби** — in-process таймери (патерн tardis): EOD-пайплайн, sync цін/курсів,
  авто-погашення облігацій, денний снапшот (ТЗ §7.4).
- **Спільне** — `@statok/shared`: bigint fixed-point гроші/decimal, enums-дзеркало pgEnum,
  DTO-типи (ТЗ §7.6).

## Ключові принципи

- Гроші — bigint minor units + ISO-валюта; уся арифметика через `@statok/shared`, без float.
- Округлення — half-up до minor unit на межі `numeric → minor`.
- Час — `timestamptz`; бізнес-дата — `date` у TZ `Europe/Kyiv`.
- Приватність — вичерпний allowlist вихідних викликів (Yahoo / Frankfurter / НБУ).

> Повні таблиці, CHECK-матриця транзакцій, алгоритм valuation-fold, bond YTM, fx fallback
> з pivot через USD — у `specs/statok-tz.md` §7.
