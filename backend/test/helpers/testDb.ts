/**
 * testDb.ts — integration-test database harness (Postgres 5434, bun:test).
 *
 * Spins up a throwaway `statok_test` database, applies the real migrations via
 * the backend `runMigrations()`, and offers truncation + factory helpers used by
 * the domain-service integration tests (valuation / pnl / fx / bond redemption).
 *
 * SAFETY (critical) — the domain services import the singleton `db` from
 * backend/src/db/index.ts, which reads `process.env.DATABASE_URL` lazily on first
 * use. This helper:
 *   1. Forces `process.env.DATABASE_URL` onto the `statok_test` database BEFORE
 *      any db/service module is imported (consumers import THIS module first, and
 *      it sets the env at module-eval time, before re-exporting db lazily).
 *   2. Hard-asserts the active URL ends with `/statok_test` — if anything ever
 *      points the connection at the manager's `statok` database (smoke data), the
 *      harness throws instead of touching it.
 *
 * The admin connection (postgres database) is only used to DROP/CREATE the test
 * database and is closed immediately. The manager's `statok` database is NEVER
 * connected to.
 */

import postgres from 'postgres'

// ---------------------------------------------------------------------------
// Connection strings
// ---------------------------------------------------------------------------

const PG_HOST = process.env['TEST_PG_HOST'] ?? 'localhost'
const PG_PORT = process.env['TEST_PG_PORT'] ?? '5434'
const PG_USER = process.env['TEST_PG_USER'] ?? 'postgres'
const PG_PASSWORD = process.env['TEST_PG_PASSWORD'] ?? 'postgres'

const TEST_DB_NAME = 'statok_test'
const ADMIN_DB_NAME = 'postgres'

const adminUrl = `postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${ADMIN_DB_NAME}`
const testUrl = `postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${TEST_DB_NAME}`

/**
 * Force the connection target onto the test database at module-eval time. This
 * runs before consumers `import { db }` (transitively) because importing this
 * helper is the first thing the test files do — and the singleton in
 * backend/src/db/index.ts reads DATABASE_URL lazily.
 */
process.env['DATABASE_URL'] = testUrl
// BASE_CURRENCY drives pnl/fx base totals; pin it for deterministic tests.
process.env['BASE_CURRENCY'] = process.env['BASE_CURRENCY'] ?? 'USD'

/**
 * Guard: the live DATABASE_URL must point at `/statok_test`. Anything else (most
 * importantly the manager's `/statok`) means we are about to operate on the wrong
 * database — abort hard.
 */
export function assertTestDatabase(): void {
  const url = process.env['DATABASE_URL'] ?? ''
  if (!/\/statok_test(\?|$)/.test(url)) {
    throw new Error(
      `testDb SAFETY ABORT: DATABASE_URL must target /statok_test, got ${JSON.stringify(url)}`,
    )
  }
}

assertTestDatabase()

// ---------------------------------------------------------------------------
// Lifecycle: (re)create database + migrate
// ---------------------------------------------------------------------------

/**
 * DROP + CREATE the `statok_test` database via the admin (postgres) connection,
 * then apply the real backend migrations. Idempotent across runs. The admin
 * connection never touches the manager's `statok` database.
 */
export async function setupTestDatabase(): Promise<void> {
  assertTestDatabase()

  const admin = postgres(adminUrl, { max: 1 })
  try {
    // Terminate any stale connections to the test DB so DROP can proceed.
    await admin.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = '${TEST_DB_NAME}' AND pid <> pg_backend_pid()`,
    )
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`)
    await admin.unsafe(`CREATE DATABASE ${TEST_DB_NAME}`)
  } finally {
    await admin.end({ timeout: 5 })
  }

  // runMigrations reads process.env.DATABASE_URL (already pinned to statok_test).
  const { runMigrations } = await import('../../src/db/migrate.ts')
  await runMigrations()
}

/**
 * Drop the test database (admin connection). Optional teardown — the next run's
 * setup drops it anyway, so tests can also just leave it in place.
 */
export async function dropTestDatabase(): Promise<void> {
  const admin = postgres(adminUrl, { max: 1 })
  try {
    await admin.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = '${TEST_DB_NAME}' AND pid <> pg_backend_pid()`,
    )
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`)
  } finally {
    await admin.end({ timeout: 5 })
  }
}

// ---------------------------------------------------------------------------
// Singleton db handle (the SAME instance the services use)
// ---------------------------------------------------------------------------

/**
 * Return the application's singleton drizzle handle. Dynamic import guarantees
 * the env is pinned to statok_test before backend/src/db/index.ts evaluates.
 */
export async function getDb(): Promise<(typeof import('../../src/db/index.ts'))['db']> {
  assertTestDatabase()
  const mod = await import('../../src/db/index.ts')
  return mod.db
}

/** Raw postgres client (same singleton) for low-level truncation. */
export async function getSql(): Promise<(typeof import('../../src/db/index.ts'))['sql']> {
  assertTestDatabase()
  const mod = await import('../../src/db/index.ts')
  return mod.sql
}

/**
 * Truncate all domain tables between tests (RESTART IDENTITY, CASCADE). Order is
 * irrelevant with CASCADE; users included so each test starts from a clean slate.
 */
export async function truncateAll(): Promise<void> {
  assertTestDatabase()
  const sql = await getSql()
  await sql.unsafe(`
    TRUNCATE TABLE
      transactions,
      price_quotes,
      fx_rates,
      bond_details,
      net_worth_snapshots,
      app_settings,
      assets,
      accounts,
      users
    RESTART IDENTITY CASCADE
  `)
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string
  username: string
}

let userSeq = 0

/** Insert a user; username auto-unique unless provided. */
export async function makeUser(username?: string): Promise<UserRow> {
  const sql = await getSql()
  const name = username ?? `tester-${++userSeq}-${Date.now()}`
  const rows = await sql<{ id: string; username: string }[]>`
    INSERT INTO users (username, password_hash)
    VALUES (${name}, ${'x'})
    RETURNING id, username
  `
  const row = rows[0]
  if (!row) throw new Error('makeUser: insert returned no row')
  return { id: row.id, username: row.username }
}

export interface AccountRow {
  id: string
  name: string
}

let accountSeq = 0

export async function makeAccount(
  userId: string,
  opts: { name?: string; kind?: string } = {},
): Promise<AccountRow> {
  const sql = await getSql()
  const name = opts.name ?? `acct-${++accountSeq}`
  const kind = opts.kind ?? 'broker'
  const rows = await sql<{ id: string; name: string }[]>`
    INSERT INTO accounts (user_id, name, kind)
    VALUES (${userId}, ${name}, ${kind})
    RETURNING id, name
  `
  const row = rows[0]
  if (!row) throw new Error('makeAccount: insert returned no row')
  return { id: row.id, name: row.name }
}

export interface AssetRow {
  id: string
  type: string
  symbol: string
  currency: string
}

let assetSeq = 0

export interface StockAssetOpts {
  symbol?: string
  currency?: string
  type?: 'stock' | 'etf' | 'crypto'
  priceSource?: 'yahoo' | 'manual'
  name?: string
}

/** stock/etf/crypto asset. */
export async function makeStock(userId: string, opts: StockAssetOpts = {}): Promise<AssetRow> {
  const sql = await getSql()
  const type = opts.type ?? 'stock'
  const symbol = opts.symbol ?? `STK${++assetSeq}`
  const currency = opts.currency ?? 'USD'
  const priceSource = opts.priceSource ?? 'yahoo'
  const rows = await sql<{ id: string; type: string; symbol: string; currency: string }[]>`
    INSERT INTO assets (user_id, type, symbol, name, currency, price_source)
    VALUES (${userId}, ${type}, ${symbol}, ${opts.name ?? symbol}, ${currency}, ${priceSource})
    RETURNING id, type, symbol, currency
  `
  const row = rows[0]
  if (!row) throw new Error('makeStock: insert returned no row')
  return row
}

export interface CashAssetRow extends AssetRow {}

/** cash asset (symbol = currency, price_source = manual). */
export async function makeCash(userId: string, currency = 'USD'): Promise<CashAssetRow> {
  const sql = await getSql()
  const rows = await sql<{ id: string; type: string; symbol: string; currency: string }[]>`
    INSERT INTO assets (user_id, type, symbol, name, currency, price_source)
    VALUES (${userId}, ${'cash'}, ${currency}, ${currency}, ${currency}, ${'manual'})
    RETURNING id, type, symbol, currency
  `
  const row = rows[0]
  if (!row) throw new Error('makeCash: insert returned no row')
  return row
}

export interface BondAssetOpts {
  symbol?: string
  currency?: string
  faceValueMinor: number
  couponRatePercent: number | string
  couponFrequency: number
  maturityDate: string
  issueDate?: string | null
  isin?: string | null
  priceSource?: 'yahoo' | 'manual'
}

export interface BondAssetRow extends AssetRow {
  faceValueMinor: number
  maturityDate: string
}

/** bond asset + bond_details (atomic). */
export async function makeBond(userId: string, opts: BondAssetOpts): Promise<BondAssetRow> {
  const sql = await getSql()
  const symbol = opts.symbol ?? `UA${1000000000 + ++assetSeq}`
  const currency = opts.currency ?? 'UAH'
  const priceSource = opts.priceSource ?? 'manual'
  return await sql.begin(async (tx) => {
    const assetRows = await tx<{ id: string; type: string; symbol: string; currency: string }[]>`
      INSERT INTO assets (user_id, type, symbol, name, currency, price_source)
      VALUES (${userId}, ${'bond'}, ${symbol}, ${symbol}, ${currency}, ${priceSource})
      RETURNING id, type, symbol, currency
    `
    const asset = assetRows[0]
    if (!asset) throw new Error('makeBond: asset insert returned no row')
    await tx`
      INSERT INTO bond_details
        (asset_id, face_value_minor, coupon_rate_percent, coupon_frequency, issue_date, maturity_date, isin)
      VALUES
        (${asset.id}, ${opts.faceValueMinor}, ${String(opts.couponRatePercent)},
         ${opts.couponFrequency}, ${opts.issueDate ?? null}, ${opts.maturityDate}, ${opts.isin ?? null})
    `
    return {
      ...asset,
      faceValueMinor: opts.faceValueMinor,
      maturityDate: opts.maturityDate,
    }
  })
}

// ---------------------------------------------------------------------------
// Transaction factory — thin wrapper over a raw insert (bypasses route
// validation on purpose: tests construct exactly the rows the fold must handle).
// ---------------------------------------------------------------------------

export interface TxInput {
  userId: string
  accountId: string
  assetId: string
  type: string
  executedAt: string | Date
  quantity?: string | number | null
  price?: string | number | null
  amountMinor?: number | null
  currency: string
  feeMinor?: number
  grossMinor?: number | null
  withholdingTaxMinor?: number | null
  netMinor?: number | null
  transferGroupId?: string | null
  note?: string
  meta?: unknown
  createdAt?: string | Date | null
}

export interface TxRow {
  id: string
}

/** Insert one transaction row directly. Returns its id. */
export async function makeTx(input: TxInput): Promise<TxRow> {
  const sql = await getSql()
  // Pass timestamps as ISO strings — the raw postgres tagged-template binder in
  // this setup does not accept JS Date objects for timestamptz parameters.
  const executedAt = (input.executedAt instanceof Date ? input.executedAt : new Date(input.executedAt)).toISOString()
  const createdAt =
    input.createdAt == null
      ? null
      : (input.createdAt instanceof Date ? input.createdAt : new Date(input.createdAt)).toISOString()

  const meta = input.meta == null ? null : sql.json(input.meta as never)

  const rows = createdAt
    ? await sql<{ id: string }[]>`
        INSERT INTO transactions (
          user_id, account_id, asset_id, type, executed_at,
          quantity, price, amount_minor, currency, fee_minor,
          gross_minor, withholding_tax_minor, net_minor,
          transfer_group_id, note, meta, created_at
        )
        VALUES (
          ${input.userId}, ${input.accountId}, ${input.assetId}, ${input.type}, ${executedAt},
          ${input.quantity == null ? null : String(input.quantity)},
          ${input.price == null ? null : String(input.price)},
          ${input.amountMinor ?? null}, ${input.currency}, ${input.feeMinor ?? 0},
          ${input.grossMinor ?? null}, ${input.withholdingTaxMinor ?? null}, ${input.netMinor ?? null},
          ${input.transferGroupId ?? null}, ${input.note ?? ''}, ${meta}, ${createdAt}
        )
        RETURNING id
      `
    : await sql<{ id: string }[]>`
        INSERT INTO transactions (
          user_id, account_id, asset_id, type, executed_at,
          quantity, price, amount_minor, currency, fee_minor,
          gross_minor, withholding_tax_minor, net_minor,
          transfer_group_id, note, meta
        )
        VALUES (
          ${input.userId}, ${input.accountId}, ${input.assetId}, ${input.type}, ${executedAt},
          ${input.quantity == null ? null : String(input.quantity)},
          ${input.price == null ? null : String(input.price)},
          ${input.amountMinor ?? null}, ${input.currency}, ${input.feeMinor ?? 0},
          ${input.grossMinor ?? null}, ${input.withholdingTaxMinor ?? null}, ${input.netMinor ?? null},
          ${input.transferGroupId ?? null}, ${input.note ?? ''}, ${meta}
        )
        RETURNING id
      `
  const row = rows[0]
  if (!row) throw new Error('makeTx: insert returned no row')
  return { id: row.id }
}

/** Insert a price quote for an asset (asset currency by default). */
export async function makeQuote(
  assetId: string,
  quoteDate: string,
  price: string | number,
  currency: string,
  source: 'yahoo' | 'manual' = 'manual',
): Promise<void> {
  const sql = await getSql()
  await sql`
    INSERT INTO price_quotes (asset_id, quote_date, price, currency, source)
    VALUES (${assetId}, ${quoteDate}, ${String(price)}, ${currency}, ${source})
    ON CONFLICT (asset_id, quote_date) DO UPDATE SET price = EXCLUDED.price, currency = EXCLUDED.currency, source = EXCLUDED.source
  `
}

/** Insert an fx rate row: 1 baseCcy = rate quoteCcy on rateDate. */
export async function makeFxRate(
  rateDate: string,
  baseCcy: string,
  quoteCcy: string,
  rate: string | number,
  source: 'frankfurter' | 'nbu' | 'manual' = 'frankfurter',
): Promise<void> {
  const sql = await getSql()
  await sql`
    INSERT INTO fx_rates (rate_date, base_ccy, quote_ccy, rate, source)
    VALUES (${rateDate}, ${baseCcy}, ${quoteCcy}, ${String(rate)}, ${source})
    ON CONFLICT (rate_date, base_ccy, quote_ccy) DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source
  `
}
