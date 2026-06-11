# Statok — Імплементаційний бэклог (Фаза 1)

> Плаский список епіків і задач `ST-NNN` для автономної імплементації менеджер-агентом
> (`prompts/03-manager-workflow.md`). Джерело істини — `specs/statok-tz.md` (FR-NN у §4–6,
> архітектура у §7). Епіки відповідають MVP-cut фазам ТЗ §3.
>
> **Конвенція посилань:** `§N`, `§N.M`, `arch §N` означають підрозділ **розділу 7** ТЗ
> (технічна архітектура). `FR-NN` — функціональні вимоги §4–6. `CRR-N` — наскрізні правила (§4).
> `NFR-NN` — нефункціональні вимоги §5.
>
> **Фази:** `scaffold | data | backend | frontend | verify | deploy`.
> **Моделі:** `sonnet` — прості CRUD-екрани/форми/i18n/конфіг; `opus` — складна доменна логіка
> (valuation fold, bond YTM, fx fallback з pivot, транзакційна CHECK-матриця, реплей кількості,
> джоби, EOD-пайплайн).
>
> **Наскрізні правила (стосуються КОЖНОЇ задачі, далі в AC не повторюються окрім явної перевірки):**
> CRR-1 auth-gate, CRR-2 формат помилок, CRR-3 гроші без float, CRR-4 ISO-валюти,
> CRR-5 single-user (`user_id`), CRR-6 i18n, CRR-7 адаптив від 360px.

---

## Епік A — Scaffold (монорепо, кістяки) · фаза `scaffold`

### ST-001 — Ініціалізувати монорепо й workspaces
**Опис.** Створити корінь монорепо за blueprint: root `package.json` (єдине джерело версії), bun-workspaces `[backend, frontend, packages/*]`, базові dotfiles і документація-заглушки.
**Файли.** `package.json`, `.gitignore`, `.dockerignore`, `README.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `CICD.md`, `bun.lock` (root).
**Залежності.** —
**Acceptance criteria.**
- [ ] root `package.json` має `version` (єдине джерело), `"workspaces": ["backend","frontend","packages/*"]`, `scripts.release:*` (заглушки до ST-052) — arch §6.
- [ ] `bun install` у корені лінкує workspaces без помилок — arch §6.
- [ ] `CLAUDE.md` фіксує правило іконок `system-uicons` і UI-кіт `@vitaliysimkin/t-components` — arch §7.3.
- [ ] `.gitignore` ховає `backend/.env`, `node_modules`, `dist`, `*.dump` — arch §8.2, §9.
**Фаза.** `scaffold` · **Модель.** `sonnet`

### ST-002 — Створити пакет `@statok/shared` (гроші, decimal, dto, enums)
**Опис.** Кістяк shared-пакета без build-степу (як tardis): money-хелпери (Intl-форматування, minor↔display, round half-up), decimal bigint fixed-point (qty/price/cost basis), enums-дзеркало pgEnum, типи DTO. Це фундамент CRR-3.
**Файли.** `packages/shared/package.json`, `packages/shared/src/index.ts`, `packages/shared/src/money.ts`, `packages/shared/src/decimal.ts`, `packages/shared/src/enums.ts`, `packages/shared/src/dto.ts`.
**Залежності.** ST-001
**Acceptance criteria.**
- [ ] `money.ts`: `minorToDisplay`, `displayToMinor`, `formatMoney(minor, ccy, locale)` через `Intl.NumberFormat`, `MINOR_DIGITS` (деф. 2), `roundHalfUp` — arch §6, CRR-3.
- [ ] `decimal.ts`: `parseDec(str, scale)`, `mulToMinor(qty, price, ccy)`, `proportionMinor(totalMinor, part, whole)` — bigint fixed-point, без float — arch §6, CRR-3.
- [ ] округлення half-up до minor unit на межі numeric→minor — CRR-3, arch §0.
- [ ] `enums.ts` дзеркалить `assetType/transactionType/accountKind/priceSource/fxSource` — arch §1.1.
- [ ] `dto.ts` містить типи Account/Asset/Transaction/Position/BondDetails/FxRate/Snapshot — arch §6.
- [ ] `main: src/index.ts`, без build-степу; імпортується і бекендом, і фронтом — arch §6.
**Фаза.** `scaffold` · **Модель.** `opus`

### ST-003 — Підняти dev-інфру: `docker-compose.dev.yml` + env-приклади
**Опис.** Postgres-only dev-compose на порту 5434, committed `.env.dev` із дамі-секретами, описати dev-flow у README.
**Файли.** `docker-compose.dev.yml`, `backend/.env.dev`, `README.md` (секція Quick Start).
**Залежності.** ST-001
**Acceptance criteria.**
- [ ] `docker-compose.dev.yml` піднімає лише `postgres:16-alpine`, `5434:5432`, том `pgdata` — blueprint §4a.
- [ ] `backend/.env.dev` (committed) містить `DATABASE_URL` (5434), `JWT_SECRET` (≥32 chars), `ADMIN_*`, `BASE_CURRENCY=USD`, `PORT=3100`, `TZ=Europe/Kyiv`, `CORS_ORIGINS=http://localhost:5273` — arch §8.1.
- [ ] README документує: підняти Postgres, `bun run dev` (3100), Vite (5273), `db:generate` — blueprint §5.
**Фаза.** `scaffold` · **Модель.** `sonnet`

### ST-004 — Кістяк бекенда (Hono app + db connection + drizzle config)
**Опис.** Мінімальний Hono-застосунок: `index.ts` з `onError`/cors/secureHeaders і маунт-структурою (`/health`, `/auth`, `/api/*`), підключення Postgres-драйвера, drizzle config, `version.ts`, logger. Роути-заглушки, реальна логіка — у пізніших задачах.
**Файли.** `backend/package.json`, `backend/drizzle.config.ts`, `backend/src/index.ts`, `backend/src/db/index.ts`, `backend/src/lib/version.ts`, `backend/src/lib/logger.ts`.
**Залежності.** ST-002, ST-003
**Acceptance criteria.**
- [ ] `backend/package.json` `"statok-backend"`, deps лише `hono ^4`, `drizzle-orm ^0.44`, `drizzle-kit ^0.31`, `postgres ^3.4`, `jose ^6`, `bcryptjs ^2.4`, `@statok/shared: workspace:*` — arch §0.
- [ ] scripts `dev`/`start`/`db:generate`/`db:migrate` — arch §6.
- [ ] `index.ts`: глобальний `onError` → `{error, message}` формат, `hono/cors` (allowlist із `CORS_ORIGINS`), `hono/secure-headers`, маунт `/health`,`/auth`,`/api` — arch §2, §9, CRR-2.
- [ ] `db/index.ts` створює `postgres` connection із `DATABASE_URL`; drizzle обгортка — arch §0.
- [ ] стартує `bun run dev` на 3100; `GET /health` віддає `{status:"ok", db, version}` (заглушка БД ок до ST-006) — arch §2.
**Фаза.** `scaffold` · **Модель.** `sonnet`

### ST-005 — Кістяк фронтенда (Vite + Vue3 + router + i18n + api-клієнт)
**Опис.** Мінімальний Vue3+Vite+TS застосунок: vite.config (порт 5273, `__APP_VERSION__`, `@`-alias, заглушка PWA), router з guard на `statok_token`, vue-i18n каркас (uk/en), `api.ts` (apiFetch з Bearer, 401→/login), кореневий layout. Сторінки — заглушки до фронт-епіка.
**Файли.** `frontend/package.json`, `frontend/vite.config.ts`, `frontend/index.html`, `frontend/src/main.ts`, `frontend/src/App.vue`, `frontend/src/router/index.ts`, `frontend/src/services/api.ts`, `frontend/src/i18n/index.ts`, `frontend/src/locales/uk.json`, `frontend/src/locales/en.json`.
**Залежності.** ST-002, ST-003
**Acceptance criteria.**
- [ ] `frontend/package.json` `"statok-ui"`, deps `vue`, `vue-router`, `vue-i18n`, `uplot`, `@vitaliysimkin/t-components`, `@statok/shared: workspace:*`, dev `vite`+`vite-plugin-pwa` — arch §7, blueprint §2.
- [ ] `vite.config.ts`: `server.port=5273`, `define __APP_VERSION__`, `@`→`src`, `VitePWA` (повна конфігурація — у ST-049) — arch §6, §7.5.
- [ ] router `createWebHistory`, `beforeEach` перевіряє `statok_token`, всі роути `auth` крім `/login (meta.public)`, lazy-import — arch §7.1.
- [ ] `api.ts`: `apiFetch` із Bearer з localStorage, 401→чистка токена+редірект `/login`, `API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3100'` — arch §7.2.
- [ ] vue-i18n: `locale:'uk'`, `fallbackLocale:'en'`, локалі з localStorage — arch §7.3, CRR-6.
- [ ] `bun run dev` піднімає Vite на 5273 — blueprint §5.
**Фаза.** `scaffold` · **Модель.** `sonnet`

---

## Епік B — Data layer (схема, міграції, сід) · фаза `data`

### ST-006 — Drizzle-схема: enums, users, accounts, assets, bond_details
**Опис.** Описати першу частину схеми БД у `schema.ts`: усі pgEnum, таблиці users/accounts/assets/bond_details з усіма колонками, унікальностями і CHECK-ами (cash-symbol, bond freq/zero-coupon/face).
**Файли.** `backend/src/db/schema.ts` (частина 1).
**Залежності.** ST-004
**Acceptance criteria.**
- [ ] усі pgEnum: `asset_type`,`transaction_type`(12 значень),`account_kind`,`price_source`,`fx_source` — arch §1.1.
- [ ] `users` (uuid pk, username unique, password_hash) — arch §1.2.
- [ ] `accounts`: `kind` деф. `broker`, `sortOrder`, `archivedAt`, опційні `interestRatePercent numeric(8,4)?`/`termEndDate date?` (депозитні), unique `(userId,name)` — arch §1.3.
- [ ] `assets`: `symbol`,`currency char(3)`,`priceSource` деф. yahoo, unique `(userId,type,symbol)`, CHECK `type<>'cash' OR symbol=currency` — arch §1.4.
- [ ] `bond_details` (1:1, `assetId` pk → asset onDelete cascade): `faceValueMinor`,`couponRatePercent numeric(8,4)`,`couponFrequency smallint`,`issueDate?`,`maturityDate`,`isin?`; CHECK freq∈{0,1,2,4,12}, `(freq=0)=(rate=0)`, `face>0` — arch §1.5.
**Фаза.** `data` · **Модель.** `opus`

### ST-007 — Drizzle-схема: transactions (повна CHECK-матриця)
**Опис.** Описати центральну таблицю transactions з усіма полями (qty/price/amount/fee/gross/wht/net/transferGroupId/meta), індексами і повним набором CHECK-constraint-ів (amount≥0, qty>0, fee лише на trade, transfer-група, income-поля, trade-поля, унікальність transfer-пари).
**Файли.** `backend/src/db/schema.ts` (частина 2).
**Залежності.** ST-006
**Acceptance criteria.**
- [ ] усі колонки за arch §1.6 (`quantity numeric(38,18)`,`price numeric(20,8)`,`*Minor bigint number`,`meta jsonb`).
- [ ] індекси `(account,executedAt)`,`(asset,executedAt)`,`(user,executedAt)`,`(type)` — arch §1.6, NFR-03.
- [ ] `uniqueIndex tx_transfer_group_type_unique` (partial WHERE not null) — arch §1.6.
- [ ] CHECK-и: `amount_nonneg`, `qty_positive`, `fee_only_trade`, `transfer_group`, `income_fields` (`net=gross-wht`), `trade_fields` — arch §1.6.
**Фаза.** `data` · **Модель.** `opus`

### ST-008 — Drizzle-схема: price_quotes, fx_rates, net_worth_snapshots, app_settings
**Опис.** Описати решту таблиць: денні ціни (unique asset+date), курси (unique date+base+quote, індекс pair+date), снапшоти (unique user+date, breakdown jsonb), generic app_settings key-value.
**Файли.** `backend/src/db/schema.ts` (частина 3).
**Залежності.** ST-006
**Acceptance criteria.**
- [ ] `price_quotes`: unique `(assetId,quoteDate)`, `source price_source`, FK onDelete cascade — arch §1.7.
- [ ] `fx_rates`: unique `(rateDate,baseCcy,quoteCcy)`, index `(base,quote,date)`, `source fx_source` — arch §1.8.
- [ ] `net_worth_snapshots`: unique `(userId,snapshotDate)`, `baseCurrency`,`totalMinor`,`breakdown jsonb` — arch §1.9.
- [ ] `app_settings`: `key varchar(64) pk`, `value jsonb` — arch §1.10.
**Фаза.** `data` · **Модель.** `sonnet`

### ST-009 — Згенерувати міграції + автозастосування на старті + сід адміна
**Опис.** Згенерувати SQL-міграції з повної схеми, реалізувати `runMigrations()` (drizzle migrator) і `seedAdmin()` (bcrypt, не перезаписує наявного), провалідувати обовʼязкові env на старті (fatal exit). Підключити в boot-послідовність `index.ts`.
**Файли.** `backend/drizzle/0000_*.sql` (+meta), `backend/src/db/migrate.ts`, `backend/src/lib/seed.ts`, `backend/src/lib/password.ts`, `backend/src/index.ts` (boot wiring).
**Залежності.** ST-007, ST-008
**Acceptance criteria.**
- [ ] `db:generate` пише SQL у `backend/drizzle/`; `runMigrations()` застосовує їх на старті — arch §0, §6.
- [ ] `seedAdmin()`: порожня `users` → створює `username=ADMIN_USERNAME`, `bcrypt(ADMIN_PASSWORD,10)`; наявний username → НЕ перезаписує — **FR-01**, arch §1.2.
- [ ] зміна `ADMIN_PASSWORD`+рестарт не міняє пароль наявного юзера — **FR-01**.
- [ ] відсутній `JWT_SECRET`/`DATABASE_URL` (або `JWT_SECRET`<32 байт) на старті → fatal exit зі зрозумілим повідомленням — **FR-01**, arch §8.3, NFR-02.
- [ ] `BASE_CURRENCY` читається раз на старті, деф. USD — arch §8.3.
**Фаза.** `data` · **Модель.** `opus`

---

## Епік C — Автентифікація · фаза `backend`

### ST-010 — Auth: JWT-утиліти, middleware, rate-limit логіну
**Опис.** Реалізувати `jwt.ts` (jose HS256, claims sub/username/exp, TTL 7 діб), `authMiddleware` (Bearer→401), `requestContext` (userId з токена), in-memory rate-limit (5 спроб/15хв по `x-forwarded-for`).
**Файли.** `backend/src/lib/jwt.ts`, `backend/src/lib/rateLimit.ts`, `backend/src/middleware/auth.ts`, `backend/src/middleware/requestContext.ts`.
**Залежності.** ST-009
**Acceptance criteria.**
- [ ] `jwt.ts`: sign/verify jose HS256, claims `sub`,`username`,`exp`, TTL 7 діб — arch §9, **FR-02**.
- [ ] `authMiddleware`: без/невалідний/протермінований Bearer → 401 `UNAUTHORIZED`; валідний → `userId` у контекст — CRR-1, **FR-04**.
- [ ] `rateLimit.ts`: Map по ip, 5 невдалих/15хв → 429 `RATE_LIMITED`+`Retry-After`; успіх скидає лічильник; ковзне вікно — **FR-03**, arch §9.
**Фаза.** `backend` · **Модель.** `opus`

### ST-011 — Auth-роути: login / refresh / logout / me
**Опис.** Реалізувати `routes/auth.ts`: логін з перевіркою bcrypt і rate-limit, sliding refresh, logout (лог-запис), me. Логи без пароля/токена.
**Файли.** `backend/src/routes/auth.ts`.
**Залежності.** ST-010
**Acceptance criteria.**
- [ ] `POST /auth/login {username,password}` → 200 `{token,username}`; невірні креди → 401 з однаковим повідомленням; тіло без полів → 400 — **FR-02**.
- [ ] лог пише лише `username`+`ip`+reason; пароль/токен не логуються — **FR-02**, NFR-02.
- [ ] rate-limit застосовано ЛИШЕ до `/auth/login` (інші ендпоінти — ні) — **FR-03**.
- [ ] `POST /auth/refresh` (валідний Bearer) → новий токен TTL 7 діб; `GET /auth/me` → `{userId,username}`; `POST /auth/logout` → `{ok:true}`+лог — **FR-04**.
**Фаза.** `backend` · **Модель.** `sonnet`

---

## Епік D — Інвестиційне ядро: рахунки, активи, транзакції, оцінка · фаза `backend`

### ST-012 — Сервіс `cashAssets.ts` (ensureCashAsset)
**Опис.** Реалізувати автостворення cash-активів: `ensureCashAsset(userId, currency)` — ідемпотентно повертає/створює актив `type='cash'`, `symbol=currency`, `priceSource='manual'`, ціна тотожно 1. Використовується грошовими транзакціями.
**Файли.** `backend/src/services/cashAssets.ts`.
**Залежності.** ST-009
**Acceptance criteria.**
- [ ] `ensureCashAsset` створює cash-актив при першій транзакції валюти (`symbol=currency`,`name=код`,`priceSource='manual'`) — **FR-16**, arch §1.4.
- [ ] повторний виклик тієї ж валюти не дублює актив (ідемпотентність) — arch §1.4.
- [ ] невалідна (не ISO-4217) валюта → помилка валідації — CRR-4.
**Фаза.** `backend` · **Модель.** `sonnet`

### ST-013 — Сервіс `valuation.ts` (computePortfolioState — fold)
**Опис.** Серце домену: детермінований fold по транзакціях у позиції/кеш/realized із середньозваженою собівартістю та оцінкою за останнім котируванням (bond fallback=номінал). Реплей кількості (oversell-відсіч). Єдиний fold для positions/pnl/snapshot. Уся qty-арифметика — bigint fixed-point.
**Файли.** `backend/src/services/valuation.ts`.
**Залежності.** ST-012
**Acceptance criteria.**
- [ ] вибірка скоупу `user_id [+account_id] AND executed_at < atDate+1day(Kyiv)`, сорт `executedAt,createdAt,id` — arch §3.1 крок 1.
- [ ] обробка типів buy/sell/deposit/withdraw/transfer_in/out/dividend/coupon/interest/split/ticker_change/opening_balance за arch §3.1 крок 3; cost basis середньозважена, `costPart=roundHalfUp(costBasis×qty/qtyHeld)` — **FR-14, FR-15**.
- [ ] позиції з `qty==0` викидаються (realized лишається) — **FR-15**, arch §3.1 крок 4.
- [ ] оцінка: `lastPrice` = останнє `quote_date ≤ atDate`; bond без котирування → номінал; stock/etf/crypto без котирування → `valueMinor:null` (поза тоталами) — **FR-35**, arch §3.1 крок 5.
- [ ] `opening_balance(актив)` без amount → собівартість з останнього котирування; без котирувань → 0 + `costBasisIncomplete:true` — **FR-20**, arch §3.1.
- [ ] `unrealizedMinor=value−costBasis`, `avgCostMinor=roundHalfUp(costBasis/qty)`; уся qty-математика bigint fixed-point без float — **FR-35**, CRR-3.
- [ ] реплей: будь-яка точка з qty<0 виявляється (повертає конфлікт для записувачів); негативний кеш дозволений — **FR-15a**, arch §1.6.
**Фаза.** `backend` · **Модель.** `opus`

### ST-014 — Accounts CRUD + баланси
**Опис.** Реалізувати `routes/accounts.ts`: CRUD рахунків, мультивалютні кеш-залишки і `valueBaseMinor` (через valuation+fx), архівація, відсіч видалення рахунку з транзакціями.
**Файли.** `backend/src/routes/accounts.ts`.
**Залежності.** ST-013, ST-021 (fx-сервіс для `valueBaseMinor`)
**Acceptance criteria.**
- [ ] `POST` створює рахунок (`kind` деф. broker, опц. note); дубль імені → 409; порожній name/невалідний kind → 400 — **FR-05**.
- [ ] `GET ?withBalances=true&includeArchived=`: активні за замовч.; balances по валютах + `valueBaseMinor`; `valuationIncomplete:true` якщо є позиція без ціни; опційні `interestRatePercent`/`termEndDate` у відповіді; архівні лише з прапором; сорт `sortOrder,name` — **FR-06, FR-09**.
- [ ] кеш-залишки = сума грошових дельт валюти (знак коректний); негативний дозволений; нульовий з рухами = 0.00 — **FR-09**.
- [ ] `PUT`: часткове оновлення name/kind/note/sortOrder; перейменування на зайняте → 409; `archived` true/false; 404 для неіснуючого — **FR-07**.
- [ ] `DELETE`: без транзакцій → 204; з транзакціями → 409 `ACCOUNT_HAS_TRANSACTIONS` — **FR-08**.
**Фаза.** `backend` · **Модель.** `sonnet`

### ST-015 — Assets CRUD + bond_details (атомарно)
**Опис.** Реалізувати `routes/assets.ts` (CRUD): створення активу з атомарним bond-блоком (одна DB-транзакція), заборона ручного cash і зміни symbol через PUT, відсіч видалення активу з транзакціями, каскад price_quotes/bond_details.
**Файли.** `backend/src/routes/assets.ts` (CRUD-частина).
**Залежності.** ST-013
**Acceptance criteria.**
- [ ] `POST` створює stock/etf/bond/crypto; unique `(user,type,symbol)` дубль → 409; `priceSource` деф. yahoo (bond→manual); невалідна валюта → 400; ручний `type='cash'` → 400 — **FR-10**.
- [ ] `type='bond'` без `bond` → 400; `bond` для не-bond → 400; zero-coupon узгодженість → 400; asset+bond_details в одній DB-транзакції — **FR-11**.
- [ ] `GET ?type=&includeArchived=`, `GET /:id` повертає вкладений `bond` — **FR-11, FR-12**.
- [ ] `PUT` оновлює name/currency/priceSource/archived/bond; `symbol` через PUT ігнорується/400 — **FR-12**.
- [ ] `DELETE`: без транзакцій → 204 (каскад price_quotes+bond_details); з транзакціями → 409 `ASSET_HAS_TRANSACTIONS`; cash із посиланнями → 409 — **FR-13**.
**Фаза.** `backend` · **Модель.** `sonnet`

### ST-016 — Транзакції: запис core-типів + валідація матриці + реплей
**Опис.** Реалізувати `routes/transactions.ts` для `POST` (core: buy/sell/deposit/withdraw/dividend/coupon/interest/split/opening_balance) із повною сервісною валідацією матриці полів, CURRENCY_MISMATCH, резолвом cash-активу, реплеєм кількості (INSUFFICIENT_QUANTITY) і журналом `GET` із фільтрами/пагінацією.
**Файли.** `backend/src/routes/transactions.ts` (core-частина).
**Залежності.** ST-013
**Acceptance criteria.**
- [ ] `buy`: `amount=qty×price` (без fee) інакше 400; `currency=assets.currency` інакше 400 `CURRENCY_MISMATCH`; дробова qty до 18 знаків — **FR-14**.
- [ ] `sell`: реплей `(account,asset)` — продаж понад наявне → 409 `INSUFFICIENT_QUANTITY` із вказанням актив/рахунок/дата — **FR-15, FR-15a**.
- [ ] `deposit`/`withdraw` без `assetId` → `ensureCashAsset`; `amount≤0` → 400 — **FR-16**.
- [ ] `dividend`/`coupon`/`interest`: вимагає `gross`, wht опц. (деф. 0 для всіх трьох); сервер ОБЧИСЛЮЄ `net=gross−wht` (у body не приймається); тип-актив відповідність (dividend↔stock/etf, coupon↔bond, interest↔cash) інакше 400 — **FR-18**.
- [ ] `split`: множник; cash-актив → 400; reverse split дробовий множник; реплей не пускає qty<0 — **FR-19, FR-15a**.
- [ ] `opening_balance` (актив/кеш) за матрицею; не створює пар і не впливає на cashflow; кілька на (рахунок,актив) сумуються — **FR-20**.
- [ ] `GET ?accountId=&assetId=&type=&from=&to=&limit=&offset=`: сорт executedAt desc, фільтри AND, `{items,total}`, limit деф.50/макс.500, невалідний type/дата → 400 — **FR-21**.
**Фаза.** `backend` · **Модель.** `opus`

### ST-017 — Транзакції: переказ-пара + ticker-change + edit/delete з перерахунком
**Опис.** Реалізувати спец-ендпоінти: атомарна transfer-пара (спільний transferGroupId, незалежні ноги), ticker-change (інсерт+оновлення symbol атомарно), а також `PUT`/`DELETE` з перерахунком похідних і реплеєм (видалення ноги зносить пару, відкат symbol).
**Файли.** `backend/src/routes/transactions.ts` (transfer/ticker-change/edit/delete).
**Залежності.** ST-016
**Acceptance criteria.**
- [ ] `POST /api/transactions/transfer`: два рядки в одній DB-транзакції, спільний `transferGroupId`; ноги (валюта/сума) незалежні; `from==to` → 400; in-kind не підтримується — **FR-17**.
- [ ] `POST /api/transactions/ticker-change`: атомарно інсерт `meta{fromSymbol,toSymbol}` + оновлення `assets.symbol`; зайнятий symbol → 409; історія цін лишається на тому ж asset_id — **FR-19**.
- [ ] `PUT /:id`: оновлює поля того ж типу; зміна type → 400; редагування ноги синхронізує executedAt/note на обидві, сума/валюта пер-нога — **FR-17, FR-22**.
- [ ] правка/видалення, що порушує інваріант кількості → 409 `INSUFFICIENT_QUANTITY`, відкат — **FR-15a, FR-22**.
- [ ] `DELETE`: 204; видалення ноги зносить всю пару; видалення останнього ticker_change відкочує symbol; наступні positions/valuation/pnl віддають перераховане (fold щоразу); снапшоти НЕ перебудовуються авто — **FR-19, FR-22**.
**Фаза.** `backend` · **Модель.** `opus`

---

## Епік E — Облігаційний модуль (НАЙВИЩИЙ ПРІОРИТЕТ) · фаза `backend`

### ST-018 — Сервіс `bond.ts`: купонний розклад + YTM + поточна дохідність
**Опис.** Реалізувати генерацію купонного розкладу (від maturity назад, фінальний рядок погашення, zero-coupon, isFuture), поточну дохідність і YTM (Newton–Raphson із fallback-бісекцією, ACT/365F).
**Файли.** `backend/src/services/bond.ts` (schedule/currentYield/ytm).
**Залежності.** ST-009
**Acceptance criteria.**
- [ ] `couponSchedule`: крок `12/freq` міс. (лише freq>0) від maturity назад до issueDate (або найранішої tx; ліміт 50р); `amount=roundHalfUp(face×rate/100/freq)`; рядки `{date,amountMinor,isFuture,kind}` (`kind:'coupon'|'redemption'`); фінал — `kind:'redemption'` amount=faceValueMinor; zero-coupon → лише погашення — **FR-23, FR-24**.
- [ ] `currentYield=(faceValueMinor×couponRatePercent/100)/cleanPriceMinor` (ділення на 100 обовʼязкове); zero-coupon → 0 — **FR-27**.
- [ ] `ytm`: Newton–Raphson по рівнянню ціни (старт=current yield, ≤100 ітер, толеранс 1e-10), fallback бісекція `y∈[−0.9999,10]`; ACT/365F від settlement; повертає річний % (float ок — метрика) — **FR-27**, arch §3.3.
**Фаза.** `backend` · **Модель.** `opus`

### ST-019 — Сервіс `bond.ts`: автопогашення (processMaturedBonds)
**Опис.** Реалізувати ідемпотентне автопогашення: для bond із maturity≤today і qty>0 створити `sell` за номіналом з `meta.autoRedemption`. Викликається в EOD і ручному snapshots/run.
**Файли.** `backend/src/services/bond.ts` (processMaturedBonds).
**Залежності.** ST-018, ST-016
**Acceptance criteria.**
- [ ] для bond `maturity≤today` і qty>0: `sell` qty=весь залишок, price=faceValue, `amount=roundHalfUp(qty×face)`, fee 0, `executedAt=maturityDate 12:00 Kyiv`, `meta{autoRedemption:true}` — **FR-26**.
- [ ] кеш валюти зростає на суму погашення; позиція → 0 — **FR-26**.
- [ ] ідемпотентність: qty вже 0 → пропуск, без дублю — **FR-26**, NFR-04.
**Фаза.** `backend` · **Модель.** `opus`

### ST-020 — Bond-роути: schedule + metrics
**Опис.** Підключити bond-ендпоінти в `routes/assets.ts`: розклад (read-only) і метрики YTM/поточна дохідність із резолвом ціни (останнє котирування → fallback номінал) і вказанням priceSource/asOf.
**Файли.** `backend/src/routes/assets.ts` (bond endpoints).
**Залежності.** ST-018, ST-015
**Acceptance criteria.**
- [ ] `GET /api/assets/:id/bond/schedule` → `{items:[{date,amountMinor,isFuture,kind}], currency}` (`kind:'coupon'|'redemption'`); не-bond → 404 — **FR-23, FR-24**.
- [ ] `GET /api/assets/:id/bond/metrics?price=&date=` → `{ytmPercent,currentYieldPercent,priceUsed,priceBasis,asOf}` (`priceBasis:yahoo|manual|face`, `settlement=date` деф. сьогодні Kyiv); price деф.=останнє котирування, fallback номінал; не-bond → 404 — **FR-27**.
**Фаза.** `backend` · **Модель.** `sonnet`

---

## Епік F — Ціни і курси · фаза `backend`

### ST-021 — Сервіс `fx.ts`: convert із fallback (прямий/зворотний/pivot)
**Опис.** Реалізувати конвертацію валют через bigint fixed-point: identity, resolveRate (прямий «останній попередній» → зворотний 1/rate → pivot через USD один рівень), FX_RATE_NOT_FOUND. Усі звіти конвертуються цим сервісом.
**Файли.** `backend/src/services/fx.ts`.
**Залежності.** ST-009
**Acceptance criteria.**
- [ ] `from===to` → identity без курсу — **FR-33**.
- [ ] resolveRate: прямий рядок max `rate_date≤date` (fallback «останній попередній»); інакше зворотний `1/rate`; інакше pivot через USD (один рівень) — **FR-33**, arch §3.4.
- [ ] жодного курсу → `FX_RATE_NOT_FOUND` — **FR-33**.
- [ ] множення через bigint fixed-point (rate scale 8), round half-up, без float; manual-курси нарівні — **FR-33**, CRR-3.
**Фаза.** `backend` · **Модель.** `opus`

### ST-022 — Хелпери джоб: withRetry + scheduleDaily
**Опис.** Реалізувати інфраструктуру джоб (патерн tardis): `withRetry` (3 спроби 1s/4s/16s+джиттер), `scheduleDailyAt(hhmm,tz,fn)` (DST-safe перерахунок через Intl). Основа для EOD-пайплайна і NFR-04.
**Файли.** `backend/src/lib/retry.ts`, `backend/src/lib/scheduleDaily.ts`.
**Залежності.** ST-004
**Acceptance criteria.**
- [ ] `withRetry(fn,{attempts:3,baseDelayMs:1000,factor:4})` → паузи 1s/4s/16s+джиттер ±20%; фінальний фейл прокидає виняток — **NFR-04**, arch §4.
- [ ] `scheduleDailyAt(hhmm,'Europe/Kyiv',fn)`: мс до наступного hhmm у TZ через Intl, після виконання переобчислює (DST-safe) — arch §4.
**Фаза.** `backend` · **Модель.** `opus`

### ST-023 — Джоба `syncPrices.ts` (Yahoo chart API)
**Опис.** Реалізувати денний автозбір цін: Yahoo chart (range 7d) для stock/etf/crypto+yahoo+не-архів, парсинг (TZ біржі, null-skip), upsert із недоторканими manual-рядками, fallback-хост query2, User-Agent, пауза 500мс, стан у app_settings.
**Файли.** `backend/src/jobs/syncPrices.ts`.
**Залежності.** ST-022, ST-008
**Acceptance criteria.**
- [ ] скоуп `type IN(stock,etf,crypto) AND price_source='yahoo' AND archived_at IS NULL`; запит chart `interval=1d&range=7d`, header User-Agent, пауза 500мс, fallback query2 — **FR-28**, arch §4.1.
- [ ] парсинг: `meta.currency`, TZ біржі для `quote_date`, `close[i]` null-skip; crypto через пару — **FR-28**.
- [ ] upsert один рядок на (asset,date) `source='yahoo'` `ON CONFLICT ... WHERE source<>'manual'` (manual недоторканні) — **FR-28, FR-29**, arch §1.7.
- [ ] помилка символу логується, решта триває; підсумок `okCount/errCount`; стан → `app_settings['job.prices']` — **FR-28**, NFR-04.
**Фаза.** `backend` · **Модель.** `opus`

### ST-024 — Джоба `syncFxRates.ts` (Frankfurter + НБУ)
**Опис.** Реалізувати дві незалежні гілки автозбору курсів: Frankfurter (USD-база, fallback-хост) і НБУ (UAH), нормалізоване збереження, фейл однієї не блокує іншу, стан у app_settings.
**Файли.** `backend/src/jobs/syncFxRates.ts`.
**Залежності.** ST-022, ST-008
**Acceptance criteria.**
- [ ] `needed = distinct(assets.currency) ∪ {BASE_CURRENCY,UAH,USD,EUR}` — **FR-32**.
- [ ] Frankfurter (base USD, symbols=needed−USD/UAH; fallback-хост frankfurter.app) → upsert `(USD,ccy,rate,'frankfurter')`; вихідні → дата пʼятниці — **FR-32**, arch §4.2.
- [ ] НБУ JSON → фільтр `cc∈needed`, `exchangedate dd.MM.yyyy`, upsert `(cc,UAH,rate,'nbu')` — **FR-32**.
- [ ] фейл однієї гілки не блокує іншу; upsert один рядок на (date,base,quote) не перетирає manual; стан → `app_settings['job.fx']` — **FR-32, FR-34**, NFR-04.
**Фаза.** `backend` · **Модель.** `opus`

### ST-025 — Prices-роути (історія, ручне редагування, ручний sync)
**Опис.** Реалізувати `routes/prices.ts`: історія за діапазоном (з source), ручний upsert/delete ціни (manual-флаг), синхронний ручний тригер sync.
**Файли.** `backend/src/routes/prices.ts`.
**Залежності.** ST-023
**Acceptance criteria.**
- [ ] `GET /api/prices?assetId=&from=&to=` → історія з `source`; відсутність → порожній список — **FR-31**.
- [ ] `PUT /api/prices/:assetId/:date {price}` → upsert `source='manual'`; від'ємна/невалідна ціна → 400; для bond — clean price за 1 папір; `DELETE` → 204 — **FR-29**.
- [ ] `POST /api/prices/sync {assetId?}` синхронно → `{okCount,errCount,errors}`; manual не зачіпає — **FR-30**.
**Фаза.** `backend` · **Модель.** `sonnet`

### ST-026 — Fx-роути (історія, convert, ручне редагування, ручний sync)
**Опис.** Реалізувати `routes/fx.ts`: історія курсів (з source), convert (з rateUsed/rateDate і fallback), ручний upsert курсу (manual), синхронний ручний sync обох гілок.
**Файли.** `backend/src/routes/fx.ts`.
**Залежності.** ST-021, ST-024
**Acceptance criteria.**
- [ ] `GET /api/fx?base=&quote=&from=&to=` → історія з `source`; НБУ-історія зберігається в БД — **FR-34**.
- [ ] `GET /api/fx/convert?amountMinor=&from=&to=&date=` → `{amountMinor,from,to,rateUsed,rateDate}` (rateDate≤date — видно fallback); немає курсу → 404 `FX_RATE_NOT_FOUND` — **FR-33**.
- [ ] `PUT /api/fx/:date/:base/:quote {rate}` → upsert `source='manual'` (нарівні в резолвингу); `POST /api/fx/sync` → `{frankfurter:{ok,ratesUpserted},nbu:{ok,ratesUpserted}}` — **FR-34**.
**Фаза.** `backend` · **Модель.** `sonnet`

---

## Епік G — Оцінка, P&L, снапшоти · фаза `backend`

### ST-027 — Сервіс `pnl.ts` + portfolio-роути (positions, valuation, pnl)
**Опис.** Реалізувати `pnl.ts` (realized trading за період, income за типами, fees, unrealized, perAsset) і `routes/portfolio.ts` (positions з оцінкою+cash, valuation з розрізами byClass/byAccount/byCurrency, pnl). Усе в базовій валюті через fx.
**Файли.** `backend/src/services/pnl.ts`, `backend/src/routes/portfolio.ts`.
**Залежності.** ST-013, ST-021
**Acceptance criteria.**
- [ ] `GET /positions?accountId=&date=`: поля qty/costBasis/avgCost/lastPrice/priceDate/value/valueBase/unrealized(+Base)/unrealizedPct; bond fallback номінал; qty=0 приховані; блок `cash`; `unrealizedPct=unrealized/costBasis` — **FR-35, FR-38**.
- [ ] `GET /valuation?date=`: `totalBaseMinor`+`byClass`/`byAccount`/`byCurrency` (усе в базовій, формат = breakdown снапшота); деф. сьогодні Kyiv; немає курсу → 404 `FX_RATE_NOT_FOUND` — **FR-36**.
- [ ] `GET /pnl?accountId=&from=&to=`: realizedTrading (sell∈[from,to], курс дати sell), income (net по dividend/coupon/interest, курс дати), fees (довідково), unrealized (поточний), `total=realized+income+unrealized`, `perAsset` — **FR-37, FR-38**.
- [ ] всі тотали конвертовані в `BASE_CURRENCY`; XIRR/TWR поза скоупом — **FR-38**, arch §3.2.
**Фаза.** `backend` · **Модель.** `opus`

### ST-028 — Сервіс `snapshot.ts` + snapshots-роути (run/rebuild/history)
**Опис.** Реалізувати `snapshot.ts` (runSnapshot=стан+оцінка+агрегати→upsert; rebuild=цикл діапазону) і `routes/snapshots.ts` (run, rebuild, history). Перерахунок зі збереженої історії цін/курсів.
**Файли.** `backend/src/services/snapshot.ts`, `backend/src/routes/snapshots.ts`.
**Залежності.** ST-027
**Acceptance criteria.**
- [ ] `runSnapshot(date)`: `computePortfolioState`+оцінка → агрегати byAccount/byClass/byCurrency (базова) → upsert `(userId,snapshotDate)` — **FR-39, FR-40**, arch §3.5.
- [ ] `POST /api/snapshots/run {date?}` (деф. сьогодні Kyiv) → `{snapshot}` upsert — **FR-40**.
- [ ] `POST /api/snapshots/rebuild {from,to}` послідовно → `{count}` зі збереженої історії — **FR-40**.
- [ ] `GET /api/snapshots?from=&to=` → `{items}` з total/baseCurrency/breakdown; дні без снапшота просто відсутні — **FR-41**.
**Фаза.** `backend` · **Модель.** `opus`

### ST-029 — EOD-пайплайн + boot catch-up + index.ts wiring
**Опис.** Зібрати `runEodPipeline` (syncPrices→syncFxRates→processMaturedBonds→dailySnapshot, послідовно, помилка кроку не валить решту), розклад 23:30 Kyiv, boot catch-up (lastSuccessDate старіша за вчора → запуск через 60с), guard `running`. Підключити в boot.
**Файли.** `backend/src/jobs/eodPipeline.ts`, `backend/src/jobs/dailySnapshot.ts`, `backend/src/index.ts` (jobs wiring).
**Залежності.** ST-023, ST-024, ST-019, ST-028
**Acceptance criteria.**
- [ ] `runEodPipeline`: послідовно prices→fx→matured→snapshot; помилка кроку логується, наступні виконуються; снапшот з наявних даних — **FR-39**, arch §4, NFR-04.
- [ ] `dailySnapshot` → `runSnapshot(todayKyiv)`; успіх → `app_settings['eod.lastSuccessDate']=today` — **FR-39**.
- [ ] розклад `scheduleDailyAt('23:30','Europe/Kyiv', runEodPipeline)`; guard `running` від накладання — arch §4, NFR-04.
- [ ] boot catch-up: `eod.lastSuccessDate` старіша за вчора → одноразовий запуск ~60с після boot — **FR-39**, NFR-04.
**Фаза.** `backend` · **Модель.** `opus`

---

## Епік H — Дашборди, експорт, бекап, налаштування (backend) · фаза `backend`

### ST-030 — Dashboards-роути (networth-series + cashflow)
**Опис.** Реалізувати `routes/dashboards.ts`: серія net worth зі снапшотів (без інтерполяції) і cashflow по періодах (deposits/withdrawals/dividends/coupons/interest/fees/net, конвертація за датою кожної tx, transfer-пари виключені, groupBy).
**Файли.** `backend/src/routes/dashboards.ts`.
**Залежності.** ST-028
**Acceptance criteria.**
- [ ] `GET /api/dashboards/networth-series?from=&to=` → `{points:[{date,totalMinor}],baseCurrency}` зі снапшотів, без інтерполяції пропусків — **FR-42**.
- [ ] `GET /api/dashboards/cashflow?from=&to=&groupBy=month|quarter|year` → `{periods:[{period,depositsMinor,withdrawalsMinor,dividendsMinor,couponsMinor,interestMinor,feesMinor,netMinor}],baseCurrency}` — **FR-43**.
- [ ] кожна tx конвертується за курсом ЇЇ дати; компоненти — додатні модулі, `net=deposits−withdrawals+dividends+coupons+interest−fees`; transfer-пари ВИКЛЮЧЕНІ; groupBy перемикає агрегацію — **FR-43**, arch §2.
**Фаза.** `backend` · **Модель.** `opus`

### ST-031 — Export-роути (transactions.csv + positions.csv)
**Опис.** Реалізувати `routes/export.ts` + `lib/csv.ts`: CSV транзакцій і позицій (UTF-8+BOM, RFC 4180, екранування), суми в major units, фільтри.
**Файли.** `backend/src/routes/export.ts`, `backend/src/lib/csv.ts`.
**Залежності.** ST-016, ST-027
**Acceptance criteria.**
- [ ] `GET /api/export/transactions.csv?from=&to=&accountId=` → `text/csv; charset=utf-8`+BOM, RFC 4180, колонки `id,executed_at,account,asset_symbol,asset_type,type,quantity,price,currency,amount,fee,gross,withholding_tax,net,transfer_group_id,note` (major units); екранування коми/лапок/переносу — **FR-49**.
- [ ] `GET /api/export/positions.csv?date=` → колонки `account,asset_symbol,asset_type,currency,quantity,avg_cost,cost_basis,last_price,price_date,value,value_base,unrealized,unrealized_pct`; деф. сьогодні; той самий CSV-формат — **FR-50**.
**Фаза.** `backend` · **Модель.** `sonnet`

### ST-032 — Backup-роут (pg_dump stream)
**Опис.** Реалізувати `routes/backup.ts`: стрім `pg_dump -Fc` по DATABASE_URL без запису на диск, під auth, з attachment-заголовками; 500 при exit≠0. (pg_dump в образ — у deploy-епіку ST-047.)
**Файли.** `backend/src/routes/backup.ts`.
**Залежності.** ST-009
**Acceptance criteria.**
- [ ] `GET /api/backup/dump`: `Bun.spawn(['pg_dump','--format=custom',DATABASE_URL])`, stdout→body; `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="statok-YYYYMMDD-HHmm.dump"` — **FR-51**, arch §5.2.
- [ ] під auth; стрім без запису на диск; exit≠0 → 500 — **FR-51**, NFR-02.
**Фаза.** `backend` · **Модель.** `sonnet`

### ST-033 — Settings-роут (конфіг + стан джоб)
**Опис.** Реалізувати `routes/settings.ts`: read-only конфіг (baseCurrency, version) + стан джоб з app_settings, generic PUT по whitelist ключів.
**Файли.** `backend/src/routes/settings.ts`.
**Залежності.** ST-009
**Acceptance criteria.**
- [ ] `GET /api/settings` → `{baseCurrency,version,jobs:{prices,fx,snapshot:{lastRunAt,lastSuccessAt,lastStatus,lastError}}}` — **FR-54**.
- [ ] `baseCurrency` read-only; `PUT /api/settings/:key {value}` лише по whitelist (поза ним → 400) — **FR-54**, arch §8.3.
**Фаза.** `backend` · **Модель.** `sonnet`

### ST-034 — Перевірка приватності: вичерпний allowlist вихідних викликів
**Опис.** Аудит-задача: підтвердити, що рантайм бекенда не робить fetch до жодних хостів, крім Yahoo/Frankfurter/НБУ; CORS строгий; docker.sock не монтується. Зафіксувати у тесті/чеклисті NFR-01/02.
**Файли.** `backend/test/privacy.test.ts` (або lint-правило), `backend/src/index.ts` (cors review).
**Залежності.** ST-023, ST-024, ST-032
**Acceptance criteria.**
- [ ] жодних вихідних fetch поза `query1/query2.finance.yahoo.com`, `frankfurter.dev/.app`, `bank.gov.ua` — **NFR-01**.
- [ ] CORS строгий allowlist із `CORS_ORIGINS`, `credentials:false`; security headers активні — **NFR-02**, arch §9.
- [ ] `pg_dump`-ендпоінт лише під auth; docker.sock не монтується (перевірка compose) — **NFR-01, NFR-02**.
**Фаза.** `backend` · **Модель.** `sonnet`

---

## Епік I — Фронтенд: операційні екрани · фаза `frontend`

### ST-035 — Auth-shell: LoginPage + useAuth + guard-інтеграція
**Опис.** Реалізувати екран логіну, composable `useAuth` (login/refresh/logout, токен у localStorage), виклик refresh при старті, обробку 401.
**Файли.** `frontend/src/pages/LoginPage.vue`, `frontend/src/composables/useAuth.ts`.
**Залежності.** ST-005, ST-011
**Acceptance criteria.**
- [ ] LoginPage: форма username/password, помилка при 401, успіх → токен у `statok_token`+редірект `/dashboard` — **FR-02**.
- [ ] `useAuth` викликає `refresh` при старті (якщо токен є й не протух); logout чистить токен — **FR-04**.
- [ ] 401 на `/api/*` → чистка токена+редірект `/login` — **FR-04**, CRR-1.
**Фаза.** `frontend` · **Модель.** `sonnet`

### ST-036 — Composables даних (accounts, assets, transactions, portfolio, dashboards, fx, prices)
**Опис.** Реалізувати HTTP-composables (модульні ref + apiFetch) для всіх доменних ресурсів — спільний шар даних для екранів. Без Pinia.
**Файли.** `frontend/src/composables/{useAccounts,useAssets,useTransactions,usePortfolio,useDashboards,useFx,usePrices,useSettings}.ts`.
**Залежності.** ST-035, ST-014, ST-015, ST-016, ST-027, ST-030
**Acceptance criteria.**
- [ ] кожен composable обгортає відповідні ендпоінти через `apiFetch`; модульні `ref` (без Pinia) — arch §7.2.
- [ ] суми форматуються через `formatMoney` з `@statok/shared` — **FR-52**, arch §7.3.
- [ ] помилки API (коди CRR-2) доступні екранам для показу — CRR-2.
**Фаза.** `frontend` · **Модель.** `sonnet`

### ST-037 — Екран рахунків (`/accounts`)
**Опис.** Реалізувати список рахунків із мультивалютними балансами і повною вартістю, сумарний net worth, CRUD-дії, перехід на деталі.
**Файли.** `frontend/src/pages/AccountsPage.vue`, `frontend/src/components/accounts/AccountForm.vue`.
**Залежності.** ST-036
**Acceptance criteria.**
- [ ] список активних рахунків із мультивалютним кешем і `valueBaseMinor` кожного; сумарний net worth у базовій — **FR-44**.
- [ ] дії створити/редагувати/архівувати (FR-05..08); перехід на `/accounts/:id` — **FR-44**.
- [ ] адаптив 360px: одна колонка, без горизонтального скролу — **FR-48**, CRR-7.
**Фаза.** `frontend` · **Модель.** `sonnet`

### ST-038 — Екран деталей рахунку (`/accounts/:id`)
**Опис.** Реалізувати деталі рахунку: позиції з оцінкою/unrealized, кеш по валютах (warning на негативі), журнал транзакцій рахунку, швидкі дії (додати tx, opening_balance).
**Файли.** `frontend/src/pages/AccountDetailPage.vue`, `frontend/src/components/accounts/AccountPositionsTable.vue`.
**Залежності.** ST-036
**Acceptance criteria.**
- [ ] позиції рахунку з ціною/вартістю/unrealized (абс.+%) — **FR-45, FR-35**.
- [ ] кеш-залишки по валютах; негативний кеш із warning — **FR-45, FR-09**.
- [ ] журнал tx лише цього рахунку (фільтр accountId); швидкі дії «додати tx»/«завести наявну позицію/залишок» (opening_balance) — **FR-45, FR-20**.
- [ ] адаптив 360px — **FR-48**, CRR-7.
**Фаза.** `frontend` · **Модель.** `sonnet`

### ST-039 — Екран транзакцій (`/transactions`): журнал + адаптивні форми
**Опис.** Реалізувати журнал із фільтрами/пагінацією, форму додавання tx (поля адаптуються під тип за матрицею), окрему форму переказу, edit/delete з підтвердженням, показ помилок валідації у формі.
**Файли.** `frontend/src/pages/TransactionsPage.vue`, `frontend/src/components/transactions/TransactionForm.vue`, `frontend/src/components/transactions/TransferForm.vue`, `frontend/src/components/transactions/TransactionsTable.vue`.
**Залежності.** ST-036
**Acceptance criteria.**
- [ ] журнал із фільтрами (рахунок/актив/тип/дати) + пагінація — **FR-46, FR-21**.
- [ ] форма tx: набір полів адаптується під тип (матриця arch §1.6); форма переказу окрема (два рахунки, дві ноги) — **FR-46, FR-17**.
- [ ] edit/delete з рядка; видалення вимагає підтвердження; помилки (CURRENCY_MISMATCH, INSUFFICIENT_QUANTITY) показані зрозуміло — **FR-46, FR-22**.
- [ ] таблиця на 360px → картковий/стековий вигляд або внутрішній скрол — **FR-48**, CRR-7.
**Фаза.** `frontend` · **Модель.** `opus`

### ST-040 — Екран активів (`/assets`): каталог + bond + ціни
**Опис.** Реалізувати довідник активів із фільтром за типом, CRUD, bond-деталі (розклад, метрики YTM/поточна дохідність), історію цін + ручне редагування, дію ticker-change.
**Файли.** `frontend/src/pages/AssetsPage.vue`, `frontend/src/components/assets/AssetForm.vue`, `frontend/src/components/assets/BondPanel.vue`, `frontend/src/components/assets/PriceHistory.vue`.
**Залежності.** ST-036, ST-020, ST-025
**Acceptance criteria.**
- [ ] довідник із фільтром за типом; створення/редагування/архівація (FR-10..13) — **FR-47**.
- [ ] для bond: bond-деталі, купонний розклад (FR-23), метрики YTM/поточна дохідність (FR-27) — **FR-47**.
- [ ] історія цін + ручне редагування ціни (FR-29, FR-31); дія ticker-change (FR-19) — **FR-47**.
- [ ] адаптив 360px — **FR-48**, CRR-7.
**Фаза.** `frontend` · **Модель.** `sonnet`

---

## Епік J — Фронтенд: дашборди, налаштування, PWA · фаза `frontend`

### ST-041 — uPlot-обгортки: NetWorthChart + CashflowChart
**Опис.** Реалізувати тонку обгортку uPlot і два графіки (лінія net worth, бари cashflow), що тягнуть кольори з CSS-змінних теми і перемальовуються при зміні теми.
**Файли.** `frontend/src/components/charts/BaseChart.vue`, `frontend/src/components/charts/NetWorthChart.vue`, `frontend/src/components/charts/CashflowChart.vue`.
**Залежності.** ST-036
**Acceptance criteria.**
- [ ] NetWorthChart — лінія зі снапшотів; CashflowChart — бари (`uPlot.paths.bars`) — **FR-42, FR-43**, arch §7.4.
- [ ] кольори з CSS-змінних теми; перемальовування при зміні теми — **FR-53**, arch §7.4.
- [ ] графіки масштабуються під ширину (тач) — **FR-48**, CRR-7.
**Фаза.** `frontend` · **Модель.** `sonnet`

### ST-042 — Дашборд (`/dashboard`): net worth + cashflow
**Опис.** Зібрати DashboardPage: графік net worth із перемикачем періодів (1м/3м/1р/усе), поточне значення числом, порожній стан; звіт cashflow (бари/таблиця, groupBy).
**Файли.** `frontend/src/pages/DashboardPage.vue`.
**Залежності.** ST-041, ST-030
**Acceptance criteria.**
- [ ] графік net worth (базова валюта) зі снапшотів; перемикач 1м/3м/1р/усе → from/to; пропуски не інтерполюються; поточне значення числом; порожня історія → підказка «запустіть перерахунок» — **FR-42**.
- [ ] cashflow: бари/таблиця по періодах (внески/виведення/дивіденди/купони/відсотки/комісії/нетто); groupBy month/quarter/year — **FR-43**.
- [ ] адаптив 360px — **FR-48**, CRR-7.
**Фаза.** `frontend` · **Модель.** `sonnet`

### ST-043 — Тема + локаль: useTheme, useLocale, перемикачі
**Опис.** Реалізувати composables теми (applyTheme light/dark/auto на CSS-змінних, persist localStorage, реакція на prefers-color-scheme) і локалі (uk/en, persist, миттєве застосування), повні словники локалізації.
**Файли.** `frontend/src/composables/useTheme.ts`, `frontend/src/composables/useLocale.ts`, `frontend/src/locales/uk.json`, `frontend/src/locales/en.json` (повні).
**Залежності.** ST-005
**Acceptance criteria.**
- [ ] тема світла/темна/авто; persist localStorage; миттєве застосування; «авто» слідує системній і реагує на зміну — **FR-53**.
- [ ] локаль uk(деф.)/en; persist; миттєво без перезавантаження; відсутній ключ → fallback en — **FR-52**, NFR-05, CRR-6.
- [ ] усі UI-рядки в обох локалях; числа/валюти через `formatMoney` (Intl), базова валюта USD незалежно від локалі — **FR-52**, NFR-05.
**Фаза.** `frontend` · **Модель.** `sonnet`

### ST-044 — Екран налаштувань (`/settings`)
**Опис.** Реалізувати SettingsPage: перемикачі мови/теми, read-only конфіг (baseCurrency, version), стан джоб (lastRunAt/Success/Status/Error), кнопки ручних дій (sync цін/курсів, перерахунок снапшота, завантаження бекапу).
**Файли.** `frontend/src/pages/SettingsPage.vue`.
**Залежності.** ST-043, ST-033, ST-025, ST-026, ST-028, ST-032
**Acceptance criteria.**
- [ ] перемикачі мови (FR-52) і теми (FR-53); конфіг baseCurrency(read-only)/version; стан джоб з lastError видимий — **FR-54**.
- [ ] кнопки: sync цін (FR-30), sync курсів (FR-34), перерахунок снапшота (FR-40), завантаження бекапу (FR-51) — **FR-54**.
- [ ] адаптив 360px — **FR-48**, CRR-7.
**Фаза.** `frontend` · **Модель.** `sonnet`

### ST-045 — Базова доступність усіх екранів
**Опис.** Прохід доступності: клавіатурна навігація, контраст у обох темах, labels форм + асоційовані помилки, aria для іконкових кнопок.
**Файли.** `frontend/src/**` (доступність-доробки), `frontend/src/components/**`.
**Залежності.** ST-037, ST-038, ST-039, ST-040, ST-042, ST-044
**Acceptance criteria.**
- [ ] інтерактивні елементи доступні з клавіатури (tab, Enter/Space) — **NFR-06**.
- [ ] контраст достатній у світлій/темній темі; форми мають label + асоційовані помилки — **NFR-06**.
- [ ] іконкові кнопки мають `aria-label`/title — **NFR-06**.
**Фаза.** `frontend` · **Модель.** `sonnet`

### ST-046 — PWA: маніфест + service worker + офлайн app shell
**Опис.** Сконфігурувати vite-plugin-pwa: маніфест (Statok, standalone, іконки 192/512/maskable, theme/bg), autoUpdate SW, precache app shell, navigateFallback з denylist, NetworkFirst для GET /api (4с, кеш 24год), виключення backup/dump, без офлайн-мутацій.
**Файли.** `frontend/vite.config.ts` (VitePWA-блок), `frontend/public/icons/*` (192/512/maskable), `frontend/src/pwa.ts`.
**Залежності.** ST-042, ST-044
**Acceptance criteria.**
- [ ] маніфест: name/short_name `Statok`, `display:standalone`, іконки 192/512/maskable, theme/background color; браузер пропонує встановити; standalone-запуск — **FR-55**.
- [ ] SW `registerType:'autoUpdate'`; app shell precache; офлайн відкриває оболонку — **FR-55, FR-56**.
- [ ] `navigateFallback:/index.html`, denylist `/api`,`/auth`,`/health`; GET `/api/*` NetworkFirst (timeout 4с, кеш 24год); `/api/backup/dump` виключено — **FR-56**.
- [ ] мутації офлайн не кешуються/не реплеяться; офлайн-спроба мутації → зрозуміла помилка — **FR-56**.
**Фаза.** `frontend` · **Модель.** `sonnet`

---

## Епік K — Deploy wiring (CI/CD + інфра, БЕЗ підняття прода) · фаза `deploy`

### ST-047 — Backend Dockerfile (Bun + pg_dump)
**Опис.** Написати `backend/Dockerfile` (oven/bun:1.2-alpine, `apk add postgresql16-client` для pg_dump, міграції+сід на старті). Контекст білда — корінь репо (щоб увійшов packages/shared).
**Файли.** `backend/Dockerfile`.
**Залежності.** ST-009, ST-032
**Acceptance criteria.**
- [ ] `FROM oven/bun:1.2-alpine`; `RUN apk add --no-cache postgresql16-client` (pg_dump для FR-51) — arch §2 backup, §6.
- [ ] контекст із кореня репо (`packages/shared` доступний); старт виконує migrate+seed+jobs — arch §6, FR-01.
**Фаза.** `deploy` · **Модель.** `sonnet`

### ST-048 — Frontend Dockerfile + nginx.conf (SPA + security headers)
**Опис.** Написати `frontend/Dockerfile` (Bun-білд → nginx:stable-alpine, build-arg VITE_API_URL) і `nginx.conf` (SPA try_files, gzip, повний набір security headers + CSP).
**Файли.** `frontend/Dockerfile`, `frontend/nginx.conf`.
**Залежності.** ST-046
**Acceptance criteria.**
- [ ] Dockerfile: `oven/bun:1.2-alpine` build (frozen-lockfile, `ARG VITE_API_URL`) → `nginx:stable-alpine` static; контекст із кореня (`-f frontend/Dockerfile`) — arch §6.
- [ ] nginx.conf: SPA `try_files`+gzip; headers nosniff/`X-Frame-Options DENY`/Referrer-Policy/HSTS + CSP `connect-src 'self' https://api.statok.simk.in.ua` — **NFR-01, NFR-02**, arch §9.
**Фаза.** `deploy` · **Модель.** `sonnet`

### ST-049 — Prod compose + infra README (bootstrap + restore)
**Опис.** Написати `infra/docker-compose.yml` (frontend/backend/postgres із Traefik-лейблами, external `web`, без docker.sock) і `infra/README.md` (one-time bootstrap, відновлення age→pg_restore). Ручні кроки власника — позначити.
**Файли.** `infra/docker-compose.yml`, `infra/README.md`.
**Залежності.** ST-047, ST-048
**Acceptance criteria.**
- [ ] compose: 3 сервіси, GHCR-образи `${STATOK_VERSION}`, Traefik-лейбли (web-host + api-host + path-prefix `/api`,`/auth`,`/health` priority 100), external `web`, без docker.sock — blueprint §4b, NFR-01.
- [ ] backend `env_file: .env`, `TZ/APP_TZ=Europe/Kyiv`, depends_on postgres — blueprint §4b.
- [ ] README: bootstrap (DNS, external Traefik, `/opt/statok/.env`) — `[manual-owner]`; відновлення `age -d`→`pg_restore --clean --if-exists` — **NFR-07**, arch §5.2.
**Фаза.** `deploy` · **Модель.** `sonnet`

### ST-050 — Нічний backup.sh + cron-документація
**Опис.** Написати `scripts/backup.sh` (pg_dump з контейнера → age-шифрування → rclone у віддалений сторедж → ротація 14 локально/30д віддалено) і задокументувати host-cron 03:30 + backup.env. Виконання на VPS — ручний крок власника.
**Файли.** `scripts/backup.sh`, `infra/README.md` (секція backup).
**Залежності.** ST-049
**Acceptance criteria.**
- [ ] `backup.sh`: `docker exec ... pg_dump -Fc` → `age -r $AGE_RECIPIENT` → `rclone copy` → ротація (локально 14, віддалено `--min-age 30d`); сорсить `/opt/statok/backup.env` — **NFR-07**, arch §5.1.
- [ ] документовано host-cron `30 3 * * * /opt/statok/backup.sh` і змінні AGE_RECIPIENT/RCLONE_REMOTE — `[manual-owner]` (crontab, rclone config, age-ключ) — **NFR-07**, arch §5.1.
**Фаза.** `deploy` · **Модель.** `sonnet`

### ST-051 — GitHub Actions: build-backend + build-frontend (GHCR)
**Опис.** Написати два build-workflow: збірка і пуш образів backend/frontend у GHCR по тегу `v*`, build-arg VITE_API_URL для фронта, контекст із кореня репо.
**Файли.** `.github/workflows/build-backend.yml`, `.github/workflows/build-frontend.yml`.
**Залежності.** ST-047, ST-048
**Acceptance criteria.**
- [ ] обидва workflow на тег `v*` пушать `ghcr.io/vitaliysimkin/statok/{backend,frontend}:X.Y.Z` (+latest) — blueprint §1, §6.
- [ ] frontend build передає `VITE_API_URL=https://api.statok.simk.in.ua` як build-arg — blueprint §6, arch §8.3.
**Фаза.** `deploy` · **Модель.** `sonnet`

### ST-052 — GitHub Actions: release + deploy + release.mjs + deploy.sh
**Опис.** Написати release-workflow + `scripts/release.mjs` (bump root+backend+frontend, tag vX.Y.Z, push), deploy-workflow (чекає білди, scp infra, SSH `sed` версії → `compose pull && up -d` → /health poll → GitHub Release → Telegram), `deploy.sh` (ручний redeploy/rollback). Прод НЕ піднімаємо — лише код CI/CD.
**Файли.** `.github/workflows/release.yml`, `.github/workflows/deploy.yml`, `scripts/release.mjs`, `deploy.sh`, root `package.json` (release-scripts), `CICD.md`.
**Залежності.** ST-051, ST-049, ST-050
**Acceptance criteria.**
- [ ] `release.mjs`/`release.yml`: bump версії в root+backend+frontend, tag `vX.Y.Z`, push (тригерить build) — blueprint §6.
- [ ] `deploy.yml`: чекає обидва білди, scp `infra/`, SSH `sed`-оновлення `STATOK_VERSION` у `/opt/statok/.env`, `docker compose pull && up -d --remove-orphans`, poll `https://api.statok.simk.in.ua/health` `{status:"ok"}`, GitHub Release + Telegram-нотифай — blueprint §6.
- [ ] `deploy.sh X.Y.Z` — ручний redeploy/rollback; CICD.md документує реліз+деплой; GitHub secrets `VPS_HOST/USER/SSH_KEY`,`RELEASE_TOKEN`,`TELEGRAM_*` — `[manual-owner]` (секрети, DNS, `/opt/statok/.env`) — blueprint §6, NFR-01.
**Фаза.** `deploy` · **Модель.** `sonnet`

---

## Епік L — Integration & verify · фаза `verify`

### ST-053 — Підняти стек у Docker + міграції + smoke API
**Опис.** Адверсаріальна верифікація: підняти dev-Postgres, прогнати міграції+сід, підняти бекенд, прогнати smoke по ключових ендпоінтах (health, login, accounts, assets, transactions, positions, valuation, pnl, bond schedule/metrics, fx convert, snapshots, dashboards, export).
**Файли.** `backend/test/smoke.test.ts`, `scripts/smoke.sh`.
**Залежності.** ST-029, ST-030, ST-031, ST-032, ST-033, ST-034, ST-020
**Acceptance criteria.**
- [ ] міграції застосовуються чисто на свіжій БД; сід-адмін створюється; login видає токен — **FR-01, FR-02**.
- [ ] e2e-сценарій: створити рахунок→актив(bond)→opening_balance→buy→sell→coupon; перевірити positions/pnl/valuation/cashflow коректні — **FR-05..FR-43**.
- [ ] bond schedule+metrics+автопогашення працюють; fx convert із fallback віддає rateUsed/rateDate — **FR-23..FR-27, FR-33**.
- [ ] стандартні відповіді < 500мс на синтетичних ~20k tx — **NFR-03**.
**Фаза.** `verify` · **Модель.** `opus`

### ST-054 — Верифікація фронтенд-білда + PWA + i18n + адаптив
**Опис.** Перевірити білд фронта (Vite production), генерацію PWA-маніфесту/SW, повноту обох локалей, адаптив ключових екранів на 360px, контраст у обох темах.
**Файли.** `frontend/test/build.test.ts`, чеклист verify.
**Залежності.** ST-045, ST-046
**Acceptance criteria.**
- [ ] `bun run build` фронта успішний; маніфест+SW згенеровані; іконки наявні — **FR-55, FR-56**.
- [ ] обидві локалі повні (немає відсутніх ключів); перемикання миттєве — **FR-52**, NFR-05.
- [ ] ключові екрани коректні на 360px (одна колонка, без горизонт. скролу); контраст обох тем достатній — **FR-48**, NFR-06.
**Фаза.** `verify` · **Модель.** `sonnet`

---

## Таблиця трасування FR → ST-ID

| FR | Назва | ST-ID(и) |
|---|---|---|
| FR-01 | Сід адміністратора з env | ST-009 |
| FR-02 | Логін і видача токена | ST-010, ST-011, ST-035 |
| FR-03 | Rate-limit логіну | ST-010, ST-011 |
| FR-04 | Сесія, refresh, вихід | ST-010, ST-011, ST-035 |
| FR-05 | Створення рахунку | ST-014, ST-037 |
| FR-06 | Перегляд рахунків із балансами | ST-014 |
| FR-07 | Редагування рахунку | ST-014 |
| FR-08 | Видалення/архівація рахунку | ST-014 |
| FR-09 | Мультивалютні кеш-залишки | ST-013, ST-014, ST-038 |
| FR-10 | Створення активу | ST-015 |
| FR-11 | Bond-деталі при створенні/редагуванні | ST-006, ST-015 |
| FR-12 | Перегляд/редагування каталогу активів | ST-015 |
| FR-13 | Видалення активу | ST-015 |
| FR-14 | Купівля (buy) | ST-013, ST-016 |
| FR-15 | Продаж (sell) | ST-013, ST-016 |
| FR-15a | Перевірка достатності кількості | ST-013, ST-016, ST-017 |
| FR-16 | Грошові операції (deposit/withdraw) | ST-012, ST-016 |
| FR-17 | Перекази між рахунками | ST-017, ST-039 |
| FR-18 | Дивіденди/купони/відсотки | ST-016 |
| FR-19 | Корпоративні дії (спліт/тікер) | ST-016, ST-017, ST-040 |
| FR-20 | Opening balance | ST-013, ST-016, ST-038 |
| FR-21 | Журнал транзакцій із фільтрами | ST-016, ST-039 |
| FR-22 | Перерахунок похідних при правці | ST-017, ST-039 |
| FR-23 | Генерація купонного розкладу | ST-018, ST-020, ST-040 |
| FR-24 | Очікувані майбутні виплати | ST-018, ST-020 |
| FR-25 | Фіксація купона | ST-016 (coupon-tx), ST-040 |
| FR-26 | Автопогашення в кеш | ST-019, ST-029 |
| FR-27 | YTM і поточна дохідність | ST-018, ST-020, ST-040 |
| FR-28 | Денний автозбір цін (Yahoo) | ST-023 |
| FR-29 | Ручне редагування ціни | ST-023, ST-025, ST-040 |
| FR-30 | Ручний тригер sync цін | ST-025, ST-044 |
| FR-31 | Історія та перегляд цін | ST-025, ST-040 |
| FR-32 | Денний автозбір курсів | ST-024 |
| FR-33 | Конвертація в базову з fallback | ST-021, ST-026, ST-027 |
| FR-34 | Ручне редагування курсу/історія | ST-024, ST-026, ST-044 |
| FR-35 | Позиції з поточною оцінкою | ST-013, ST-027, ST-038 |
| FR-36 | Оцінка портфеля з розрізами | ST-027 |
| FR-37 | P&L (realized+unrealized+income+fees) | ST-027 |
| FR-38 | P&L у відсотках | ST-027 |
| FR-39 | Денний автоснапшот | ST-028, ST-029 |
| FR-40 | Ручний перерахунок снапшота(ів) | ST-028, ST-044 |
| FR-41 | Перегляд історії снапшотів | ST-028 |
| FR-42 | Дашборд: графік net worth | ST-030, ST-041, ST-042 |
| FR-43 | Дашборд: звіт грошових потоків | ST-030, ST-041, ST-042 |
| FR-44 | Екран рахунків зі списком балансів | ST-037 |
| FR-45 | Екран деталей рахунку | ST-038 |
| FR-46 | Журнал транзакцій із формами | ST-039 |
| FR-47 | Екран активів (каталог+bond+ціни) | ST-040 |
| FR-48 | Мобільний адаптив усіх екранів | ST-037, ST-038, ST-039, ST-040, ST-042, ST-044, ST-054 |
| FR-49 | Експорт транзакцій у CSV | ST-031 |
| FR-50 | Експорт позицій у CSV | ST-031 |
| FR-51 | Завантаження дампа БД з UI | ST-032, ST-044, ST-047 |
| FR-52 | Перемикач мови | ST-005, ST-043, ST-044 |
| FR-53 | Перемикач теми | ST-041, ST-043, ST-044 |
| FR-54 | Екран налаштувань: конфіг+джоби | ST-033, ST-044 |
| FR-55 | Маніфест та інсталяція | ST-046 |
| FR-56 | Офлайн app shell | ST-046 |

### Трасування NFR → ST-ID

| NFR | Назва | ST-ID(и) |
|---|---|---|
| NFR-01 | Приватність: allowlist викликів | ST-034, ST-048, ST-049, ST-052 |
| NFR-02 | Безпека | ST-009, ST-010, ST-032, ST-034, ST-048 |
| NFR-03 | Продуктивність (<500мс, ~20k tx) | ST-007, ST-013, ST-053 |
| NFR-04 | Надійність джоб (ретраї, ідемпотентність) | ST-019, ST-022, ST-023, ST-024, ST-029 |
| NFR-05 | i18n | ST-043, ST-054 |
| NFR-06 | Базова доступність | ST-045, ST-054 |
| NFR-07 | Надійність даних і відновлення | ST-032, ST-049, ST-050 |

### Трасування §7 (арх-підрозділи) → ST-ID

| Арх-§ | ST-ID(и) |
|---|---|
| §0 Загальні принципи | ST-002, ST-004, ST-009 |
| §1.1 Enums | ST-002, ST-006 |
| §1.2 users | ST-006, ST-009 |
| §1.3 accounts | ST-006, ST-014 |
| §1.4 assets / cash | ST-006, ST-012, ST-015 |
| §1.5 bond_details | ST-006, ST-015, ST-018 |
| §1.6 transactions (CHECK-матриця) | ST-007, ST-016, ST-017 |
| §1.7 price_quotes | ST-008, ST-023, ST-025 |
| §1.8 fx_rates | ST-008, ST-024, ST-026 |
| §1.9 net_worth_snapshots | ST-008, ST-028 |
| §1.10 app_settings | ST-008, ST-029, ST-033 |
| §2 API-поверхня | ST-004, ST-011, ST-014..ST-033 |
| §3.1 valuation | ST-013 |
| §3.2 pnl | ST-027 |
| §3.3 bond | ST-018, ST-019, ST-020 |
| §3.4 fx | ST-021 |
| §3.5 snapshot | ST-028 |
| §4 Джоби / EOD-пайплайн | ST-022, ST-023, ST-024, ST-029 |
| §5 Бекапи | ST-032, ST-050 |
| §6 Структура монорепо | ST-001, ST-002, ST-047, ST-048 |
| §7.1 Роути фронта | ST-005 |
| §7.2 Стейт (composables) | ST-036 |
| §7.3 i18n/тема/компоненти | ST-043 |
| §7.4 Графіки uPlot | ST-041 |
| §7.5 PWA | ST-046 |
| §8 Конфіг/ENV | ST-003, ST-009 |
| §9 Безпека | ST-010, ST-034, ST-048 |

---

## Критичний шлях (scaffold → перший робочий зріз)

```
ST-001 → ST-002 → ST-004 → ST-006 → ST-007 → ST-009
   → ST-013 (valuation fold) → ST-016 (транзакції) → ST-027 (positions/pnl)
   → ST-028 (снапшоти) → ST-042 (дашборд) → ST-053 (verify)
```
Облігаційна гілка (високий пріоритет, після ядра транзакцій): `ST-018 → ST-019 → ST-020`.
FX-гілка (потрібна для базової валюти): `ST-021` (паралельно з ядром) → споживається ST-014/ST-027/ST-028.

**Орієнтири паралелізму:** після ST-009 епіки D/E/F значною мірою паралельні (спільна залежність — valuation ST-013 і fx ST-021); фронт-епіки I/J стартують після відповідних backend-роутів і composables ST-036; deploy-епік K паралельний фронту (залежить лише від ST-009/ST-032 для образів), verify L — бар'єр у кінці.
