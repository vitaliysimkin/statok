# Statok — План покращень (цикл аналіз→покращення, 2026-06-12–13) — ЗАКРИТО

> Джерело: Workflow `statok-analysis` (run `wf_6ab2dd36-4a0`) — 8 паралельних read-only
> аналітиків (opus), 73 знахідки: 2 critical, 11 high, 31 medium, 29 low.
> Повний звіт: `C:\TEMP_V~1\claude\O--projects-statok\01248c9a-fe83-4eaa-bb61-de59d45ec11f\tasks\wo2py1h8i.output`
> (може бути прибраний системою).
> Виконання: Workflow-хвилі виконавців з ексклюзивним володінням файлами; критичні правки —
> адверсаріальна верифікація; після кожної хвилі — гейт менеджера (tsc / build / smoke) + локальний коміт.

## Підсумок циклу (станом на 2026-06-13)

З **73 знахідок**: ~60 закрито повністю (всі 2 critical, ~10/11 high, більшість medium/low),
~13 свідомо відкладено (deferred, обґрунтування нижче).

Ланцюг комітів (локально на `main`, не запушено): `4773f3b` → `effccbe` → `ee879ef` → `4f41035` → `6479909` → `26d5e54`.
Фінальний стан: `tsc 0`, `bun run build` зелений, **128/128 тестів** зелені.

Наступна фаза: деплой на VPS + Google OAuth — документи `tasks/deploy-bootstrap-plan.md` і `tasks/google-auth-task.md`.

---

## Дедуплікація (знахідки кількох аналітиків → одна задача)

| Тема | Аналітики | Задача |
|---|---|---|
| GET /api/settings: стан джоб завжди null (плоскі ключі vs обʼєкт; snapshot читає 'eod') | feat-domain H, backend-quality H | W1·A |
| Історія цін зламана: `{items}` vs масив у usePrices/useFx | feat-domain H, feat-frontend H | W2·E (фронт) |
| POST /snapshots/run без processMaturedBonds | feat-domain H, backend-quality M | W1·B |
| cashflow: відсутній FX-курс → мікс валют у тоталі | feat-domain M, math M, backend-quality M | W1·E |
| backup: deadlock pipe-буфера + витік stderr клієнту | backend-quality L, security M×2 | W1·F |
| UTC-межі from/to vs Kyiv (cashflow+export) | feat-domain L, math L | W1·E |
| bond/metrics: float-парсинг ?price, priceUsed minor vs DTO, asOf-семантика | math M, feat-core M, feat-core L, feat-domain L | W1·C |

---

## Хвиля 1 — СТАТУС: ВИКОНАНА, коміт `4773f3b`, гейт 1 зелений

| ID | Модель | Критична (адверс. верифікація) | Скоуп | Файли (ексклюзив) |
|---|---|---|---|---|
| A | sonnet | – | settings: стан джоб з композитних ключів (job.prices/fx/snapshot via readJobState), + eod.lastSuccessDate | routes/settings.ts |
| B | sonnet | – | snapshots: /run викликає processMaturedBonds; кеп діапазону /rebuild | routes/snapshots.ts |
| C | opus | ✓ (1 дефект знайдено й пофікшено) | bond: YTM купон на maturity (C+F при t_n); купон/annual через bigint; ?price= без float; priceUsed контракт ↔ DTO ↔ BondPanel; asOf=quoteDate; PUT bond 400; uuid-guard | services/bond.ts, routes/assets.ts, packages/shared/src/dto.ts, frontend/.../BondPanel.vue |
| D | opus | ✓ | FR-15a: future-dated оверселл (повний реплей без atDate-межі); журнал `to` off-by-one; transfer-нога: зміна currency; quoteAt: ігнор котирувань з чужою валютою; uuid-guard | routes/transactions.ts, services/valuation.ts |
| E | opus | ✓ | cashflow: skip+valuationIncomplete замість міксу валют; Kyiv-межі from/to (cashflow+export); CSV: minorToDisplay + pct через divRoundHalfUp (costBasis>0) | routes/dashboards.ts, routes/export.ts, services/pnl.ts (export хелперів) |
| F | opus | ✓ | backup: стрім одразу (без await exited до тіла), stderr лише в лог, INTERNAL-код | routes/backup.ts |
| G | sonnet | – | index.ts: app.notFound JSON; nosniff в onError; routes/api.ts: GET / під auth; accounts: uuid-guard | index.ts, routes/api.ts, routes/accounts.ts |
| H | sonnet | – | prices/fx роути: ISO-дати from/to → 400; ISO-4217 base/quote; manual upsert без Number()-round-trip; uuid-guard | routes/prices.ts, routes/fx.ts |
| FE1 | opus | ✓ | Фронт-фундамент: import CSS кіту; уніфікація теми на .dark/.light кіту; токени (nav/warn/chip/success/error) + контраст (muted ≥4.5, accent у dark); офлайн system-uicons (@iconify-json + addCollection; ЄДИНИЙ дозволений bun install); html lang при зміні локалі; errKey-хелпер в api.ts; локалі: нові ключі (kindExchange/Wallet/Other, assets.archived/priceHistory, errors.* повний набір), прибрати осиротілий kindDeposit | frontend: main.ts, useTheme.ts, useLocale.ts, styles/theme.css, services/api.ts, locales/*.json, package.json |

UUID-валідація: інлайн-guard у кожного власника своїх роутів (без спільного lib у паралельній хвилі).

---

## Хвиля 2 — СТАТУС: ВИКОНАНА, коміт `ee879ef`, гейт 2 зелений

**11/11 виконавців done.** Повні специфікації були у `prompts/HANDOFF-next-session.md` (розділ «Хвиля 2 — специфікації»).

- **Локалі:** підготовчий агент синхронізував uk/en-ключі перед паралельними фронт-агентами.
- **Фронт-сторінки (FE-A..G):**
  - A: App.vue + ThemeLocaleSwitcher (нав-токени, іконки кіту, TButton, виклик refresh() при старті)
  - B: Dashboard + Charts (locale замість 'uk', TButtonGroup, labels серій через t(), видалено мертвий BaseChart)
  - C: Accounts* + AccountForm (kind-лейбли, warn-токени, іконки кіту, TSwitch, card-stack позицій, alert→inline errKey)
  - D: Transactions* (кіт-форми, transfer-edit блок/окрема форма, errKey, пагінація іконками)
  - E: Assets* + PriceHistory + BondPanel ({items} фікс usePrices/useFx + amountMinor у convert, TSelect, archived-бейдж, source-лейбли, заголовок історії)
  - F: Login + Settings (кіт, TButtonGroup, syncResult okCount/errCount+fx-сума, чистка мертвого useSettings)
  - G: PWA (растрові PNG 192/512/maskable генерацією, manifest lang/description, чистка pwa.ts)
- **BE-misc:** залишкові бекенд-дрібниці.
- **BE-fx:** N+1 курси у pnl/cashflow → in-memory резолвер `createFxResolver`/`loadFxResolver`; pivot rateDate `MIN→MAX`. Адверсаріальна верифікація ok з 1-го разу. Дотест еквівалентності резолвера у `fx.test.ts`. Smoke-перевірка: cashflow deposits=1194 = еквівалентність з гейтом 1.
- **tests-pure:** packages/shared (money/decimal) + bond (schedule/YTM/currentYield).
- **tests-db:** valuation/pnl/fx/processMaturedBonds на statok_test:5434.
- **Паралельно:** read-only розвідка VPS dakara → `tasks/deploy-bootstrap-plan.md` (коміт `4f41035`).
- **Фікс dev-сервера:** vite dev падав на codemirror-імпортах барела t-components → resolve.alias на no-op стаб `frontend/src/lib/codemirror-stub.ts` (коміт `6479909`). Build біт-у-біт той самий.

**Гейт 2:** `tsc 0`, `bun run build` зелений (PWA PNG у manifest), **128/128 тестів**; live-smoke повний (oversell-409, cashflow deposits=1194, manual exact-string 41.89320001/985.50000001, convert інверс+fallback, backup PGDMP, sync Frankfurter+НБУ живий, settings джоби реальні).

---

## Хвиля 3 — СТАТУС: ВИКОНАНА, коміт `26d5e54`, фінальний гейт зелений

**Completeness-критик** (210k токенів, перевіряв по коду проти всіх 73 знахідок):
- 2/2 critical закриті, ~10/11 high закриті, регресій у грошах не внесено.
- NUL-байт у `valuation.ts` реально усунено (git показував binary через стару базу; перевірено безпосередньо).

**3 добивання-фікси за результатами критика:**
1. Іконка `pencil→pen` у `AssetsPage` і `PriceHistory` (system-uicons, правильна назва).
2. `useFx.history` — поля `base`/`quote` зроблені обовʼязковими (не опціональними).
3. `backend/tsconfig.json` — додано `include: ["test/**/*.ts"]` (тести не компілювались у tsc-перевірці).

**Фінальний гейт:** `tsc 0` (включно з тестами), `bun run build` зелений, **128/128 тестів**.

---

## Відкладено свідомо (deferred, не в цьому циклі)

| # | Тема | Причина відкладення |
|---|---|---|
| 1 | Повна міграція модалок на TModalBox + focus-trap | Велика/ризикована зміна; натомість Esc+фокус інлайн у W2 |
| 2 | Консолідація uuid/date-guard у спільний lib | Дублі некритичні; прибрати в окремому рефакторинг-тікеті |
| 3 | rebuild-перф понад кеп 3700 днів (порційність) + перевід rebuild/portfolio/accounts на fx-резолвер | Кеп достатній для v1; fx-резолвер у pnl/cashflow — окремий крок |
| 4 | Конвертація котирувань у чужій валюті (GBp-кейс) | v1: ігнор+warn (рішення W1·D); повна підтримка — пізніше |
| 5 | Кеп/таймаут pg_dump-стріму | Низький ризик для v1; додати після перших продових спостережень |
| 6 | Гармонізація стилю `valuationIncomplete` (різні форми у роутах) | Косметика; не впливає на коректність |
| 7 | db singleton lazy-getter (зараз запікає URL при першому імпорті) | Обхід є (env перед запуском); рефакторинг — окремо |
| 8 | Звуження універсального `* transition` у `theme.css` | Продуктивність — незначна; audited після першого продового релізу |
| 9 | Перевидання t-components з повними vue `.d.ts` (TSelect/TDateInput/TDateTimeInput — `any` через `skipLibCheck`) | Залежить від upstream; обхід `skipLibCheck` вже є |
| 10 | Експорт `couponAmountMinor` для прямих юніт-тестів | Зручність тестування; не блокує функціональність |
| 11 | Конвенція `try/catch` замість `await expect().rejects` (зависає на bun+postgres) | Задокументовано; нові тести вже пишуться правильно |
| 12 | deposit/withdraw: зміна currency у buildUpdate (ТЗ не вимагає) | Явно поза скоупом v1 ТЗ |
| 13 | Уніфікація бренд-синього (manifest `#1a6ef5` vs іконки `#2563eb`) | Візуально непомітно; гармонізувати при оновленні дизайну |
| 14 | e2e-HTTP тест PUT assets з частковим bond | Покриття є юніт-тестами; e2e — окремий тікет |

---

## Інженерні уроки цієї сесії (доповнення до наявних 12)

13. Паралельні FE-агенти самоперевіряються через `bunx vue-tsc --noEmit`, **НЕ** через `bun run build` (гонка за `dist/`; виняток — один агент з окремим `--outDir`).
14. `bun test` усім сьютом — env `DATABASE_URL` **МУСИТЬ** вказувати на `statok_test` ДО запуску (`singleton` запікає URL при імпорті першого ж тест-файла; `bond.test.ts` імпортується першим).
15. Барелі сторонніх кітів можуть еагерно імпортувати невстановлені peer-деки — prod-build пройде (tree-shake), dev-пребандлер впаде; рішення: `resolve.alias` на локальні no-op стаби.
16. PS 5.1: немає `//`, `?:`, `&&`; тіла JSON для `curl.exe` — через `-d @файл`.
17. `StructuredOutput`-звіти агентів читати з `.output`-файла через `[System.IO.File]::ReadAllText` з UTF8 (`Get-Content` ламає кирилицю); структура: `{summary, agentCount, logs, result}`.

---

## Гейти після кожної хвилі (менеджер, не агенти)

1. `bunx tsc --noEmit -p backend/tsconfig.json` — нуль помилок.
2. `bun run build` у frontend — зелено.
3. Smoke на dev-Postgres (docker-compose.dev.yml, порт 5434; бекенд 3100): health, login, accounts, transactions, positions, valuation, pnl, bond schedule/metrics (YTM par-бонд ≈ ставці купона!), fx convert, snapshots/run (з погашенням), dashboards cashflow, settings (стан джоб НЕ null після sync), export CSV, backup dump.
4. Локальний коміт-чекпойнт (без push), Telegram-пінг %.

**Команда для тестів:**
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/statok_test bun test packages/shared/test backend/test
```

---

## Наступна фаза

- **Деплой на VPS dakara (195.201.130.51):** `tasks/deploy-bootstrap-plan.md`
  Блокери: DNS `statok.simk.in.ua`/`api.statok.simk.in.ua` → чужий IP `91.197.69.34` (потрібні A-записи на `195.201.130.51`); GHCR без `docker login` на хості; образів `ghcr.io/vitaliysimkin/statok/*` ще нема; `/opt/statok` не існує; бекапів на хості нема.
- **Google OAuth (вхід тільки vitaliy.simkin@gmail.com):** `tasks/google-auth-task.md`
  Реалізація через `jose` JWKS, без нових залежностей. Рекомендація — впровадити **до** публічного деплою.
