# CLAUDE.md — правила для агентів у репозиторії Statok

> Джерело істини по продукту й архітектурі — `specs/statok-tz.md` (розділ 7 — технічна
> архітектура). Задачі — `tasks/backlog.md` (`ST-NNN`). Цей файл фіксує наскрізні
> інженерні правила, які стосуються КОЖНОЇ задачі.

## Стек

- **Backend:** Bun 1.2 + Hono 4 + Drizzle ORM + `postgres` driver + PostgreSQL 16. Bun виконує
  TypeScript напряму (без build-степу). Runtime-залежності бекенда строго обмежені
  (`hono ^4`, `drizzle-orm ^0.44`, `drizzle-kit ^0.31`, `postgres ^3.4`, `jose ^6`,
  `bcryptjs ^2.4`) — нічого іншого не додавати без перегляду ТЗ §0.
- **Frontend:** Vue 3 + Vite + TypeScript, збірка Bun. nginx як static-сервер у проді.
- **Monorepo:** bun workspaces `["backend", "frontend", "packages/*"]`. Спільний код —
  `@statok/shared` (без build-степу, `main: src/index.ts`).

## Наскрізні правила (ОБОВ'ЯЗКОВІ)

### Гроші — лише через `@statok/shared`, без float (CRR-3)

- Жодних обчислень над грошима/кількостями/курсами через `number` з плаваючою комою.
- Уся грошова та decimal-арифметика — ТІЛЬКИ через хелпери `@statok/shared`
  (`money.ts`, `decimal.ts`): bigint fixed-point, округлення half-up до minor unit
  на межі `numeric → minor`.
- Фіатні суми зберігаються як `*Minor` (ціле число minor units, копійки/центи) + ISO-код
  валюти (`char(3)`). У JS суми `*Minor` — `number`; numeric-величини (`quantity`, `price`,
  `rate`) подорожують як **string** (drizzle default для numeric).
- Форматування чисел/валют у UI — ТІЛЬКИ через `formatMoney` з `@statok/shared`
  (`Intl.NumberFormat`), не через i18n number-formats.

### Frontend UI

- **UI-кіт:** `@vitaliysimkin/t-components`. Власні дублікати компонентів кіту не плодити.
- **Іконки:** ТІЛЬКИ `system-uicons`. Жодних інших icon-паків / SVG-наборів.
- **Тема:** `applyTheme('light'|'dark'|'auto')` на CSS variables (патерн tardis `useTheme`);
  'auto' слідує `prefers-color-scheme`. Кольори графіків (uPlot) тягнути з CSS-змінних теми.
- **Стан:** composables + модульні `ref` (без Pinia). HTTP — `src/services/api.ts` (`apiFetch`
  з Bearer-токеном із localStorage, 401 → редірект на `/login`).
- **i18n:** vue-i18n, `locale: 'uk'`, `fallbackLocale: 'en'`; усі рядки локалізовані (uk/en).

### Backend

- Усі ендпоінти, крім `POST /auth/login`, `POST /auth/google` і `GET /health`, — під `authMiddleware` (Bearer JWT) — CRR-1.
- Формат помилки: `{ "error": "MACHINE_CODE", "message": "human readable" }` — CRR-2.
- Усі доменні таблиці мають `user_id` (single-user, але uniform-схема) — CRR-5.
- Час: timestamp-колонки — `timestamptz`; «бізнес-дата» (котирування/курси/снапшоти) — `date`
  у TZ `Europe/Kyiv`.
- Валюти — ISO-4217 коди (`char(3)`) — CRR-4.
- Жодних вихідних HTTP-викликів, крім Yahoo (`query1/query2.finance.yahoo.com`),
  Frankfurter (`frankfurter.dev`/`frankfurter.app`), НБУ (`bank.gov.ua`),
  Google JWKS (`www.googleapis.com`, бекенд, `POST /auth/google`) — NFR-01.
  Фронтенд додатково звертається до `accounts.google.com` (GIS-скрипт, лише сторінка логіну).

### Адаптив

- Усі екрани адаптивні від 360px (одна колонка, без горизонтального скролу) — CRR-7.

## Версія

- Єдине джерело версії — `version` у кореневому `package.json`. Реліз-скрипт
  (`scripts/release.mjs`, заглушка до ST-052) синхронізує версії backend/frontend і ставить тег.
