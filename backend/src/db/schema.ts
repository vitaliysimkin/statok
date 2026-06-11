/**
 * Statok database schema — Postgres / Drizzle ORM.
 *
 * Canonical source: specs/statok-tz.md §7.1 (1.1–1.10). TS fragments here mirror
 * the spec exactly; column names are snake_case in the DB. Money is bigint minor
 * units (mode:'number'); quantities/prices/rates are numeric (travel as string in
 * JS) — all arithmetic via @statok/shared decimal helpers, never float.
 *
 * Covers: ST-006 (enums, users, accounts, assets, bond_details),
 *         ST-007 (transactions + full CHECK matrix),
 *         ST-008 (price_quotes, fx_rates, net_worth_snapshots, app_settings).
 */

import { sql } from 'drizzle-orm'
import {
  bigint,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// 1.1 Enums
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 1.2 users
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 255 }).unique().notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// 1.3 accounts
// ---------------------------------------------------------------------------

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  kind: accountKindEnum('kind').notNull().default('broker'),
  note: text('note').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  // Опційні поля депозитного рахунку (kind='bank'); інформаційні, без авто-нарахування % у v1
  interestRatePercent: numeric('interest_rate_percent', { precision: 8, scale: 4 }),
  termEndDate: date('term_end_date'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique('accounts_user_name_unique').on(t.userId, t.name),
])

// ---------------------------------------------------------------------------
// 1.4 assets
// ---------------------------------------------------------------------------

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
  check('assets_cash_symbol_check', sql`${t.type} <> 'cash' OR ${t.symbol} = ${t.currency}`),
])

// ---------------------------------------------------------------------------
// 1.5 bond_details (1:1 до assets, type=bond)
// ---------------------------------------------------------------------------

export const bondDetails = pgTable('bond_details', {
  assetId: uuid('asset_id').primaryKey().references(() => assets.id, { onDelete: 'cascade' }),
  faceValueMinor: bigint('face_value_minor', { mode: 'number' }).notNull(), // номінал 1 папера, у валюті активу
  couponRatePercent: numeric('coupon_rate_percent', { precision: 8, scale: 4 }).notNull(), // річна ставка, % (15.7500)
  couponFrequency: smallint('coupon_frequency').notNull(), // виплат/рік: 1|2|4|12; 0 = zero-coupon
  issueDate: date('issue_date'), // опційно (обрізає розклад зліва)
  maturityDate: date('maturity_date').notNull(),
  isin: varchar('isin', { length: 12 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check('bond_freq_check', sql`${t.couponFrequency} IN (0, 1, 2, 4, 12)`),
  check('bond_zero_coupon_check', sql`(${t.couponFrequency} = 0) = (${t.couponRatePercent} = 0)`),
  check('bond_face_positive_check', sql`${t.faceValueMinor} > 0`),
])

// ---------------------------------------------------------------------------
// 1.6 transactions
// ---------------------------------------------------------------------------

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
  check('tx_amount_nonneg_check', sql`${t.amountMinor} IS NULL OR ${t.amountMinor} >= 0`),
  check('tx_qty_positive_check', sql`${t.quantity} IS NULL OR ${t.quantity} > 0`),
  check('tx_fee_only_trade_check', sql`${t.type} IN ('buy','sell') OR ${t.feeMinor} = 0`),
  check('tx_transfer_group_check',
    sql`(${t.type} IN ('transfer_out','transfer_in')) = (${t.transferGroupId} IS NOT NULL)`),
  check('tx_income_fields_check', sql`
    ${t.type} NOT IN ('dividend','coupon','interest')
    OR (${t.grossMinor} IS NOT NULL AND ${t.withholdingTaxMinor} IS NOT NULL
        AND ${t.netMinor} = ${t.grossMinor} - ${t.withholdingTaxMinor})`),
  check('tx_trade_fields_check', sql`
    ${t.type} NOT IN ('buy','sell')
    OR (${t.quantity} IS NOT NULL AND ${t.price} IS NOT NULL AND ${t.amountMinor} IS NOT NULL)`),
])

// ---------------------------------------------------------------------------
// 1.7 price_quotes
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 1.8 fx_rates
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 1.9 net_worth_snapshots
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 1.10 app_settings
// ---------------------------------------------------------------------------

export const appSettings = pgTable('app_settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})
