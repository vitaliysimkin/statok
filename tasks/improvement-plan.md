# Statok — План покращень (цикл аналіз→покращення, 2026-06-12)

> Джерело: Workflow `statok-analysis` (run `wf_6ab2dd36-4a0`) — 8 паралельних read-only
> аналітиків (opus), 73 знахідки: 2 critical, 11 high, 31 medium, 29 low.
> Повний звіт: `C:\TEMP_V~1\claude\O--projects-statok\01248c9a-fe83-4eaa-bb61-de59d45ec11f\tasks\wo2py1h8i.output`.
> Виконання: Workflow-хвилі виконавців з ексклюзивним володінням файлами; критичні правки —
> адверсаріальна верифікація; після кожної хвилі — гейт менеджера (tsc / build / smoke) + локальний коміт.

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

## Хвиля 1 (паралельно, 9 виконавців; володіння файлами без перетинів)

| ID | Модель | Критична (адверс. верифікація) | Скоуп | Файли (ексклюзив) |
|---|---|---|---|---|
| A | sonnet | – | settings: стан джоб з композитних ключів (job.prices/fx/snapshot via readJobState), + eod.lastSuccessDate | routes/settings.ts |
| B | sonnet | – | snapshots: /run викликає processMaturedBonds; кеп діапазону /rebuild | routes/snapshots.ts |
| C | opus | ✓ | bond: YTM купон на maturity (C+F при t_n); купон/annual через bigint; ?price= без float; priceUsed контракт ↔ DTO ↔ BondPanel; asOf=quoteDate; PUT bond 400; uuid-guard | services/bond.ts, routes/assets.ts, packages/shared/src/dto.ts, frontend/.../BondPanel.vue |
| D | opus | ✓ | FR-15a: future-dated оверселл (повний реплей без atDate-межі); журнал `to` off-by-one; transfer-нога: зміна currency; quoteAt: ігнор котирувань з чужою валютою; uuid-guard | routes/transactions.ts, services/valuation.ts |
| E | opus | ✓ | cashflow: skip+valuationIncomplete замість міксу валют; Kyiv-межі from/to (cashflow+export); CSV: minorToDisplay + pct через divRoundHalfUp (costBasis>0) | routes/dashboards.ts, routes/export.ts, services/pnl.ts (export хелперів) |
| F | opus | ✓ | backup: стрім одразу (без await exited до тіла), stderr лише в лог, INTERNAL-код | routes/backup.ts |
| G | sonnet | – | index.ts: app.notFound JSON; nosniff в onError; routes/api.ts: GET / під auth; accounts: uuid-guard | index.ts, routes/api.ts, routes/accounts.ts |
| H | sonnet | – | prices/fx роути: ISO-дати from/to → 400; ISO-4217 base/quote; manual upsert без Number()-round-trip; uuid-guard | routes/prices.ts, routes/fx.ts |
| FE1 | opus | ✓ | Фронт-фундамент: import CSS кіту; уніфікація теми на .dark/.light кіту; токени (nav/warn/chip/success/error) + контраст (muted ≥4.5, accent у dark); офлайн system-uicons (@iconify-json + addCollection; ЄДИНИЙ дозволений bun install); html lang при зміні локалі; errKey-хелпер в api.ts; локалі: нові ключі (kindExchange/Wallet/Other, assets.archived/priceHistory, errors.* повний набір), прибрати осиротілий kindDeposit | frontend: main.ts, useTheme.ts, useLocale.ts, styles/theme.css, services/api.ts, locales/*.json, package.json |

UUID-валідація: інлайн-guard у кожного власника своїх роутів (без спільного lib у паралельній хвилі).

## Хвиля 2 (після гейту 1; специфікації — після результатів W1)

- **Фронт-сторінки (паралельно, по власнику):** A: App.vue+ThemeLocaleSwitcher (нав-токени, іконки кіту, TButton, viklik refresh() при старті); B: Dashboard+Charts (locale замість 'uk', TButtonGroup періоди/groupBy, labels серій через t(), видалити мертвий BaseChart); C: Accounts*+AccountForm (kind-лейбли, warn-токени, іконки кіту, TSwitch, card-stack позицій, alert→inline errKey); D: Transactions* (кіт-форми, transfer-edit блок/окрема форма, errKey, пагінація іконками); E: Assets*+PriceHistory+BondPanel ({items} фікс usePrices/useFx + amountMinor у convert, TSelect, archived-бейдж, source-лейбли, заголовок історії); F: Login+Settings (кіт, TButtonGroup, syncResult okCount/errCount+fx-сума, чистка мертвого useSettings); G: PWA (растрові PNG 192/512/maskable генерацією, manifest lang/description, чистка pwa.ts). Модалки: Esc+фокус кожен власник у своїх.
- **Бекенд:** fx-batch (N+1 у pnl/cashflow → батч-резолв курсів; pivot rateDate→MAX) + адверс. верифікація і замір на ~20k tx.
- **Тести (2 агенти):** pure (packages/shared money/decimal + bond schedule/YTM/currentYield) і db-backed (valuation/pnl/fx/processMaturedBonds на dev-Postgres 5434, БД statok_test) — повний перелік кейсів у знахідці backend-quality#tests.

## Хвиля 3 — добивання за результатами гейту 2 + completeness-критик (звірка диффа з усіма 73 знахідками).

## Відкладено свідомо (не в цьому циклі)

- Повна міграція модалок на TModalBox (велика/ризикова; натомість Esc+фокус інлайн у W2).
- Консолідація uuid/date-guard у спільний lib (дубль-регекси прибрати пізніше).
- rebuild-перф понад кеп (порційність) — кеп достатній для v1.
- Конвертація котирувань у чужій валюті (GBp-кейс) — v1: ігнор+warn (рішення W1·D).

## Гейти після кожної хвилі (менеджер, не агенти)

1. `bunx tsc --noEmit -p backend/tsconfig.json` — нуль помилок.
2. `bun run build` у frontend — зелено.
3. Smoke на dev-Postgres (docker-compose.dev.yml, порт 5434; бекенд 3100): health, login, accounts, transactions, positions, valuation, pnl, bond schedule/metrics (YTM par-бонд ≈ ставці купона!), fx convert, snapshots/run (з погашенням), dashboards cashflow, settings (стан джоб НЕ null після sync), export CSV, backup dump.
4. Локальний коміт-чекпойнт (без push), Telegram-пінг %.
