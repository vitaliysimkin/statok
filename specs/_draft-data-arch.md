# Statok — Технічна архітектура (Фаза 1): дані, API, сервіси, інфраструктура

> Чернетка технічної частини ТЗ. Цільова аудиторія — агент, що автономно імплементує систему.
> Джерела істини: `specs/requirements.md` (рішення власника), `research/deployment-blueprint.md` (стек/деплой).
> CI/CD-пайплайн, Traefik-лейбли, release-флоу — НЕ дублюються тут, див. blueprint §4–6.
> Функціональні вимоги та UX — у паралельному документі.

## 0. Загальні принципи

- **Стек** — дзеркало tardis: Bun 1.2 + Hono 4 + Drizzle ORM + `postgres` driver; Postgres 16-alpine; Vue 3 + Vite + TS; nginx static. Bun усюди (і frontend).
- **Версії пакетів (бекенд)**: `hono ^4`, `drizzle-orm ^0.44`, `drizzle-kit ^0.31` (потрібен `check()` у schema), `postgres ^3.4`, `jose ^6`, `bcryptjs ^2.4`. Жодних інших runtime-залежностей у бекенді.
- **Міграції**: `drizzle-kit generate` → SQL-файли у `backend/drizzle/`; застосовуються автоматично на старті через `runMigrations()` (патерн tardis `src/db/migrate.ts`). Після міграцій — `seedAdmin()`.
- **Час**: усі timestamp-колонки — `timestamptz`. «Бізнес-дата» (котирування, курси, снапшоти) — `date`, обчислюється у TZ `Europe/Kyiv`.
- **Гроші**: фіат — `bigint` minor units (копійки/центи) + `char(3)` ISO-код валюти. У Drizzle — `bigint({ mode: 'number' })`: JS number безпечний до 2^53 (~9×10^15 minor units), для особистого портфеля достатньо; зафіксовано як свідомий компроміс. Кількості `numeric(38,18)`, ціни `numeric(20,8)`, курси `numeric(18,8)` — у JS подорожують як **string** (drizzle default для numeric), арифметика — лише через decimal-хелпери з `packages/shared` (bigint fixed-point), ніколи через float.
- **Округлення**: half-up до minor unit, на межі «numeric → minor» (звіти, valuation).
- **Single-user**: один користувач (адмін-сід), але всі доменні таблиці мають `user_id` FK — uniform із tardis, дешевий заділ на майбутнє.
- **Позиції — похідні**: окремої таблиці positions НЕМА. Сервіс valuation рахує позиції та кеш-залишки fold-ом по транзакціях. Єдина матеріалізована похідна — `net_worth_snapshots`.

---

## 1. Модель даних (Postgres / Drizzle)

Файл: `backend/src/db/schema.ts`. Нижче — повна схема (TS-фрагменти канонічні; назви колонок snake_case у БД).

### 1.1 Enums

```ts
import { pgEnum } from 'drizzle-orm/pg-core'

export const assetTypeEnum = pgEnum('asset_type', ['stock', 'etf', 'crypto', 'bond', 'cash'])

export const transactionTypeEnum = pgEnum('transaction_type', [
  'buy', 'sell',
  'deposit', 'withdraw',
  'transfer_out', 'transfer_in',
  'dividend', 'coupon', 'interest',
  'split', 'ticker_change',
  'opening_balance',
])

export const accountKindEnum = pgEnum('account_kind', ['broker', 'exchange', 'bank', 'wallet', 'other'])
export const priceSourceEnum = pgEnum('price_source', ['yahoo', 'manual'])
export const fxSourceEnum = pgEnum('fx_source', ['frankfurter', 'nbu', 'manual'])
```

Комісія — НЕ тип транзакції, а поле `fee_minor` на `buy`/`sell` (канон).

### 1.2 users

Клон tardis без `role` (один користувач — розмежування ролей не потрібне; всі ендпоінти, крім login/health, під auth).

```ts
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 255 }).unique().notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
```

Сід: `seedAdmin()` на старті — якщо `ADMIN_USERNAME` відсутній у таблиці, створити з `bcrypt(ADMIN_PASSWORD, 10)` (патерн tardis `lib/seed.ts`).

### 1.3 accounts

Рахунок (брокер/біржа/банк/гаманець). Рахунок **мультивалютний**: окремого поля валюти нема — кеш-залишки виводяться по валютах із транзакцій.

```ts
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  kind: accountKindEnum('kind').notNull().default('broker'),
  note: text('note').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique('accounts_user_name_unique').on(t.userId, t.name),
])
```

Видалення: hard delete дозволений лише якщо немає транзакцій (інакше 409 → архівувати).

### 1.4 assets

```ts
export const assets = pgTable('assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  type: assetTypeEnum('type').notNull(),
  // stock/etf: Yahoo-тікер (AAPL, VWRA.L); crypto: Yahoo-пара (BTC-USD);
  // bond: ISIN (UA4000227696); cash: ISO-код валюти (USD)
  symbol: varchar('symbol', { length: 64 }).notNull(),
  name: varchar('name', { length: 255 }).notNull().default(''),
  // Валюта торгів/котирування; для cash — сама валюта
  currency: char('currency', { length: 3 }).notNull(),
  priceSource: priceSourceEnum('price_source').notNull().default('yahoo'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique('assets_user_type_symbol_unique').on(t.userId, t.type, t.symbol),
  check('assets_cash_symbol_check', sql`type <> 'cash' OR symbol = currency`),
])
```

Правила:
- `cash`-активи створюються автоматично сервісом `ensureCashAsset(userId, currency)` при першій транзакції у валюті (symbol = currency, name = код валюти, priceSource = 'manual' — котирування не потрібні, ціна тотожно 1).
- `bond` за замовчуванням `priceSource = 'manual'` (ОВДП на Yahoo нема).
- Зміна `symbol` — ЛИШЕ через транзакцію `ticker_change` (див. 1.7), не через PUT.

### 1.5 bond_details (1:1 до assets, type=bond)

```ts
export const bondDetails = pgTable('bond_details', {
  assetId: uuid('asset_id').primaryKey().references(() => assets.id, { onDelete: 'cascade' }),
  faceValueMinor: bigint('face_value_minor', { mode: 'number' }).notNull(),   // номінал 1 папера, у валюті активу
  couponRatePercent: numeric('coupon_rate_percent', { precision: 8, scale: 4 }).notNull(), // річна ставка, % (15.7500)
  couponFrequency: smallint('coupon_frequency').notNull(),                    // виплат/рік: 1|2|4|12; 0 = zero-coupon
  issueDate: date('issue_date'),                                              // опційно (обрізає розклад зліва)
  maturityDate: date('maturity_date').notNull(),
  isin: varchar('isin', { length: 12 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check('bond_freq_check', sql`coupon_frequency IN (0, 1, 2, 4, 12)`),
  check('bond_zero_coupon_check', sql`(coupon_frequency = 0) = (coupon_rate_percent = 0)`),
  check('bond_face_positive_check', sql`face_value_minor > 0`),
])
```

Створюється/оновлюється атомарно разом із asset (один DB-транзакшн у POST/PUT /api/assets).

### 1.6 transactions

Серце системи. Кожен рядок належить рахунку і активу (`asset_id` NOT NULL: чисто грошові операції вказують на cash-актив своєї валюти).

```ts
export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  assetId: uuid('asset_id').references(() => assets.id).notNull(),
  type: transactionTypeEnum('type').notNull(),
  executedAt: timestamp('executed_at', { withTimezone: true }).notNull(),
  // Кількість: buy/sell/opening_balance — штук активу; split — МНОЖНИК (нова к-сть = стара × quantity)
  quantity: numeric('quantity', { precision: 38, scale: 18 }),
  // Ціна за одиницю у currency (buy/sell; opening_balance — опційно, довідково)
  price: numeric('price', { precision: 20, scale: 8 }),
  // Грошова сума операції (модуль; знак визначається типом):
  //  buy/sell = qty×price БЕЗ комісії; deposit/withdraw/transfer_* = сума;
  //  opening_balance(cash) = стартовий залишок; opening_balance(актив) = сукупна собівартість (опційно)
  amountMinor: bigint('amount_minor', { mode: 'number' }),
  currency: char('currency', { length: 3 }).notNull(),
  feeMinor: bigint('fee_minor', { mode: 'number' }).notNull().default(0),
  // Лише dividend / coupon / interest:
  grossMinor: bigint('gross_minor', { mode: 'number' }),
  withholdingTaxMinor: bigint('withholding_tax_minor', { mode: 'number' }),
  netMinor: bigint('net_minor', { mode: 'number' }),
  // Лише transfer_out / transfer_in — звʼязка пари
  transferGroupId: uuid('transfer_group_id'),
  note: text('note').notNull().default(''),
  // split: {"from":1,"to":4} (довідково); ticker_change: {"fromSymbol":"FB","toSymbol":"META"};
  // авто-погашення облігації: {"autoRedemption":true}
  meta: jsonb('meta'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('tx_account_executed_idx').on(t.accountId, t.executedAt),
  index('tx_asset_executed_idx').on(t.assetId, t.executedAt),
  index('tx_user_executed_idx').on(t.userId, t.executedAt),
  index('tx_type_idx').on(t.type),
  // Пара: максимум один out і один in на групу
  uniqueIndex('tx_transfer_group_type_unique').on(t.transferGroupId, t.type)
    .where(sql`transfer_group_id IS NOT NULL`),
  check('tx_amount_nonneg_check', sql`amount_minor IS NULL OR amount_minor >= 0`),
  check('tx_qty_positive_check', sql`quantity IS NULL OR quantity > 0`),
  check('tx_fee_only_trade_check', sql`type IN ('buy','sell') OR fee_minor = 0`),
  check('tx_transfer_group_check',
    sql`(type IN ('transfer_out','transfer_in')) = (transfer_group_id IS NOT NULL)`),
  check('tx_income_fields_check', sql`
    type NOT IN ('dividend','coupon','interest')
    OR (gross_minor IS NOT NULL AND withholding_tax_minor IS NOT NULL
        AND net_minor = gross_minor - withholding_tax_minor)`),
  check('tx_trade_fields_check', sql`
    type NOT IN ('buy','sell')
    OR (quantity IS NOT NULL AND price IS NOT NULL AND amount_minor IS NOT NULL)`),
])
```

**Матриця полів за типом** (✓ обовʼязкове, ○ опційне, — має бути NULL; сервіс валідує повну матрицю, CHECK-и страхують критичне):

| type | asset_id вказує на | quantity | price | amount_minor | fee | gross/wht/net | transfer_group_id |
|---|---|---|---|---|---|---|---|
| buy | актив | ✓ | ✓ | ✓ (=qty×price) | ○ | — | — |
| sell | актив | ✓ | ✓ | ✓ | ○ | — | — |
| deposit | cash-актив валюти | — | — | ✓ | — | — | — |
| withdraw | cash-актив валюти | — | — | ✓ | — | — | — |
| transfer_out | cash-актив валюти | — | — | ✓ | — | — | ✓ |
| transfer_in | cash-актив валюти | — | — | ✓ | — | — | ✓ |
| dividend | акція/ETF | — | — | — | — | ✓ (wht деф. 0) | — |
| coupon | облігація | — | — | — | — | ✓ | — |
| interest | cash-актив валюти | — | — | — | — | ✓ | — |
| split | актив | ✓ (множник) | — | — | — | — | — |
| ticker_change | актив | — | — | — | — | — (meta ✓) | — |
| opening_balance (актив) | актив | ✓ | ○ | ○ (собівартість) | — | — | — |
| opening_balance (кеш) | cash-актив | — | — | ✓ (залишок) | — | — | — |

**Сервісні валідації понад CHECK-и** (повертають 400/409):
- `buy`/`sell`: `currency` має дорівнювати `assets.currency` (інакше 400 `CURRENCY_MISMATCH`).
- `sell`/`split`/будь-яке редагування/видалення: реплей таймлайну `(account_id, asset_id)` — якщо в будь-якій точці qty стає < 0 → 409 `INSUFFICIENT_QUANTITY`. Негативний КЕШ дозволений (лише warning у UI).
- `split`, `ticker_change`, `opening_balance`, `dividend/coupon` — недопустимі для `type='cash'` активів (400), `coupon` лише для bond, `dividend` лише для stock/etf.
- Transfer-пара: створення/видалення — атомарно (одна DB-транзакція на обидва рядки); валюти/суми ніг НЕЗАЛЕЖНІ (це покриває і переказ, і конвертацію валюти між рахунками). Редагування ноги: `executedAt`/`note` синхронізуються на обидві, сума/валюта — пер-нога.
- `ticker_change`: атомарно інсертить транзакцію з `meta {fromSymbol, toSymbol}` і оновлює `assets.symbol`. Історія цін лишається на тому ж asset-рядку (континуїтет).

**Вплив на похідні** (повна таблиця — §3.1): кеш-дельта по (account, currency), qty-дельта і cost-basis-дельта по (account, asset).

### 1.7 price_quotes

Денні ціни (EOD) на одиницю активу, у валюті активу.

```ts
export const priceQuotes = pgTable('price_quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'cascade' }).notNull(),
  quoteDate: date('quote_date').notNull(),
  price: numeric('price', { precision: 20, scale: 8 }).notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  source: priceSourceEnum('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('price_quotes_asset_date_unique').on(t.assetId, t.quoteDate),
])
```

- Один рядок на (asset, date). Ручне редагування — upsert із `source='manual'`.
- **Інваріант**: syncPrices НІКОЛИ не перетирає рядки з `source='manual'` (`ON CONFLICT ... DO UPDATE ... WHERE price_quotes.source <> 'manual'`).
- Для облігацій price = грошова **clean price** за 1 папір (напр. 985.50 UAH при номіналі 1000), не відсоток номіналу.

### 1.8 fx_rates

Денна історія курсів. Семантика рядка: `1 base_ccy = rate quote_ccy`.

```ts
export const fxRates = pgTable('fx_rates', {
  id: uuid('id').primaryKey().defaultRandom(),
  rateDate: date('rate_date').notNull(),
  baseCcy: char('base_ccy', { length: 3 }).notNull(),
  quoteCcy: char('quote_ccy', { length: 3 }).notNull(),
  rate: numeric('rate', { precision: 18, scale: 8 }).notNull(),
  source: fxSourceEnum('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('fx_rates_date_pair_unique').on(t.rateDate, t.baseCcy, t.quoteCcy),
  index('fx_rates_pair_date_idx').on(t.baseCcy, t.quoteCcy, t.rateDate),
])
```

Зберігаємо нормалізовано: Frankfurter → рядки `(USD, EUR, 0.92341, 'frankfurter')`; НБУ → `(USD, UAH, 41.8932, 'nbu')`, `(EUR, UAH, 48.1011, 'nbu')`. Manual upsert по тій самій унікальності перезаписує source на 'manual'; sync не перетирає manual-рядки (та сама `WHERE source <> 'manual'` умова).

### 1.9 net_worth_snapshots

```ts
export const netWorthSnapshots = pgTable('net_worth_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  snapshotDate: date('snapshot_date').notNull(),
  baseCurrency: char('base_currency', { length: 3 }).notNull(),
  totalMinor: bigint('total_minor', { mode: 'number' }).notNull(),
  // {"byAccount":[{"accountId","name","valueMinor"}],
  //  "byClass":[{"class":"stock|etf|crypto|bond|cash","valueMinor"}],
  //  "byCurrency":[{"currency","valueMinor"}]}  — усі value у base_currency minor
  breakdown: jsonb('breakdown').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex('nws_user_date_unique').on(t.userId, t.snapshotDate),
])
```

Редагування історичних транзакцій НЕ перебудовує минулі снапшоти автоматично — є явні `POST /api/snapshots/run` (один день) і `POST /api/snapshots/rebuild` (діапазон), які перераховують із збереженої історії цін/курсів (upsert по даті).

### 1.10 app_settings

Generic key-value для серверного стану (стан джоб, службові позначки). Користувацькі UI-преференси (тема, локаль) живуть у localStorage фронтенда, НЕ тут.

```ts
export const appSettings = pgTable('app_settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})
```

Зарезервовані ключі: `job.prices` / `job.fx` / `job.snapshot` → `{"lastRunAt","lastSuccessAt","lastStatus":"ok|error","lastError":string|null}`; `eod.lastSuccessDate` → `"YYYY-MM-DD"`.

---

## 2. API-поверхня (Hono REST)

Маунт як у tardis: `/health` і `/auth` без префікса, решта під `/api/*` (Traefik у blueprint роутить саме `/api`, `/auth`, `/health`). Всі ендпоінти крім `POST /auth/login` і `GET /health` — під `authMiddleware` (Bearer JWT).

**Формат помилки**: `{ "error": "MACHINE_CODE", "message": "human readable" }`. Коди статусів: 400 `VALIDATION_ERROR`/`CURRENCY_MISMATCH`, 401 `UNAUTHORIZED`, 404 `NOT_FOUND`/`FX_RATE_NOT_FOUND`, 409 `CONFLICT`/`INSUFFICIENT_QUANTITY`/`ACCOUNT_HAS_TRANSACTIONS`/`ASSET_HAS_TRANSACTIONS`, 429 `RATE_LIMITED`, 500 `INTERNAL`.

**Конвенції**: дати у query/body — `YYYY-MM-DD`; timestamps — ISO 8601; суми — `*Minor` (integer) + `currency`; numeric-величини (qty, price, rate) — string. Список транзакцій пагінований (`limit` деф. 50, макс. 500; `offset`; відповідь `{items, total}`); решта списків — без пагінації (single user).

### auth (`routes/auth.ts`)

| Метод | Шлях | Тіло → Відповідь | Помилки |
|---|---|---|---|
| POST | `/auth/login` | `{username, password}` → `{token, username}` | 401, 429 |
| POST | `/auth/refresh` | — (Bearer) → `{token}` (новий, свіжий TTL) | 401 |
| POST | `/auth/logout` | — → `{ok:true}` (лог-запис; інвалідація клієнтська) | 401 |
| GET | `/auth/me` | → `{userId, username}` | 401 |

### health (`routes/health.ts`) — формат tardis

| GET | `/health` | → `{status:"ok", db:"ok"\|"error", version}`; 200, при недоступній БД 503 |

### accounts (`routes/accounts.ts`)

| Метод | Шлях | Тіло → Відповідь | Помилки |
|---|---|---|---|
| GET | `/api/accounts?withBalances=true&includeArchived=` | → `{items:[{id,name,kind,note,sortOrder,archivedAt, balances?:[{currency,cashMinor}], valueBaseMinor?}]}` | — |
| POST | `/api/accounts` | `{name, kind, note?}` → 201 `{account}` | 400, 409 (імʼя зайняте) |
| GET | `/api/accounts/:id` | → `{account}` | 404 |
| PUT | `/api/accounts/:id` | `{name?, kind?, note?, sortOrder?, archived?:boolean}` → `{account}` | 400, 404, 409 |
| DELETE | `/api/accounts/:id` | → 204 | 404, 409 `ACCOUNT_HAS_TRANSACTIONS` |

### assets (`routes/assets.ts`)

| Метод | Шлях | Тіло → Відповідь | Помилки |
|---|---|---|---|
| GET | `/api/assets?type=&includeArchived=` | → `{items:[{...asset, bond?:{...bondDetails}}]}` | — |
| POST | `/api/assets` | `{type, symbol, name?, currency, priceSource?, bond?:{faceValueMinor, couponRatePercent, couponFrequency, maturityDate, issueDate?, isin?}}` → 201 | 400 (bond обовʼязковий ⇔ type=bond), 409 (дубль symbol) |
| GET | `/api/assets/:id` | → `{...asset, bond?}` | 404 |
| PUT | `/api/assets/:id` | `{name?, currency?, priceSource?, archived?, bond?}` (symbol — лише через ticker-change) → `{asset}` | 400, 404 |
| DELETE | `/api/assets/:id` | → 204 | 404, 409 `ASSET_HAS_TRANSACTIONS` |
| GET | `/api/assets/:id/bond/schedule` | → `{items:[{date, amountMinor, isFuture}], currency}` (купони + фінальний `{maturityDate, faceValue}` рядок) | 404 (не bond) |
| GET | `/api/assets/:id/bond/metrics?price=&date=` | → `{ytmPercent, currentYieldPercent, priceUsed, priceSource, asOf}` (price деф. = останнє котирування, fallback номінал) | 404 |

### transactions (`routes/transactions.ts`)

| Метод | Шлях | Тіло → Відповідь | Помилки |
|---|---|---|---|
| GET | `/api/transactions?accountId=&assetId=&type=&from=&to=&limit=&offset=` | → `{items, total}` (sort: executedAt desc) | 400 |
| POST | `/api/transactions` | `{accountId, assetId?, type, executedAt, quantity?, price?, amountMinor?, currency, feeMinor?, grossMinor?, withholdingTaxMinor?, note?, meta?}`; для чисто грошових типів `assetId` опційний — сервер сам викликає `ensureCashAsset(currency)` → 201 `{transaction}` | 400, 404, 409 `INSUFFICIENT_QUANTITY` |
| POST | `/api/transactions/transfer` | `{fromAccountId, toAccountId, executedAt, outAmountMinor, outCurrency, inAmountMinor, inCurrency, note?}` → 201 `{outTx, inTx}` (атомарно, спільний `transferGroupId`) | 400, 404 |
| POST | `/api/transactions/ticker-change` | `{assetId, newSymbol, executedAt, note?}` → 201 `{transaction, asset}` (атомарно) | 400, 404, 409 (symbol зайнятий) |
| GET | `/api/transactions/:id` | → `{transaction}` | 404 |
| PUT | `/api/transactions/:id` | часткове оновлення тих самих полів; тип НЕ змінюється (400) → `{transaction}` | 400, 404, 409 |
| DELETE | `/api/transactions/:id` | → 204; transfer-нога → видаляється вся пара; ticker_change → відкат symbol, якщо це останній ticker_change активу | 404, 409 |

### prices (`routes/prices.ts`)

| Метод | Шлях | Тіло → Відповідь | Помилки |
|---|---|---|---|
| GET | `/api/prices?assetId=&from=&to=` | → `{items:[{assetId, quoteDate, price, currency, source}]}` | 400 |
| PUT | `/api/prices/:assetId/:date` | `{price}` → `{quote}` (upsert, source='manual') | 400, 404 |
| DELETE | `/api/prices/:assetId/:date` | → 204 | 404 |
| POST | `/api/prices/sync` | `{assetId?}` → `{okCount, errCount, errors:[{symbol, message}]}` (синхронно; ручний тригер джоби) | — |

### fx (`routes/fx.ts`)

| Метод | Шлях | Тіло → Відповідь | Помилки |
|---|---|---|---|
| GET | `/api/fx?base=&quote=&from=&to=` | → `{items:[{rateDate, baseCcy, quoteCcy, rate, source}]}` | 400 |
| GET | `/api/fx/convert?amountMinor=&from=&to=&date=` | → `{amountMinor, from, to, rateUsed, rateDate}` (rateDate ≤ date — застосований fallback) | 404 `FX_RATE_NOT_FOUND` |
| PUT | `/api/fx/:date/:base/:quote` | `{rate}` → `{fxRate}` (upsert, source='manual') | 400 |
| POST | `/api/fx/sync` | → `{frankfurter:{ok,ratesUpserted}, nbu:{ok,ratesUpserted}}` | — |

### portfolio (`routes/portfolio.ts`)

| Метод | Шлях | Відповідь |
|---|---|---|
| GET | `/api/portfolio/positions?accountId=&date=` | `{positions:[{accountId, asset:{id,type,symbol,name,currency}, quantity, costBasisMinor, avgCostMinor, lastPrice, priceDate, valueMinor, valueBaseMinor, unrealizedMinor, unrealizedBaseMinor, unrealizedPct}], cash:[{accountId, currency, balanceMinor, balanceBaseMinor}], baseCurrency, asOf}` |
| GET | `/api/portfolio/valuation?date=` | `{totalBaseMinor, byClass:[...], byAccount:[...], byCurrency:[...], baseCurrency, asOf}` (та сама структура, що breakdown снапшота) |
| GET | `/api/portfolio/pnl?accountId=&from=&to=` | `{realizedTradingBaseMinor, income:{dividendsBaseMinor, couponsBaseMinor, interestBaseMinor}, feesBaseMinor, unrealizedBaseMinor, totalBaseMinor, perAsset:[{assetId, symbol, realizedMinor, incomeMinor, unrealizedMinor, currency, ...BaseMinor}]}` |

Помилки: 400 (валідація), 404 `FX_RATE_NOT_FOUND` (немає жодного курсу для валюти).

### snapshots (`routes/snapshots.ts`)

| Метод | Шлях | Тіло → Відповідь |
|---|---|---|
| GET | `/api/snapshots?from=&to=` | `{items:[{snapshotDate, totalMinor, baseCurrency, breakdown}]}` |
| POST | `/api/snapshots/run` | `{date?}` (деф. сьогодні Kyiv) → `{snapshot}` (upsert) |
| POST | `/api/snapshots/rebuild` | `{from, to}` → `{count}` (послідовний прерахунок діапазону з історичних цін/курсів) |

### dashboards (`routes/dashboards.ts`)

| Метод | Шлях | Відповідь |
|---|---|---|
| GET | `/api/dashboards/networth-series?from=&to=` | `{points:[{date, totalMinor}], baseCurrency}` — зі снапшотів, без інтерполяції пропусків |
| GET | `/api/dashboards/cashflow?from=&to=&groupBy=month\|quarter\|year` | `{periods:[{period:"2026-06", depositsMinor, withdrawalsMinor, dividendsMinor, couponsMinor, interestMinor, feesMinor, netMinor}], baseCurrency}` — конвертація кожної транзакції за курсом її дати; transfer-пари ВИКЛЮЧЕНІ (внутрішні переміщення не псують кешфлоу) |

### export (`routes/export.ts`)

| Метод | Шлях | Відповідь |
|---|---|---|
| GET | `/api/export/transactions.csv?from=&to=&accountId=` | `text/csv; charset=utf-8` із BOM, RFC 4180. Колонки: `id, executed_at, account, asset_symbol, asset_type, type, quantity, price, currency, amount, fee, gross, withholding_tax, net, transfer_group_id, note` (суми — десяткові major units) |
| GET | `/api/export/positions.csv?date=` | Колонки: `account, asset_symbol, asset_type, currency, quantity, avg_cost, cost_basis, last_price, price_date, value, value_base, unrealized, unrealized_pct` |

### backup (`routes/backup.ts`)

| Метод | Шлях | Відповідь |
|---|---|---|
| GET | `/api/backup/dump` | Стрім `pg_dump -Fc` (custom format): `Bun.spawn(['pg_dump', '--format=custom', DATABASE_URL])`, stdout → response body; headers `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="statok-YYYYMMDD-HHmm.dump"`. Під auth. 500 якщо exit code ≠ 0 |

Потребує `pg_dump` у бекенд-образі: у `backend/Dockerfile` додати `RUN apk add --no-cache postgresql16-client`.

### settings / jobs (`routes/settings.ts`)

| Метод | Шлях | Відповідь |
|---|---|---|
| GET | `/api/settings` | `{baseCurrency, version, jobs:{prices:{lastRunAt,lastSuccessAt,lastStatus,lastError}, fx:{...}, snapshot:{...}}}` (read-only конфіг + стан із app_settings) |
| PUT | `/api/settings/:key` | `{value}` → `{key, value}` (generic; whitelist ключів, 400 поза ним) |

---

## 3. Сервіси (`backend/src/services/`)

### 3.1 valuation.ts — позиції з транзакцій (середньозважена собівартість)

`computePortfolioState(userId, { accountId?, atDate? }): { positions, cash, realized }` — єдиний fold, який використовують positions/pnl/snapshot.

**Алгоритм** (детермінований, повторюваний):

1. Вибрати транзакції скоупу: `WHERE user_id = ? [AND account_id = ?] AND executed_at < (atDate+1day у Kyiv)`. Сортування: `executed_at ASC, created_at ASC, id ASC` (стабільний tie-break).
2. Стан: `pos: Map<(accountId, assetId), {qty: Decimal, costBasisMinor: number}>` (лише не-cash активи); `cash: Map<(accountId, currency), number>`; `realized: Map<(accountId, assetId), number>` (у валюті активу). Уся qty-арифметика — bigint fixed-point scale 18 (`packages/shared/decimal.ts`), без float.
3. Для кожної транзакції за порядком:
   - **buy**: `qty += quantity`; `costBasis += amountMinor + feeMinor`; `cash[currency] -= amountMinor + feeMinor`.
   - **sell**: `costPart = roundHalfUp(costBasis × quantity / qtyHeld)` (bigint-пропорція); `realized += (amountMinor − feeMinor) − costPart`; `costBasis −= costPart`; `qty −= quantity`; `cash[currency] += amountMinor − feeMinor`. (Оверселл неможливий — відсічений на записі, §1.6.)
   - **deposit**: `cash += amountMinor`. **withdraw**: `cash −= amountMinor`.
   - **transfer_in**: `cash += amountMinor`. **transfer_out**: `cash −= amountMinor`.
   - **dividend / coupon / interest**: `cash[currency] += netMinor`. Позицію/собівартість не чіпає.
   - **split**: `qty ×= quantity` (множник; reverse split — дробовий множник, напр. 0.1). `costBasis` незмінний (середня ціна масштабується неявно). Застосовується з дати транзакції — тобто просто у хронологічному fold-і.
   - **ticker_change**: no-op для математики (історія цін і позиція лишаються на тому ж asset_id).
   - **opening_balance (актив)**: `qty += quantity`; `costBasis += amountMinor`, якщо `amountMinor IS NULL` → `costBasis += roundHalfUp(quantity × quoteAt(assetId, date))` (останнє котирування ≤ дати), а якщо котирування немає взагалі → `+= 0` і позиція позначається `costBasisIncomplete: true` у DTO.
   - **opening_balance (кеш)**: `cash[currency] += amountMinor`.
4. Викинути позиції з `qty == 0` (повністю продані; їх realized лишається у звіті P&L).
5. **Оцінка** (для positions/valuation/snapshot): для кожної позиції — `lastPrice = price_quotes` останній `quote_date ≤ atDate`; для bond без котирування — fallback **номінал** (clean price = face value; НКД у v1 не нараховуємо); для stock/etf/crypto без котирування — позиція без оцінки (`valueMinor: null`, у тотали не входить, UI показує warning). `valueMinor = roundHalfUp(qty × lastPrice)` у валюті активу. Cash: `valueMinor = balanceMinor`, ціна тотожно 1.
6. Конвертація в базову валюту — через fx-сервіс (§3.4) за курсом на `atDate` (із fallback «останній попередній»).
7. `unrealizedMinor = valueMinor − costBasisMinor`; `avgCostMinor = roundHalfUp(costBasis / qty)`.

Перфоманс: single-user, повний fold по всіх транзакціях (десятки тисяч рядків макс.) — рахується на льоту на кожен запит, без кешу. Індекси §1.6 покривають вибірки.

### 3.2 pnl.ts — realized / unrealized

- **Realized trading** за період `[from, to]`: окремий fold §3.1 по ПОВНІЙ історії (собівартість тягнеться з початку часів), але в `realized` акумулюються лише sell-и, чиї `executed_at ∈ [from, to]`. Конвертація в базову — за курсом **дати кожного sell**.
- **Income**: сума `netMinor` по dividend/coupon/interest за період, конвертація за курсом дати виплати. Окремі підсумки за типами.
- **Fees**: сума `feeMinor` за період (довідково; вони вже враховані у собівартості/виручці).
- **Unrealized**: із поточного стану (§3.1, кроки 5–7), за поточним курсом.
- `totalBaseMinor = realizedTrading + incomeTotal + unrealized`.

### 3.3 bond.ts — купонний розклад і дохідності

- **`couponSchedule(bond): {date, amountMinor}[]`** — генерація від `maturityDate` НАЗАД кроком `12 / couponFrequency` місяців до `issueDate` (або до найранішої транзакції по активу, якщо issueDate NULL; ліміт 50 років). Дата виплати = календарна дата без бізнес-день-зсувів (спрощення v1). `amountMinor = roundHalfUp(faceValueMinor × couponRatePercent / 100 / couponFrequency)`. Zero-coupon (`frequency=0`) → розклад порожній, лише погашення. Розклад — **обчислюваний, read-only**: транзакції `coupon` користувач вносить сам (UI може пропонувати «записати купон» з розкладу — поза цим документом).
- **`currentYield(bond, cleanPrice)`** = `(faceValue × rate%) / cleanPrice` (річний купон / поточна ціна).
- **`ytm(bond, cleanPrice, settlementDate)`** — **ітеративний Newton–Raphson** по рівнянню ціни: `P = Σ C/(1+y/f)^(f·t_i) + F/(1+y/f)^(f·t_n)`, де `C` — купон за період, `f` — частота, `t_i` — роки до i-ї виплати (ACT/365F від settlementDate), `F` — номінал. Початкове наближення — current yield; похідна аналітична; максимум 100 ітерацій, толеранс `1e-10` по ціні. Якщо розбіжність/вихід за межі — fallback **бісекція** на `y ∈ [−0.9999, 10]` (200 ітерацій). Повертає річний відсоток. Обчислюється у float (метрика відображення, не грошова величина — точності double достатньо).
- **`processMaturedBonds(today)`** — авто-погашення: для кожного bond із `maturityDate ≤ today` і залишковою qty > 0 на рахунку (за fold-ом) → створити `sell` транзакцію: `quantity = весь залишок`, `price = faceValue`, `amountMinor = roundHalfUp(qty × faceValue)`, `fee 0`, `executedAt = maturityDate 12:00 Europe/Kyiv`, `meta {"autoRedemption": true}`. Ідемпотентність: пропустити, якщо qty вже 0. Викликається в EOD-пайплайні (§4.4) і при ручному `POST /api/snapshots/run`.

### 3.4 fx.ts — конвертація з fallback

`convert(amountMinor, from, to, date): {amountMinor, rateUsed, rateDate}`:

1. `from === to` → identity.
2. `resolveRate(from, to, date)`:
   a. прямий рядок `(from, to)` з максимальним `rate_date ≤ date` (це і є **fallback «останній попередній курс»** — вихідні/свята/пропуски);
   b. інакше зворотний `(to, from)` → `1 / rate`;
   c. інакше pivot через USD: `resolveRate(from,'USD') × resolveRate('USD',to)` (лише один рівень рекурсії, кроки a–b);
   d. нічого → `FX_RATE_NOT_FOUND` (404 в API; у снапшоті — фейл джоби з лог-записом).
3. `result = roundHalfUp(amountMinor × rate)` — множення через bigint fixed-point (rate scale 8).

Manual-курси беруть участь нарівні (унікальність по парі+даті — рядок один).

### 3.5 snapshot.ts

`runSnapshot(date)`: викликає `computePortfolioState(atDate=date)` + оцінку за цінами/курсами на `date` → агрегує `byAccount` / `byClass` / `byCurrency` (усе в базовій валюті) → upsert `net_worth_snapshots` по `(userId, snapshotDate)`. `rebuild(from, to)` — цикл по датах послідовно.

---

## 4. Фонові джоби (`backend/src/jobs/`, патерн tardis)

Патерн tardis: **in-process таймери** (`setTimeout`/`setInterval`), функції `startXJob()/stopXJob()`, guard `running` від накладання, запуск із `index.ts` після migrate/seed. Без зовнішніх cron-бібліотек.

Statok додає хелпер `lib/scheduleDaily.ts`: `scheduleDailyAt(hhmm, tz, fn)` — обчислює мс до наступного `hhmm` у TZ `Europe/Kyiv` (через `Intl.DateTimeFormat(..., {timeZone})`), ставить `setTimeout`, після виконання — переобчислює і переставляє (DST-safe, бо наступний запуск рахується заново щоразу).

**Розклад EOD-пайплайна: щодня 23:30 Europe/Kyiv** — одна точка входу `runEodPipeline()`:
`syncPrices → syncFxRates → processMaturedBonds → dailySnapshot` (послідовно; помилка кроку логується, пайплайн продовжує — снапшот рахується з останніх наявних даних). Чому 23:30: NYSE закривається 23:00 Kyiv (різниця з NY стабільно 7 год), ECB-фіксінг ~17:00 Kyiv, НБУ ~15:30 Kyiv — на 23:30 усі джерела готові. Catch-up: на старті бекенда, якщо `app_settings['eod.lastSuccessDate']` старіша за вчора — одноразовий запуск пайплайна через 60 с після boot.

**Ретраї**: хелпер `withRetry(fn, {attempts: 3, baseDelayMs: 1000, factor: 4})` → паузи 1s / 4s / 16s + джиттер ±20%. Застосовується до кожного HTTP-запиту окремо. Після фінальної невдачі — запис у `app_settings['job.*'].lastError`, лог `error`, виняток НЕ валить процес.

### 4.1 syncPrices.ts — Yahoo unofficial chart API

- Скоуп: активи `type IN ('stock','etf','crypto') AND price_source = 'yahoo' AND archived_at IS NULL`.
- Запит на символ: `GET https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=7d`
  (range 7d — щоб добрати пропущені дні після даунтайму). Fallback-хост при HTTP-помилці: `query2.finance.yahoo.com`. Обовʼязковий header `User-Agent: Mozilla/5.0 (compatible; Statok/1.0)` (без нього Yahoo віддає 429/403). Між символами — пауза 500 мс (rate-limit ввічливості).
- **Парсинг відповіді**:
  ```
  body.chart.error            → не null ⇒ помилка символу (лог, далі)
  r = body.chart.result[0]
  r.meta.currency             → валюта котирувань; якщо ≠ assets.currency — warn-лог, котирування пишемо у валюті meta.currency
  r.meta.exchangeTimezoneName → TZ біржі (напр. "America/New_York")
  r.timestamp[i]              → unix-секунди відкриття сесії; quote_date = дата timestamp у TZ біржі
  r.indicators.quote[0].close[i] → ціна закриття; null-елементи пропускати
  ```
  Для кожної пари (quote_date, close ≠ null): upsert у `price_quotes` із `source='yahoo'`, `ON CONFLICT (asset_id, quote_date) DO UPDATE SET price=..., updated_at=now() WHERE price_quotes.source <> 'manual'` — **manual-рядки недоторканні**.
- Підсумок: лог `prices.sweep_done {okCount, errCount, durationMs}`; стан → `app_settings['job.prices']`.

### 4.2 syncFxRates.ts — Frankfurter + НБУ

Потрібні валюти: `needed = distinct(assets.currency) ∪ {BASE_CURRENCY, 'UAH', 'USD', 'EUR'}`.

**Frankfurter** (ECB reference rates; UAH у наборі НЕМАЄ — тому НБУ обовʼязковий):
- Основний хост: `GET https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP,...` (needed мінус USD/UAH).
- Запасний хост (legacy, той самий сервіс): `GET https://api.frankfurter.app/latest?base=USD&symbols=...` — використовується при мережевій/HTTP-помилці основного.
- Відповідь: `{"amount":1.0, "base":"USD", "date":"2026-06-10", "rates":{"EUR":0.9234, ...}}`. Маппінг: для кожного `(ccy, rate)` → upsert `fx_rates (rate_date=body.date, base_ccy='USD', quote_ccy=ccy, rate, source='frankfurter')`. У вихідні `date` = остання пʼятниця — upsert тієї дати (натуральний fallback).

**НБУ** (офіційний курс гривні):
- `GET https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json` — масив обʼєктів:
  ```
  {"r030":840, "txt":"Долар США", "rate":41.8932, "cc":"USD", "exchangedate":"11.06.2026"}
  ```
  Маппінг: фільтр `cc ∈ needed`; `rate` = UAH за 1 одиницю валюти (JSON-API вже нормалізований до 1); `exchangedate` — формат `dd.MM.yyyy` → `rate_date`; upsert `fx_rates (rate_date, base_ccy=cc, quote_ccy='UAH', rate, source='nbu')`.
- Обидва джерела незалежні: фейл одного не блокує інший.

### 4.3 dailySnapshot.ts

Крок пайплайна після цін/курсів (і після `processMaturedBonds`): `runSnapshot(todayKyiv)` (§3.5). Успіх → `app_settings['eod.lastSuccessDate'] = today`. Ручні тригери — `POST /api/snapshots/run|rebuild` викликають той самий сервіс.

### 4.4 index.ts wiring

```ts
// після runMigrations() + seedAdmin():
startEodPipelineJob()   // scheduleDailyAt('23:30','Europe/Kyiv', runEodPipeline) + boot catch-up
```

---

## 5. Бекапи

### 5.1 Нічний дамп (host cron на VPS)

**Механіка** — cron користувача root на VPS (`crontab -e`), щодня 03:30:

```cron
30 3 * * * /opt/statok/backup.sh >> /var/log/statok-backup.log 2>&1
```

`/opt/statok/backup.sh` (постачається в `scripts/`, копіюється при bootstrap-і):

```sh
#!/bin/sh
set -eu
STAMP=$(date +%Y%m%d-%H%M)
DIR=/opt/statok/backups
mkdir -p "$DIR"
# 1) дамп із контейнера (custom format — компактний, відновлення pg_restore)
docker exec statok-postgres-1 pg_dump -U statok -Fc statok > "$DIR/statok-$STAMP.dump"
# 2) шифрування age (публічний ключ — секрети не потрібні на диску)
age -r "$AGE_RECIPIENT" -o "$DIR/statok-$STAMP.dump.age" "$DIR/statok-$STAMP.dump"
rm "$DIR/statok-$STAMP.dump"
# 3) у віддалений сторедж (Backblaze B2 / S3) через rclone
rclone copy "$DIR/statok-$STAMP.dump.age" "$RCLONE_REMOTE:statok-backups/"
# 4) ротація: локально 14 останніх, віддалено 30 днів
ls -1t "$DIR"/statok-*.dump.age | tail -n +15 | xargs -r rm
rclone delete --min-age 30d "$RCLONE_REMOTE:statok-backups/"
```

Змінні `AGE_RECIPIENT` і `RCLONE_REMOTE` — у `/opt/statok/backup.env`, сорситься на початку скрипта (`. /opt/statok/backup.env`). Чому host cron, а не sidecar-контейнер: окремий cron-контейнер додає ще один образ, доступ до docker.sock/мережі БД і власний життєвий цикл — а host cron це один рядок, який працює навіть коли compose-стек лежить чи перезапускається.

### 5.2 Кнопка в UI

`GET /api/backup/dump` (§2 backup) — бекенд стрімить `pg_dump -Fc` напряму по `DATABASE_URL` (pg_dump встановлений у бекенд-образ через `apk add postgresql16-client`). Файл нешифрований (юзер сам зберігає куди хоче), під auth.

Відновлення (документувати в `infra/README.md`): `age -d` → `pg_restore -U statok -d statok --clean --if-exists`.

---

## 6. Структура монорепо

За blueprint §3, конкретизація `src/`:

```
statok/
  package.json                  # name, version (єдине джерело версії), scripts: release:*
  docker-compose.dev.yml        # лише Postgres 16-alpine, порт 5434:5432
  deploy.sh
  CLAUDE.md / README.md / CICD.md / ARCHITECTURE.md
  scripts/
    release.mjs                 # bump root+backend+frontend, tag vX.Y.Z, push
    backup.sh                   # див. §5.1 (копіюється на VPS)
  packages/
    shared/                     # "@statok/shared", main: src/index.ts (без build-степу, як у tardis)
      package.json
      src/
        index.ts
        dto.ts                  # типи API-відповідей/запитів (Account, Asset, Transaction, Position, ...)
        money.ts                # minorToDisplay(minor, ccy), displayToMinor(str, ccy),
                                # formatMoney(minor, ccy, locale) через Intl.NumberFormat,
                                # MINOR_DIGITS: Record<string, number> (деф. 2), roundHalfUp
        decimal.ts              # bigint fixed-point: parseDec(str, scale), mulToMinor(qty, price, ccy),
                                # proportionMinor(totalMinor, part, whole) — для cost basis
        enums.ts                # AssetType, TransactionType, ... (дзеркало pgEnum)
  backend/
    Dockerfile                  # oven/bun:1.2-alpine + RUN apk add --no-cache postgresql16-client
    package.json                # "statok-backend"; dev/start/db:generate; dep "@statok/shared": "workspace:*"
    drizzle.config.ts
    .env.dev                    # committed, дамі-секрети (див. §8)
    drizzle/                    # згенеровані SQL-міграції
    src/
      index.ts                  # Hono app: onError, cors, secureHeaders, роути; start(): migrate→seed→jobs
      db/{index.ts, schema.ts, migrate.ts}
      routes/{auth,health,accounts,assets,transactions,prices,fx,portfolio,snapshots,dashboards,export,backup,settings}.ts
      services/{valuation,pnl,bond,fx,snapshot,cashAssets}.ts
      jobs/{eodPipeline.ts, syncPrices.ts, syncFxRates.ts, dailySnapshot.ts}
      lib/{jwt.ts, password.ts, seed.ts, version.ts, logger.ts, scheduleDaily.ts, retry.ts, rateLimit.ts, csv.ts}
      middleware/{auth.ts, requestContext.ts}
  frontend/
    Dockerfile                  # Bun-білд (нижче) → nginx:stable-alpine
    nginx.conf                  # SPA fallback + gzip + security headers (§9)
    package.json                # "statok-ui"; dep "@statok/shared": "workspace:*"
    vite.config.ts              # port 5273, __APP_VERSION__, @ alias, vite-plugin-pwa
    src/ (див. §7)
  infra/
    docker-compose.yml          # prod (blueprint §4b)
    README.md                   # bootstrap + restore-процедура
  .github/workflows/            # release/build-backend/build-frontend/deploy (blueprint, не дублюємо)
```

Workspaces: root `package.json` → `"workspaces": ["backend", "frontend", "packages/*"]`; `bun install` лінкує `@statok/shared` без build-степу (бекенд виконує TS напряму, фронт збирає Vite).

**frontend/Dockerfile — Bun усюди** (відхилення від tardis npm, зафіксоване рішення):

```dockerfile
FROM oven/bun:1.2-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN bun run build

FROM nginx:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

(Контекст білда — корінь репо з `-f frontend/Dockerfile`, щоб у нього потрапив `packages/shared`; шляхи COPY відповідно `frontend/package.json` тощо — деталь для CI, фіксується у build-workflow.)

**Dev-порти**: Postgres `5434`, бекенд `3100` (PORT у .env.dev), Vite `5273` (`server.port` у vite.config.ts).

---

## 7. Фронтенд-архітектура (Vue 3 + Vite + TS)

### 7.1 Роути (`src/router/index.ts`, історія `createWebHistory`)

| Шлях | Назва | Компонент | Доступ |
|---|---|---|---|
| `/login` | login | LoginPage | public |
| `/` | — | redirect → `/dashboard` | auth |
| `/dashboard` | dashboard | DashboardPage (net worth графік + cashflow) | auth |
| `/accounts` | accounts | AccountsPage (список + баланси) | auth |
| `/accounts/:id` | account-detail | AccountDetailPage (позиції + кеш + транзакції рахунку) | auth |
| `/transactions` | transactions | TransactionsPage (журнал + фільтри + форми вводу) | auth |
| `/assets` | assets | AssetsPage (довідник активів, bond-деталі, ціни/ручне редагування) | auth |
| `/settings` | settings | SettingsPage (тема, мова, стан джоб, sync-кнопки, бекап) | auth |

Guard як у tardis: `router.beforeEach` перевіряє токен у localStorage (`statok_token`), `meta: {public: true}` лише в login. Сторінки — lazy `() => import(...)`.

### 7.2 Стейт — composables, без Pinia

Як у tardis: модульні `ref`-и + composables (`src/composables/useAccounts.ts`, `useAssets`, `useTransactions`, `usePortfolio`, `useDashboards`, `useAuth`, `useTheme`, `useLocale`); Pinia не береться, бо tardis обходиться composables і для single-user застосунку без складних кросс-сторових залежностей це нуль додаткових залежностей за ту саму функціональність. HTTP — `src/services/api.ts`: копія tardis `apiFetch` (Bearer із localStorage, 401 → редірект на /login), `API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3100'`.

### 7.3 i18n, тема, компоненти

- **vue-i18n**: локалі `src/locales/{uk,en}.json`, `locale: 'uk'`, `fallbackLocale: 'en'`, вибір персистується в localStorage. Формат валют/чисел — через `formatMoney` із `@statok/shared` (Intl), не через i18n number formats.
- **Тема**: `@vitaliysimkin/t-components` → `applyTheme('light'|'dark'|'auto')` на CSS variables (патерн tardis `useTheme`); перемикач у Settings; 'auto' слідує `prefers-color-scheme`.
- **UI-кіт**: `@vitaliysimkin/t-components`; іконки — ТІЛЬКИ `system-uicons` (правило tardis CLAUDE.md).

### 7.4 Графіки — uPlot

**uPlot** (`uplot` + офіційний Vue-враппер не потрібен — тонка власна обгортка-компонент): ~12 KB gzip проти ~70 KB у Chart.js, canvas-рендер швидкий на довгих денних серіях, і обидва графіки v1 (лінія net worth, бари cashflow через `uPlot.paths.bars`) він покриває. Компоненти: `components/charts/{NetWorthChart.vue, CashflowChart.vue}` — приймають дані з dashboards-ендпоінтів, кольори тягнуть із CSS variables теми.

### 7.5 PWA — vite-plugin-pwa

```ts
VitePWA({
  registerType: 'autoUpdate',
  manifest: { name: 'Statok', short_name: 'Statok', display: 'standalone',
              theme_color: '#111418', background_color: '#111418', icons: [192, 512, maskable] },
  workbox: {
    navigateFallback: '/index.html',          // app shell: precache всіх build-асетів (за замовчуванням)
    navigateFallbackDenylist: [/^\/api\//, /^\/auth\//, /^\/health$/],
    runtimeCaching: [{
      urlPattern: ({url, request}) => request.method === 'GET' && url.pathname.startsWith('/api/'),
      handler: 'NetworkFirst',                // network-first для API
      options: { cacheName: 'statok-api', networkTimeoutSeconds: 4,
                 expiration: { maxAgeSeconds: 86400 } },
    }],
  },
})
```

Мутації (POST/PUT/DELETE) не кешуються і не реплеяться офлайн (background sync — поза v1). `GET /api/backup/dump` — виключити з runtime-кеша (binary stream): додати в denylist патерна (`!url.pathname.startsWith('/api/backup')`).

---

## 8. Конфіг / ENV

### 8.1 `backend/.env.dev` (committed, дамі-значення)

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/statok
JWT_SECRET=dev-secret-change-me-minimum-32-chars!!
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
BASE_CURRENCY=USD
PORT=3100
TZ=Europe/Kyiv
CORS_ORIGINS=http://localhost:5273
```

### 8.2 Прод `.env` (ЛИШЕ на VPS, `/opt/statok/.env`; ніколи в репо)

```env
STATOK_VERSION=                # пише deploy-пайплайн (sed)
DATABASE_URL=postgresql://statok:<pw>@postgres:5432/statok
POSTGRES_PASSWORD=<pw>         # для контейнера postgres у compose
JWT_SECRET=<random 64 hex>
ADMIN_USERNAME=<...>
ADMIN_PASSWORD=<...>
BASE_CURRENCY=USD
PORT=3000
TZ=Europe/Kyiv
CORS_ORIGINS=https://statok.simk.in.ua
```

### 8.3 Інше

- `VITE_API_URL=https://api.statok.simk.in.ua` — build-arg фронтенд-образу (CI), НЕ runtime-env.
- `/opt/statok/backup.env` (VPS): `AGE_RECIPIENT=age1...`, `RCLONE_REMOTE=b2` (+ rclone config окремо через `rclone config`).
- Усе читається один раз на старті (`process.env`), валідація обовʼязкових ключів при boot — відсутній `JWT_SECRET`/`DATABASE_URL` → fatal exit із зрозумілим повідомленням. `BASE_CURRENCY` — ISO-код, деф. USD; зміна на льоту не підтримується (снапшоти зберігають свою валюту в рядку).

---

## 9. Безпека

- **JWT**: бібліотека `jose` (`SignJWT`/`jwtVerify`), HS256, секрет `JWT_SECRET` (мін. 32 байти, валідація на старті). Claims: `sub` (userId), `username`, `exp`. **TTL 7 діб** (паритет tardis). **Refresh-підхід — sliding re-issue**: `POST /auth/refresh` із ще валідним токеном повертає новий на 7 діб; фронтенд викликає його при старті застосунку. Окремих refresh-токенів і server-side ревокації нема — свідомий компроміс single-user self-hosted (логаут = видалення токена на клієнті).
- **Паролі**: `bcryptjs`, cost 10 (tardis). Один користувач, сід з env (§1.2). Зміна пароля — через зміну `ADMIN_PASSWORD`+перезапуск? НІ: сід не перезаписує існуючого юзера (патерн tardis); зміна пароля у v1 — вручну SQL-ом або пересідом (документувати в README; UI-зміна пароля — поза v1).
- **Rate-limit логіну**: in-memory (`lib/rateLimit.ts`, Map по `ip` із заголовка `x-forwarded-for` від Traefik): максимум **5 невдалих спроб за 15 хв** → 429 `RATE_LIMITED` + `Retry-After`. Скидання при успішному логіні. In-memory достатньо (один інстанс).
- **CORS** (hono/cors): `origin` — СТРОГО allowlist із `CORS_ORIGINS` (кома-сепарований; прод — лише `https://statok.simk.in.ua`), не echo-back як у tardis; `credentials: false` (auth через Bearer-header, кук нема); methods GET/POST/PUT/DELETE/OPTIONS; headers Content-Type/Authorization.
- **Security headers**:
  - Бекенд: `hono/secure-headers` з дефолтами (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` тощо).
  - Фронтенд `nginx.conf` (додатково до tardis-конфіга):
    ```nginx
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Content-Security-Policy "default-src 'self'; connect-src 'self' https://api.statok.simk.in.ua; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; manifest-src 'self'; worker-src 'self'" always;
    ```
    (TLS термінується Traefik-ом — HSTS-заголовок усе одно віддаємо з nginx.)
- **Поверхня**: жодних зовнішніх вихідних викликів, крім Yahoo/Frankfurter/НБУ (джоби) і Telegram (deploy-нотифікації CI, не рантайм). docker.sock у контейнери НЕ монтується (blueprint). `pg_dump`-ендпоінт — лише під auth, стрім без запису на диск.
- **Логи**: патерн tardis logger; у логи не потрапляють паролі/токени (login-лог пише лише username/ip/reason).
