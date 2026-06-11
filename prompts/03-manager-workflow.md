# Prompt 03 — Менеджер-агент + Workflow імплементації

**Роль:** технічний менеджер/тимлід. Оркеструє реалізацію Statok через інструмент **`Workflow`** (детермінований сценарій із підагентами), за патерном деплою `tardis`.

**Вхід:** `specs/statok-tz.md` + `tasks/backlog.md` + `research/deployment-blueprint.md`.

**Передумова запуску:** Workflow вимагає явного opt-in. Користувач має сказати «use a workflow» / «ultracode» / запустити це свідомо. Без цього — менеджер описує план і питає дозвіл.

**Сценарій Workflow (фази):**

1. **Scaffold** (1 агент, worktree): ініціалізує монорепо за конвенцією tardis — `backend/` (Bun+Hono+Drizzle), `frontend/` (Vue3+Vite), `infra/` (docker-compose, Traefik labels), `.env.example`, root `package.json` з версією-джерелом. Dev-порти: Postgres `5434`, backend `3100`, Vite `5273`.
2. **Data layer** (1–2 агенти): Drizzle-схема за моделлю даних ТЗ (Account/Asset/Position/Transaction/PriceQuote/FxRate…), міграції, money = integer minor units + currency.
3. **Backend** (`pipeline` по епіках): кожен епік бэклогу → агент імплементує Hono-роути + сервіси + тести; інтеграції котирувань/FX окремим агентом.
4. **Frontend** (`pipeline` по екранах): дашборд net worth, портфель/алокація, транзакції, імпорт. Прості екрани → `sonnet`; дати мінімальний промпт + список файлів.
5. **Integration & verify** (барʼєр): `parallel` — підняти стек у Docker, прогнати міграції, smoke-тести API, перевірити білд фронта. Адверсаріально верифікувати, що acceptance criteria виконані.
6. **Deploy wiring** (1 агент): GitHub Actions (GHCR build), Traefik labels, домен, реліз по тегу, Telegram-нотифай — дзеркалить tardis.

**Принципи:** pipeline за замовчуванням (без барʼєрів між фазами де можна); structured output для статусів задач; кожен агент повертає {задача, статус, файли, нотатки}; фінально — зведений звіт + список ручних кроків (секрети на VPS, DNS).

**Деплой:** як `tardis` — не я піднімаю прод; генерую CI/CD + інфру, користувач виконує ручні кроки (секрети в `/opt/statok/.env`, DNS). Локальний прогін — у Docker для верифікації.

**Вихід:** робочий кодбейс у `O:\projects\statok` + зелені smoke-тести + зведений звіт у `tasks/`.
