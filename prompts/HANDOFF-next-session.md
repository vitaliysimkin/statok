# Handoff — продовження циклу АНАЛІЗ→ПОКРАЩЕННЯ: Хвиля 2+ (МЕНЕДЖЕР-РЕЖИМ)

> Скопіюй блок між `=== ПРОМПТ ===` як перше повідомлення нової сесії Claude Code.
> Робоча директорія: `O:\projects\statok`. Попередня сесія: аналіз (73 знахідки) + хвиля 1
> виконані й закомічені (`4773f3b`). Ця сесія = хвиля 2 → гейт → хвиля 3 → закриття циклу.

---

```
=== ПРОМПТ ===
Ти — МЕНЕДЖЕР-ОРКЕСТРАТОР проєкту Statok (O:\projects\statok). Це ПРОДОВЖЕННЯ циклу АНАЛІЗ → ПОКРАЩЕННЯ: аналіз (8 аналітиків, 73 знахідки) і ХВИЛЯ 1 покращень завершені, верифіковані гейтом і закомічені локально (HEAD = 4773f3b, НЕ запушено). Твоя задача: провести ХВИЛЮ 2 за ГОТОВИМИ специфікаціями з хендофа (розділ «Хвиля 2 — специфікації»), потім гейт 2, потім ХВИЛЮ 3 (completeness-критик + добивання), фінальний гейт і закриття циклу. Працюй ВИКЛЮЧНО через Workflow (агенти opus/sonnet). Відповідай українською.

ЖОРСТКЕ ПРАВИЛО: ти НІЧОГО не робиш сам, крім менеджменту. Не аналізуєш і не пишеш код власноруч. Уся аналітика і ВСІ зміни — лише через підагентів у Workflow. Тобі дозволено лише: проектувати/запускати воркфлоу, читати звіти, синтезувати/пріоритезувати, комітити чекпойнти, запускати верифікаційні гейти (tsc/build/test/smoke), пінгувати прогрес.

Спершу прочитай ПОВНІСТЮ: prompts/HANDOFF-next-session.md (стан, специфікації хвилі 2, інженерні уроки) і tasks/improvement-plan.md (синтез знахідок). ТЗ specs/statok-tz.md — довідково (агентам давай посилання на розділи). Активуй /notify-me (прогрес у %; старт = 55%).

ПАЙПЛАЙН ЦІЄЇ СЕСІЇ:
1. ХВИЛЯ 2 — один Workflow: спочатку ПОСЛІДОВНО locales-агент (L), потім 10 ПАРАЛЕЛЬНИХ виконавців (FE-A..G, BE-misc, BE-fx, tests-pure, tests-db) за специфікаціями з хендофа (там само — ексклюзивне володіння файлами). BE-fx — критичний: адверсаріальна верифікація + 1 раунд фіксів усередині воркфлоу (патерн хвилі 1).
2. ГЕЙТ 2 (сам, як менеджер): bunx tsc --noEmit -p backend/tsconfig.json; bun run build (frontend); bun test (нові тести shared+backend — УСІ зелені); live-smoke (чеклист у хендофі). Коміт чекпойнт локально (без push), пінг ~80%.
3. ХВИЛЯ 3 — completeness-критик (звірити git diff 415429d..HEAD з усіма 73 знахідками + followUps; що пропущено/недороблено) → добивання дрібними агентами → фінальний гейт → коміт, пінг 95%.
4. ЗАКРИТТЯ: оновити tasks/improvement-plan.md (статуси), переписати prompts/HANDOFF-next-session.md під НАСТУПНУ фазу (деплой за infra/README.md), фінальний коміт + пінг 100%.

Застереження (деталі в хендофі, розділ «Інженерні уроки»): Windows — не пиши у nul; не паралель bun install (у хвилі 2 інсталяцій НЕМАЄ взагалі — забороняй усім); НЕ вір агентам на слово «tsc clean» — перевіряй сам; спільні файли — один власник (таблиця у специфікаціях); smoke через curl.exe — JSON БЕЗ пробілів (PS 5.1 ламає лапки); перед smoke вбий орфан-процеси bun на 3100; верифікаторне сміття (.playwright-mcp тощо) не комітити. Деплой — ПІСЛЯ закриття циклу, окремою сесією, прод не чіпай.
=== /ПРОМПТ ===
```

---

## Стан циклу (станом на паузу 2026-06-12)

- **Аналіз виконано:** Workflow `statok-analysis`, 8 паралельних read-only аналітиків (opus), **73 знахідки** (2 critical, 11 high, 31 medium, 29 low). Синтез/дедуплікація/хвилі — `tasks/improvement-plan.md`. Сирі JSON-звіти (якщо TEMP не почищено): `C:\TEMP_V~1\claude\O--projects-statok\01248c9a-fe83-4eaa-bb61-de59d45ec11f\tasks\wo2py1h8i.output` (аналіз) і `...\w2erdn77l.output` (хвиля 1). Резюме обох є нижче і в коміт-меседжі `4773f3b` — сирі файли НЕ обовʼязкові.
- **Хвиля 1 виконана й закомічена:** `4773f3b` (28 файлів, +611/−201). 9/9 виконавців done; адверсаріальні верифікатори 5 критичних задач: 4 чисті, FE1 — 1 дефект (видалені `--t-*` аліаси) знайдено→пофікшено→ре-верифіковано у живому Chromium. Гейт 1 пройдено ПОВНІСТЮ: tsc 0; build зелений; live-smoke підтвердив: YTM par-бонда = 10 (було ~0), future-dated оверселл → 409, journal to=сьогодні включає день, settings показує реальний стан джоб, cashflow valuationIncomplete:true без курсу / коректна конвертація з курсом, manual fx/price зберігаються exact-string, convert інверс+fallback (rateUsed/rateDate), снапшот/positions/valuation/pnl 200 (математика звірена вручну: $247.18), CSV-заголовки за ТЗ, backup стрімить PGDMP, реальні Frankfurter+НБУ sync ок.
- **Хвиля 2 НЕ ЗАПУСКАЛАСЬ** — пауза сталася рівно перед стартом воркфлоу. Специфікації готові (нижче), нічого переробляти не треба.
- **Git:** HEAD `4773f3b` на `main`, не запушено; working tree чистий. Між `415429d` і хвилею 1 є користувацький коміт `f862d52` (VSCode tasks/launch).
- **Середовище:** docker-контейнер `statok-postgres-1` (порт 5434) ЗАЛИШЕНО ЗАПУЩЕНИМ; БД `statok` містить smoke-дані гейту 1 (рахунок SmokeBroker, бонд UA000SMOKE01 із opening_balance 10 шт, депозити, manual курс USD/UAH 41.89320001 на 2026-06-11, manual ціна 985.50000001, снапшот, стани джоб). Це НЕ заважає гейту 2 (smoke ідемпотентний по суті; за бажання чиста БД: `docker compose -f docker-compose.dev.yml down -v; ... up -d`). Бекенд НЕ запущений. Порти 3100/5273 вільні (5434 — Postgres).
- **Telegram:** /notify-me активний у попередній сесії; останній пінг — «пауза, 55%».

## Хвиля 2 — специфікації (ГОТОВІ ДО ЗАПУСКУ)

**Структура воркфлоу:** `phase('Локалі')` → `await agent(L)` (послідовно, БО локалі — спільний файл) → `phase('Виконання')` → `pipeline(10 задач)`; для BE-fx — стадія адверсаріальної верифікації + 1 раунд фіксів + ре-верифікація (точний патерн — хвиля 1, скрипт `statok-improve-w1-wf_718f2e92-f68.js` у `C:\Users\vital\.claude\projects\O--projects-statok\01248c9a-fe83-4eaa-bb61-de59d45ec11f\workflows\scripts\` — звідти ж бери GUARD, EXEC_SCHEMA, VERDICT_SCHEMA, VERIFY_HEAD; вони перевірені боєм).

**GUARD хвилі 2 = GUARD хвилі 1 + додатки:** (а) `bun install/add` ЗАБОРОНЕНО ВСІМ (залежності вже на місці); (б) tests-агентам дозволено `bun test <власні файли>`; (в) tests-db дозволено CREATE/DROP DATABASE `statok_test` на 5434 (admin postgresql://postgres:postgres@localhost:5434/postgres), БД `statok` НЕ ЧІПАТИ (smoke-дані менеджера); (г) у JS-рядках застережи від випадкових бектиків/`$`+`{`.

| ID | Модель | Verify | Власність (ексклюзив) |
|---|---|---|---|
| L | sonnet | – | frontend/src/locales/uk.json, en.json |
| FE-A | sonnet | – | frontend/src/App.vue, components/ThemeLocaleSwitcher.vue |
| FE-B | sonnet | – | pages/DashboardPage.vue, components/charts/{NetWorthChart,CashflowChart,BaseChart}.vue |
| FE-C | opus | – | pages/AccountsPage.vue, pages/AccountDetailPage.vue, components/accounts/{AccountPositionsTable,AccountForm}.vue, (new) src/lib/accountKind.ts |
| FE-D | opus | – | pages/TransactionsPage.vue, components/transactions/{TransactionForm,TransferForm,TransactionsTable}.vue |
| FE-E | opus | – | pages/AssetsPage.vue, components/assets/{AssetForm,PriceHistory}.vue, composables/{usePrices,useFx}.ts |
| FE-F | sonnet | – | pages/LoginPage.vue, pages/SettingsPage.vue, composables/useSettings.ts |
| FE-G | opus | – | (new) scripts/gen-pwa-icons.mjs, frontend/public/icons/*, frontend/vite.config.ts, frontend/index.html, frontend/src/pwa.ts (delete) |
| BE-misc | opus | – | backend/src/routes/{assets,export,transactions}.ts, backend/src/services/valuation.ts |
| BE-fx | opus | ✓ адверс. | backend/src/services/{fx,pnl}.ts, backend/src/routes/dashboards.ts |
| tests-pure | opus | – | (new) packages/shared/test/{money,decimal}.test.ts, backend/test/bond.test.ts |
| tests-db | opus | – | (new) backend/test/helpers/testDb.ts, backend/test/{valuation,pnl,fx,bondRedemption}.test.ts |

### L — локалі (ПЕРШИЙ, послідовно)
Додати в ОБИДВІ локалі (повний паритет, не дублювати наявні): `dashboard.valuationIncomplete` («Оцінка неповна: для частини операцій бракує курсу валют» / «Valuation incomplete: FX rate missing for some entries»); `errors.INVALID_SETTING_KEY` («Невідомий ключ налаштування» / «Unknown settings key»); `common.close` («Закрити»/«Close»); `common.prevPage` («Попередня сторінка»/«Previous page»); `common.nextPage` («Наступна сторінка»/«Next page»); `transactions.editTransfer` («Редагувати переказ»/«Edit transfer»); `settings.syncPricesResult` («Ціни: {ok} успішно, {err} помилок» / «Prices: {ok} ok, {err} failed»); `settings.syncFxResult` («Курси: Frankfurter {fr}, НБУ {nbu}» / «FX rates: Frankfurter {fr}, NBU {nbu}»). Перевірити JSON-валідність і паритет ключів скриптом.

### FE-A — App + перемикач теми/локалі
1) App.vue нав-бар: хардкоди `#1a1a2e`/`#ccc`/`rgba(255,255,255,…)` → токени `--color-nav-bg/-text/-active` (додані хвилею 1). Logout → TButton (mode text/ghost). 2) ThemeLocaleSwitcher: гліфи ☀/☾/⊙ → іконки system-uicons (ПЕРЕВІРИТИ наявність імен у node_modules/@iconify-json/system-uicons/icons.json; підібрати наявні, напр. sun/moon), кольори → токени; aria-label локалізовані. 3) Sliding-сесія FR-04: у App.vue onMounted — якщо є токен, викликати useAuth().refresh() (catch → ігнор; 401 обробить apiFetch).

### FE-B — Дашборд + графіки
1) DashboardPage.vue:139,143 — formatMoney із locale.value (useI18n) замість хардкоду 'uk'. 2) Рендер прапора valuationIncomplete з /api/dashboards/cashflow: бейдж t('dashboard.valuationIncomplete') на warning-токенах. 3) Періоди 1м/3м/1р/усе і groupBy → TButtonGroup (mandatory, options з t()). 4) CashflowChart series labels 'Deposits/Withdrawals/Net' → t('dashboard.deposits/withdrawals/net') + перебудова графіка при зміні локалі (watch). 5) Обидва чарти: MutationObserver attributeFilter → лише ['class'] (data-theme мертвий після хвилі 1). 6) ВИДАЛИТИ components/charts/BaseChart.vue (мертвий; перед видаленням grep-підтвердити нуль імпортів).

### FE-C — Рахунки (2 сторінки + таблиця позицій + форма)
1) (new) src/lib/accountKind.ts: kindLabelKey(kind) → 'accounts.kindBroker|kindExchange|kindBank|kindWallet|kindOther'; застосувати в AccountsPage, AccountDetailPage, AccountForm (select options) — прибрати exchange/wallet→'Невідомо' і other→'Готівка'. 2) Хардкод-кольори → токени: #fef3c7/#92400e → --color-warning-bg/-text; .cash-neg #fff5f5 → warning/error-токени; .tx-type #f1f5f9 → --color-chip-bg; .positive/.negative #16a34a/#dc2626 → var(--color-success)/var(--color-error). Дубль warn-бейджа між файлами — спільний клас/компонент. 3) Іконки: інлайн-SVG (edit/archive/delete) і '+' → TButton :icon system-uicons (як на AssetsPage; імена звіряти з icons.json); пагінація ←/→ → chevron-left/right + aria-label t('common.prevPage'/'nextPage'). 4) Чекбокс «включно з архівними» → TSwitch. 5) alert(e?.message) у doArchive/doDelete → інлайн-помилка через errKey (import з '@/services/api') у наявному діалозі. 6) AccountPositionsTable: card-stack ≤640px за патерном TransactionsTable (data-label + ::before). 7) Модалки цих сторінок: закриття Esc + автофокус першого поля. 8) AccountForm → кит (TInput/TSelect/TButton).

### FE-D — Транзакції (сторінка + 3 компоненти)
1) ГОЛОВНЕ: редагування переказу. Рядок із transferGroupId НЕ відкриває загальну TransactionForm (зараз відкриває напівпорожню форму — можна зіпсувати дані). TransferForm отримує edit-режим: дата/нотатка спільні, сума+валюта пер-нога; збереження — PUT /api/transactions/:id ОДНІЄЇ ноги з {executedAt, note, amountMinor, currency} (бекенд із хвилі 1 синхронізує executedAt/note на пару і підтримує зміну currency ноги). Кнопка t('transactions.editTransfer'). 2) Кит-компоненти у TransactionForm/TransferForm: input→TInput, select→TSelect, date→TDateInput, datetime-local→TDateTimeInput, кнопки→TButton (radio asset/cash — лишити нативним або TButtonGroup). 3) Локальні errKey у TransactionForm (~р.282) і TransferForm (~р.102) → import { errKey } з '@/services/api'. 4) Пагінація ‹/› → chevron-іконки + aria (common.prevPage/nextPage). 5) Дії edit/delete .link-btn → TButton mode text size mini з іконками. 6) Діалоги: Esc + автофокус; card-stack у TransactionsTable вже є — не зламати.

### FE-E — Активи (сторінка + форма + історія цін + 2 композабли)
1) HIGH-ФІКС (зламана фіча FR-31): usePrices.history — бекенд віддає {items:[...]}, фронт кладе весь обʼєкт у масив → PriceHistory вічно «Немає даних». Розпакувати: quotes.value = res.items (типізувати apiFetch<{items:PriceQuote[]}>). Те саме в useFx.history; у useFx.convert параметр amount → amountMinor (контракт бекенда). 2) PriceHistory: заголовок секції → t('assets.priceHistory') (зараз «Джерело ціни»); значення source → t('assets.priceSourceYahoo'/'priceSourceManual'); перевірити рендер таблиці після фіксу. 3) AssetsPage: бейдж архівного → t('assets.archived') (зараз 'Статус'); фільтр типів → TButtonGroup; чекбокс архівних → TSwitch; колонка priceSource → ключі. 4) AssetForm: нативні select (type/priceSource/couponFrequency) → TSelect. 5) Модалки: Esc + автофокус. BondPanel.vue НЕ чіпати (узгоджений у хвилі 1).

### FE-F — Login + Settings
1) SettingsPage sync-тости: prices читає res.ok/res.errors (нема таких) → res.okCount/res.errCount → t('settings.syncPricesResult',{ok,err}); fx → t('settings.syncFxResult',{fr: frankfurter.ratesUpserted, nbu: nbu.ratesUpserted}), при ok=false гілки — показати помилку. 2) useSettings: ВИДАЛИТИ мертві exportCsv()/triggerBackup() (бʼють у неіснуючі шляхи; реальні виклики інлайн у SettingsPage). 3) Сегменти мови/теми (.btn-seg) → TButtonGroup mandatory. 4) LoginPage → TInput/TButton (кит уже стилізований після хвилі 1). 5) Помилки → errKey.

### FE-G — PWA: растрові іконки + manifest
1) (new) scripts/gen-pwa-icons.mjs: згенерувати СПРАВЖНІ PNG без зовнішніх залежностей — node:zlib deflateSync (zlib-формат) + власний CRC32, піксельний буфер; дизайн простий геометричний (скруглений квадрат #2563eb + білі зростаючі бари/лінія вгору), БЕЗ тексту/шрифтів. Вихід: frontend/public/icons/icon-192.png, icon-512.png, maskable-512.png (maskable: контент у центральних ~80%, фон до країв). Прогнати скрипт bun-ом; перевірити PNG-сигнатуру і IHDR-розміри парсингом. 2) vite.config.ts manifest: icons → три PNG (type image/png; purpose any та maskable), lang:'uk', description «Особистий облік інвестицій та портфеля» (SVG-іконки можна лишити додатково). 3) index.html: <link rel="apple-touch-icon" href="/icons/icon-192.png">. 4) Видалити мертвий frontend/src/pwa.ts (grep: initPWA ніде не імпортується; SW реєструється через injectRegister:'auto'). 5) bun run build → у dist/manifest.webmanifest є PNG-іконки.

### BE-misc — добивання бекенда (з followUps хвилі 1)
1) routes/assets.ts: PUT із частковим bond-блоком ({} або відсутні обовʼязкові поля) зараз → NaN/undefined у SQL → 500 (пре-існуюче, верифікатор C задокументував). validateBondInput при partial: валідувати ПРИСУТНІ поля за типом/форматом + zero-coupon-узгодженість; структурно неповний bond при створенні bond-блоку в PUT → 400. POST не зламати. 2) assets.ts:~227: мертвий тернар errCode (обидві гілки 'ASSET_HAS_TRANSACTIONS') → константа. 3) routes/export.ts: видалити мертве обчислення unrealizedBase (колонки unrealized_base у FR-50 НЕМАЄ — видалити, НЕ додавати колонку). 4) routes/transactions.ts: видалити невикористаний INCOME_TYPES (~р.42). 5) services/valuation.ts: у helper composite() роздільник — байт 0x00 (NUL), через нього git трактує файл як binary. Замінити на U+001F (unit separator) + короткий комент; це СУТО внутрішній ключ Map — збережених даних не зачіпає. Після правки git diff по файлу має стати текстовим.

### BE-fx — N+1 курси (КРИТИЧНИЙ, адверсаріальна верифікація)
Проблема (NFR-03): pnl.foldPeriod і dashboards-cashflow викликають convert() на КОЖНУ транзакцію; кожен convert — 1–3 SQL (прямий → інверс → 2 pivot-плеча) → тисячі послідовних round-trip на ~20k історії. Рішення (узгоджене): fx.ts експортує резолвер, що ОДНИМ запитом вантажить усі рядки fx_rates у память (таблиця крихітна, single-user) і резолвить у памʼяті з ТОЧНО тією самою семантикою: прямий max rate_date≤date → інверс 1/rate (та сама точність ділення, що в поточному коді) → pivot через USD один рівень → not found; те саме bigint-округлення (ОДНЕ фінальне half-up). API: createFxResolver(rows)/loadFxResolver() з convert(amountMinor, from, to, date) → {amountMinor, rateUsed, rateDate} (сигнатура результату як у сервісного convert). pnl.ts і cashflow у dashboards.ts переходять на резолвер (один load на HTTP-запит); РЕШТУ викликів convert (routes/fx, accounts, snapshot, portfolio) НЕ чіпати. Додатково: pivot rateDate зараз MIN(двох плечей) — замінити на MAX (дата, з якої обидва плеча чинні) СИНХРОННО в обох шляхах (старому convert і резолвері). ОБОВʼЯЗКОВА числова еквівалентність: bun-скриптом на dev-БД (read-only) порівняти старий convert vs резолвер на кейсах identity/прямий/інверс/pivot/fallback-дата/not-found — ІДЕНТИЧНІ {amountMinor, rateUsed, rateDate}; мікробенч (наприклад 2000 convert старим шляхом vs резолвер з preload) — час у selfCheck. ВЕРИФІКАТОР: спростувати еквівалентність (крайові дати, manual-рядки, відсутні пари, інверсна точність), перевірити інтеграцію pnl/cashflow і незмінність інших шляхів.

### tests-pure — чисті юніт-тести (без БД)
bun:test. (new) packages/shared/test/money.test.ts + decimal.test.ts: подивитись РЕАЛЬНІ експорти і покрити: divRoundHalfUp (±, .5-межі: 2.5→3, −2.5→−3; ділення на 0 кидає), parseDec (scale-обрізання half-up, негативні, сміття кидає), mulToMinor (типові + overflow MAX_SAFE_INTEGER кидає), proportionMinor (нерівні частки, whole=0), displayToMinor ('0.005'→1 half-up, негативні, overflow), minorToDisplay (0, негативні, великі), formatMoney (uk/en базово). (new) backend/test/bond.test.ts (чисті фн; DATABASE_URL=dummy з .env.dev, конект лінивий): couponSchedule (freq 1/2/4/12, redemption останній = face, zero-coupon → лише redemption, issueDate обрізає, ліміт 50 років, місячні краї 31-го числа), couponAmountMinor (100000/15.75%/2=7875; 60/10%/12=1), currentYield (приклад ТЗ ≈16.58; zero→0), ytm (par = ставці ±0.01; discount >; premium <; zero-coupon; РЕГРЕС хвилі 1: купон на даті погашення — потік C+F; semi-annual збіжність). ПРАВИЛО: тести фіксують поведінку ТЗ; якщо тест викрив РЕАЛЬНИЙ баг коду — НЕ підганяти тест: позначити test.todo з поясненням + followUps.

### tests-db — інтеграційні тести доменних сервісів (Postgres 5434)
(new) backend/test/helpers/testDb.ts: admin-конект postgresql://postgres:postgres@localhost:5434/postgres → DROP/CREATE DATABASE statok_test; міграції через наявний runMigrations із DATABASE_URL на statok_test; truncate доменних таблиць між тестами; фабрики (user, account, asset stock/bond/cash, tx). БД `statok` НЕ ЧІПАТИ. Кейси:
- valuation.test.ts: buy+fee → costBasis і кеш; sell — costPart half-up, realized; повний продаж → позиції нема, realized є; оверселл минулим → conflicts; **future-dated оверселл → conflicts (регрес хвилі 1, fullTimeline)**; split (qty×множник, costBasis незмінний; reverse 0.1); opening_balance (з amount; без amount з котируванням ≤дати; без котирувань → costBasisIncomplete); qty=0 викинуто; негативний кеш дозволений; bond без котирування → номінал; stock без котирування → valueMinor null; **котирування у чужій валюті → як відсутнє (регрес хвилі 1)**; стабільний tie-break (рівні executedAt → createdAt,id).
- pnl.test.ts: realized лише для sell у [from,to], собівартість з повної історії; income за типами за курсом ДАТИ виплати (два курси різних дат); fees не в total; total = realized+income+unrealized; valuationIncomplete при відсутньому курсі.
- fx.test.ts: identity; прямий; інверс 1/rate (звірити точне значення); pivot UAH↔EUR через USD (одне фінальне округлення — звірити руками очікуване число); fallback «останній попередній» (rateDate < запитаної); FX_RATE_NOT_FOUND; manual нарівні. (Після BE-fx: якщо резолвер уже влитий — прогнати ті самі кейси і через нього; якщо ні — лише сервісний convert.)
- bondRedemption.test.ts (processMaturedBonds): дозріла qty>0 → авто-sell за номіналом з meta.autoRedemption, кеш +, позиція 0; ідемпотентність (повтор без дубля); кілька рахунків/паперів; недозрілі не зачеплені.

## Гейт 2 (чеклист менеджера — САМ, не агенти)

1. `bunx tsc --noEmit -p backend/tsconfig.json` → 0 помилок.
2. `cd frontend; bun run build` → зелений; у dist/manifest.webmanifest — PNG-іконки.
3. `bun test` по нових тестах (packages/shared/test, backend/test) → усі зелені (Postgres 5434 має бути up для db-тестів).
4. Live-smoke (бекенд: `cd backend; bun --env-file=.env.dev run start` у фоні; перед стартом ВБИТИ орфани на 3100): повторити чеклист гейту 1 (health/login/401/notFound/uuid-guard/bond schedule+metrics par/oversell-409/journal-to/cashflow-прапор/manual exact/convert/snapshots/positions/valuation/pnl/export/backup/sync/settings) + нове: GET /api/prices?assetId=…&from=…&to=… повертає {items} і фронт-композабл розпаковує (через build достатньо), PUT /api/assets/:id з bond:{} → 400 (BE-misc), pnl/cashflow дають ті САМІ числа, що в гейті 1 (еквівалентність BE-fx: deposits=1194 при курсі 41.89320001).
5. Коміт чекпойнт (трейлер `Co-Authored-By: Claude <noreply@anthropic.com>`), пінг ~80%.

## Хвиля 3 — закриття

1. **Completeness-критик** (1 opus, read-only): вхід — git diff 415429d..HEAD + tasks/improvement-plan.md + список 73 знахідок (резюме в плані; сирі JSON якщо збереглись) + followUps хвиль; вихід — структурований список «закрито/частково/не чіпали/нове зламано?» з пріоритетами.
2. Добивання: дрібні агенти на знайдене (якщо є critical/high) — з ексклюзивним володінням.
3. Фінальний гейт (як гейт 2) → коміт → оновити improvement-plan.md (статуси) → переписати цей handoff під фазу ДЕПЛОЮ (наступна сесія: infra/README.md, реліз тегом, ручні кроки власника позначити [manual-owner]) → пінг 100% (🎉 завершальний).

## Свідомо відкладено (НЕ робити в цьому циклі)

Повна міграція модалок на TModalBox (замість цього Esc+фокус інлайн у FE-C/D/E); консолідація uuid/date-guard у спільний lib; rebuild-порційність понад кеп 3700 днів; конвертація котирувань у чужій валюті (GBp-кейс — v1: ігнор+warn); кеп/таймаут на pg_dump-стрім; «unconditional vs omit-when-false» стиль прапора valuationIncomplete (дві конвенції в коді — гармонізувати колись).

## Інженерні уроки (обидві сесії — ВРАХУЙ у воркфлоу і гейтах)

1. **Windows `nul`:** жодних редиректів у nul//dev/null (битий файл ламає git add). У GUARD кожному агенту.
2. **bun install** — лише один агент за хвилю, послідовно. У хвилі 2 інсталяцій НЕМАЄ — забороняй усім.
3. **Не вір «tsc clean» агентам** — ПІСЛЯ хвилі сам ганяй повний tsc і build; агенти бачать рухоме дерево (чужі помилки під час хвилі — норм, ігнорують свої файли).
4. **Smoke ловить те, що tsc не бачить** (двічі підтверджено: подвійний serve у фазі 1; живі перевірки YTM/oversell у хвилі 1).
5. **Спільні файли — один власник на хвилю:** routes/api.ts, index.ts, schema.ts, locales/*.json, App.vue, main.ts, theme.css, services/api.ts, dto.ts, vite.config.ts, bun.lock. Локалі — окремий послідовний агент ПЕРЕД паралельною хвилею; dto-правки — одному агенту за хвилю.
6. **PS 5.1 + curl.exe ламає JSON із пробілами** в -d (re-quoting): JSON у smoke — БЕЗ пробілів у значеннях, або -d @файл. Симптом: 400 Invalid JSON body і хвости |000 у -w.
7. **Пісочниця блокує компаунд-команди** з Remove-Item + шляхами/текстами зі слешами (хибний матч): руйнівні кроки — ОКРЕМИМИ викликами.
8. **Орфан-процеси агентів:** верифікатори/виконавці можуть лишити запущений bun на 3100 (і він міг застосувати міграції до dev-БД). Перед smoke: Get-NetTCPConnection 3100 → kill. Сміття типу .playwright-mcp/ — видалити перед комітом (git status переглядати!).
9. **bun -e для числових перевірок**: імпорт backend-сервісів тягне db/index.ts — конект лінивий, достатньо DATABASE_URL із .env.dev (без живої БД для чистих фн). Bash-tool + нативний Bun на Windows не дружать із POSIX-/tmp — тимчасові скрипти класти у репо-tmp і видаляти, або PowerShell.
10. **Адверсаріальна верифікація працює:** вимагай від верифікаторів ЧИСЛОВІ контрприклади (bun -e) і git diff-обмеження по файлах задачі; mustFix лише за реальні дефекти. Патерн exec→verify→fix→re-verify із w1-скрипта переносити як є.
11. **agent() у Workflow з opts.phase** — обовʼязково в pipeline-стадіях (інакше гонки прогрес-груп); schema StructuredOutput — виконавцям і верифікаторам.
12. **Гроші:** будь-який новий код — ТІЛЬКИ через @statok/shared (bigint half-up); Number()/parseFloat на грошовому шляху = дефект (виняток YTM-метрика за ТЗ §3.3).

## Конвенції

- Коміти ЛОКАЛЬНО, БЕЗ push; трейлер `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Агенти: opus — складна логіка/верифікація; sonnet — механічні правки за точною спекою.
- Telegram /notify-me: пінг на старті хвилі, після гейту, на блокерах, фінальний 🎉.
- Прогрес-шкала циклу: 55% (зараз) → 80% (гейт 2) → 95% (хвиля 3) → 100% (закриття + handoff деплою).
- Dev-порти: Postgres 5434, бекенд 3100, Vite 5273.

## Далі по пайплайну (НЕ в цій сесії)

Після закриття циклу — **деплой** за infra/README.md (DNS, зовнішній Traefik + мережа web, секрети /opt/statok/.env, GitHub secrets, реліз тегом vX.Y.Z через bun run release:patch). Прод піднімає власник; push у origin — за рішенням власника після рев'ю.
