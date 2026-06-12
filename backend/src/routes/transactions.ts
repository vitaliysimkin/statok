/**
 * transactions.ts — transaction write/read surface (ST-016, ST-017; FR-14..FR-22).
 *
 * Covers:
 *  - POST /                       core types (buy/sell/deposit/withdraw/dividend/
 *                                 coupon/interest/split/opening_balance) with the
 *                                 full field-matrix validation (arch §1.6).
 *  - POST /transfer               atomic transfer_out/transfer_in pair (FR-17).
 *  - POST /ticker-change          atomic meta + assets.symbol update (FR-19).
 *  - GET  /                       filtered + paginated journal (FR-21).
 *  - GET  /:id                    single row.
 *  - PUT  /:id                    partial update of same-type fields (FR-22).
 *  - DELETE /:id                  delete (transfer pair / ticker_change rollback).
 *
 * Quantity-invariant enforcement (FR-15a): mutations are applied, then the
 * deterministic fold (`computePortfolioState`, arch §3.1) is replayed for the
 * affected (account, asset); if any point goes qty < 0 the mutation is reverted
 * (compensating rollback) and 409 INSUFFICIENT_QUANTITY is returned. The fold
 * reads the committed `db`, so writes are committed first and undone on conflict
 * — never exposed via the API because positions/valuation/pnl fold on the fly.
 */

import { Hono } from 'hono'
import type { Context } from 'hono'
import { and, asc, desc, eq, gte, lt, lte, sql } from 'drizzle-orm'

import { isTransactionType, mulToMinor } from '@statok/shared'
import type { AssetType, TransactionType } from '@statok/shared'

import { db } from '../db/index.ts'
import { accounts, assets, transactions } from '../db/schema.ts'
import type { AppEnv } from '../middleware/requestContext.ts'
import { getUserId } from '../middleware/requestContext.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { computePortfolioState, kyivDateExclusiveUpperBound } from '../services/valuation.ts'
import { ensureCashAsset, isIso4217 } from '../services/cashAssets.ts'

export const transactionsRouter = new Hono<AppEnv>()

transactionsRouter.use('*', authMiddleware)

const INCOME_TYPES = new Set<TransactionType>(['dividend', 'coupon', 'interest'])
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// UUID guard — invalid :id → 404 before hitting Postgres. Scoped to the
// id-bearing methods so the literal POST /transfer and /ticker-change paths
// (which are not :id routes) are never matched.
transactionsRouter.on(['GET', 'PUT', 'DELETE'], '/:id', async (c, next) => {
  if (!UUID_RE.test(c.req.param('id'))) {
    return c.json({ error: 'NOT_FOUND', message: 'Transaction not found' }, 404)
  }
  return next()
})

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Thrown by validators to short-circuit a request with a typed error envelope. */
class HttpError extends Error {
  constructor(public status: 400 | 404 | 409, public code: string, message: string) {
    super(message)
  }
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

function isNonNegInt(v: unknown): v is number {
  return isInt(v) && v >= 0
}

/** Parse a positive numeric quantity string (scale ≤ 18). Returns trimmed string. */
function requireQuantity(v: unknown, field = 'quantity'): string {
  if (typeof v !== 'string' && typeof v !== 'number') {
    throw new HttpError(400, 'VALIDATION_ERROR', `${field} is required`)
  }
  const s = String(v).trim()
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s)
  if (!m) throw new HttpError(400, 'VALIDATION_ERROR', `${field} must be a positive decimal number`)
  if ((m[2]?.length ?? 0) > 18) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${field} supports at most 18 fractional digits`)
  }
  if (/^0(\.0+)?$/.test(s)) throw new HttpError(400, 'VALIDATION_ERROR', `${field} must be greater than 0`)
  return s
}

/** Parse a price string (non-negative, scale ≤ 8). */
function requirePrice(v: unknown): string {
  if (typeof v !== 'string' && typeof v !== 'number') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'price is required')
  }
  const s = String(v).trim()
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s)
  if (!m) throw new HttpError(400, 'VALIDATION_ERROR', 'price must be a non-negative decimal number')
  if ((m[2]?.length ?? 0) > 8) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'price supports at most 8 fractional digits')
  }
  return s
}

function normalizeCurrency(v: unknown): string {
  const code = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (!isIso4217(code)) {
    throw new HttpError(400, 'VALIDATION_ERROR', `currency ${JSON.stringify(v)} is not a valid ISO-4217 code`)
  }
  return code
}

function parseExecutedAt(v: unknown): Date {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'executedAt is required (ISO-8601)')
  }
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'VALIDATION_ERROR', 'executedAt is not a valid ISO-8601 timestamp')
  return d
}

async function loadOwnedAsset(userId: string, assetId: unknown) {
  if (typeof assetId !== 'string' || assetId === '') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'assetId is required for this transaction type')
  }
  const rows = await db.select().from(assets)
    .where(and(eq(assets.userId, userId), eq(assets.id, assetId))).limit(1)
  if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Asset not found')
  return rows[0]
}

async function assertAccountOwned(userId: string, accountId: unknown): Promise<string> {
  if (typeof accountId !== 'string' || accountId === '') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'accountId is required')
  }
  const rows = await db.select({ id: accounts.id }).from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.id, accountId))).limit(1)
  if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Account not found')
  return accountId
}

/**
 * Replay the fold for (accountId, assetId) and, if it detects qty < 0 at any
 * point, throw INSUFFICIENT_QUANTITY referencing the asset/account/date. Caller
 * is responsible for reverting the offending write before this propagates.
 */
async function assertQuantityInvariant(userId: string, accountId: string, assetId: string): Promise<void> {
  // fullTimeline replays future-dated rows too, so an oversell/edit/delete with
  // a future executedAt is still detected (FR-15a) — the default atDate cutoff
  // would skip those rows and miss the negative point.
  const state = await computePortfolioState(userId, { accountId, fullTimeline: true })
  const conflict = state.conflicts.find((c) => c.assetId === assetId)
  if (conflict) {
    throw new HttpError(
      409,
      'INSUFFICIENT_QUANTITY',
      `Insufficient quantity of ${conflict.assetSymbol} on account ${accountId} at ${conflict.executedAt}: the change would drive holdings negative`,
    )
  }
}

function errResponse(c: Context<AppEnv>, e: unknown) {
  if (e instanceof HttpError) return c.json({ error: e.code, message: e.message }, e.status)
  throw e
}

// ---------------------------------------------------------------------------
// POST /api/transactions  — core types
// ---------------------------------------------------------------------------

transactionsRouter.post('/', async (c) => {
  const userId = getUserId(c)
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid JSON body' }, 400) }
  const b = body as Record<string, unknown>

  try {
    const type = b['type']
    if (!isTransactionType(type)) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'type is required and must be a valid transaction type')
    }
    if (type === 'transfer_in' || type === 'transfer_out') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Use POST /api/transactions/transfer to create transfers')
    }
    if (type === 'ticker_change') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Use POST /api/transactions/ticker-change for ticker changes')
    }

    const accountId = await assertAccountOwned(userId, b['accountId'])
    const executedAt = parseExecutedAt(b['executedAt'])
    const note = typeof b['note'] === 'string' ? b['note'] : ''
    const meta = (b['meta'] && typeof b['meta'] === 'object') ? (b['meta'] as Record<string, unknown>) : null
    if ('netMinor' in b) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'netMinor is server-computed and not accepted in the request body')
    }

    const values = await buildCoreInsert(userId, accountId, type, b, executedAt, note, meta)

    // Insert, then enforce the quantity invariant via fold; revert on conflict.
    const [inserted] = await db.insert(transactions).values(values).returning()
    if (needsReplay(type)) {
      try {
        await assertQuantityInvariant(userId, accountId, inserted!.assetId)
      } catch (e) {
        await db.delete(transactions).where(eq(transactions.id, inserted!.id))
        throw e
      }
    }
    return c.json({ transaction: rowToTransaction(inserted!) }, 201)
  } catch (e) {
    return errResponse(c, e)
  }
})

/** Types whose insert/edit/delete can violate the qty>=0 invariant. */
function needsReplay(type: TransactionType): boolean {
  return type === 'sell' || type === 'split' || type === 'buy' || type === 'opening_balance'
}

/**
 * Validate the field matrix for a core type and return a ready-to-insert row.
 * Resolves the cash asset for pure-money types; computes net for income types.
 */
async function buildCoreInsert(
  userId: string,
  accountId: string,
  type: TransactionType,
  b: Record<string, unknown>,
  executedAt: Date,
  note: string,
  meta: Record<string, unknown> | null,
): Promise<typeof transactions.$inferInsert> {
  const base = { userId, accountId, type, executedAt, note, meta }

  switch (type) {
    case 'buy':
    case 'sell': {
      const asset = await loadOwnedAsset(userId, b['assetId'])
      if (asset.type === 'cash') throw new HttpError(400, 'VALIDATION_ERROR', `${type} is not valid for cash assets`)
      const currency = normalizeCurrency(b['currency'])
      if (currency !== asset.currency) {
        throw new HttpError(400, 'CURRENCY_MISMATCH', `Transaction currency ${currency} must equal asset currency ${asset.currency}`)
      }
      const quantity = requireQuantity(b['quantity'])
      const price = requirePrice(b['price'])
      if (!isNonNegInt(b['amountMinor'])) throw new HttpError(400, 'VALIDATION_ERROR', 'amountMinor is required (non-negative integer)')
      const amountMinor = b['amountMinor']
      const fee = b['feeMinor']
      if (fee != null && !isNonNegInt(fee)) throw new HttpError(400, 'VALIDATION_ERROR', 'feeMinor must be a non-negative integer')
      const feeMinor = isNonNegInt(fee) ? fee : 0
      // buy: amountMinor must equal qty×price (without fee). sell: amount is the gross proceeds.
      if (type === 'buy') {
        const expected = mulToMinor(quantity, price, currency)
        if (amountMinor !== expected) {
          throw new HttpError(400, 'VALIDATION_ERROR', `amountMinor (${amountMinor}) must equal quantity×price (${expected}) for a buy`)
        }
      }
      return { ...base, assetId: asset.id, quantity, price, amountMinor, currency, feeMinor }
    }

    case 'deposit':
    case 'withdraw': {
      const currency = normalizeCurrency(b['currency'])
      if (!isNonNegInt(b['amountMinor']) || b['amountMinor'] <= 0) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'amountMinor must be a positive integer')
      }
      const cashAsset = await resolveCashAsset(userId, b['assetId'], currency)
      return { ...base, assetId: cashAsset.id, amountMinor: b['amountMinor'], currency }
    }

    case 'dividend':
    case 'coupon':
    case 'interest': {
      const asset = await loadOwnedAsset(userId, b['assetId'])
      assertIncomeAssetType(type, asset.type)
      const currency = normalizeCurrency(b['currency'])
      if (currency !== asset.currency) {
        throw new HttpError(400, 'CURRENCY_MISMATCH', `Transaction currency ${currency} must equal asset currency ${asset.currency}`)
      }
      const { grossMinor, withholdingTaxMinor, netMinor } = computeIncome(b)
      return { ...base, assetId: asset.id, currency, grossMinor, withholdingTaxMinor, netMinor }
    }

    case 'split': {
      const asset = await loadOwnedAsset(userId, b['assetId'])
      if (asset.type === 'cash') throw new HttpError(400, 'VALIDATION_ERROR', 'split is not valid for cash assets')
      const quantity = requireQuantity(b['quantity'], 'quantity (split multiplier)')
      return { ...base, assetId: asset.id, quantity, currency: asset.currency }
    }

    case 'opening_balance': {
      return await buildOpeningBalance(userId, base, b)
    }

    default:
      throw new HttpError(400, 'VALIDATION_ERROR', `Unsupported transaction type ${type}`)
  }
}

function assertIncomeAssetType(type: TransactionType, assetType: AssetType): void {
  const ok =
    (type === 'dividend' && (assetType === 'stock' || assetType === 'etf')) ||
    (type === 'coupon' && assetType === 'bond') ||
    (type === 'interest' && assetType === 'cash')
  if (!ok) {
    const expected = type === 'dividend' ? 'stock/etf' : type === 'coupon' ? 'bond' : 'cash'
    throw new HttpError(400, 'VALIDATION_ERROR', `${type} requires a ${expected} asset, got ${assetType}`)
  }
}

/** gross required; wht optional (default 0); net = gross − wht (server-computed). */
function computeIncome(b: Record<string, unknown>): { grossMinor: number; withholdingTaxMinor: number; netMinor: number } {
  if (!isNonNegInt(b['grossMinor'])) throw new HttpError(400, 'VALIDATION_ERROR', 'grossMinor is required (non-negative integer)')
  const grossMinor = b['grossMinor']
  const wht = b['withholdingTaxMinor']
  if (wht != null && !isNonNegInt(wht)) throw new HttpError(400, 'VALIDATION_ERROR', 'withholdingTaxMinor must be a non-negative integer')
  const withholdingTaxMinor = isNonNegInt(wht) ? wht : 0
  if (withholdingTaxMinor > grossMinor) throw new HttpError(400, 'VALIDATION_ERROR', 'withholdingTaxMinor cannot exceed grossMinor')
  return { grossMinor, withholdingTaxMinor, netMinor: grossMinor - withholdingTaxMinor }
}

async function buildOpeningBalance(
  userId: string,
  base: Record<string, unknown>,
  b: Record<string, unknown>,
): Promise<typeof transactions.$inferInsert> {
  // Asset variant when an assetId references a non-cash asset; cash variant otherwise.
  let asset: typeof assets.$inferSelect | undefined
  if (typeof b['assetId'] === 'string' && b['assetId'] !== '') {
    asset = await loadOwnedAsset(userId, b['assetId'])
  }

  if (asset && asset.type !== 'cash') {
    // opening_balance (asset): quantity required; amountMinor optional (cost basis).
    const quantity = requireQuantity(b['quantity'])
    const currency = asset.currency
    const out: typeof transactions.$inferInsert = {
      ...(base as object), assetId: asset.id, quantity, currency,
    } as typeof transactions.$inferInsert
    if ('price' in b && b['price'] != null) out.price = requirePrice(b['price'])
    if ('amountMinor' in b && b['amountMinor'] != null) {
      if (!isNonNegInt(b['amountMinor'])) throw new HttpError(400, 'VALIDATION_ERROR', 'amountMinor must be a non-negative integer')
      out.amountMinor = b['amountMinor']
    }
    return out
  }

  // opening_balance (cash): amountMinor (balance) required; quantity ignored/forbidden.
  const currency = asset ? asset.currency : normalizeCurrency(b['currency'])
  if (!isNonNegInt(b['amountMinor']) || b['amountMinor'] <= 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'amountMinor must be a positive integer for a cash opening balance')
  }
  const cashAsset = asset ?? await ensureCashAsset(userId, currency)
  return { ...(base as object), assetId: cashAsset.id, amountMinor: b['amountMinor'], currency } as typeof transactions.$inferInsert
}

/** Resolve the cash asset: explicit assetId must be a cash asset of `currency`; else ensureCashAsset. */
async function resolveCashAsset(userId: string, assetId: unknown, currency: string): Promise<typeof assets.$inferSelect> {
  if (typeof assetId === 'string' && assetId !== '') {
    const asset = await loadOwnedAsset(userId, assetId)
    if (asset.type !== 'cash') throw new HttpError(400, 'VALIDATION_ERROR', 'assetId must reference a cash asset for money transactions')
    if (asset.currency !== currency) throw new HttpError(400, 'CURRENCY_MISMATCH', `currency ${currency} must equal cash asset currency ${asset.currency}`)
    return asset
  }
  return ensureCashAsset(userId, currency)
}

// ---------------------------------------------------------------------------
// POST /api/transactions/transfer  — atomic pair
// ---------------------------------------------------------------------------

transactionsRouter.post('/transfer', async (c) => {
  const userId = getUserId(c)
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid JSON body' }, 400) }
  const b = body as Record<string, unknown>

  try {
    const fromAccountId = await assertAccountOwned(userId, b['fromAccountId'])
    const toAccountId = await assertAccountOwned(userId, b['toAccountId'])
    if (fromAccountId === toAccountId) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'fromAccountId and toAccountId must differ')
    }
    const executedAt = parseExecutedAt(b['executedAt'])
    const note = typeof b['note'] === 'string' ? b['note'] : ''

    const outCurrency = normalizeCurrency(b['outCurrency'])
    const inCurrency = normalizeCurrency(b['inCurrency'])
    if (!isNonNegInt(b['outAmountMinor']) || b['outAmountMinor'] <= 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'outAmountMinor must be a positive integer')
    }
    if (!isNonNegInt(b['inAmountMinor']) || b['inAmountMinor'] <= 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'inAmountMinor must be a positive integer')
    }
    const outAmountMinor = b['outAmountMinor']
    const inAmountMinor = b['inAmountMinor']

    // Resolve (or create) cash assets for both legs in their own currencies.
    const outAsset = await ensureCashAsset(userId, outCurrency)
    const inAsset = await ensureCashAsset(userId, inCurrency)
    const transferGroupId = crypto.randomUUID()

    const result = await db.transaction(async (tx) => {
      const [outTx] = await tx.insert(transactions).values({
        userId, accountId: fromAccountId, assetId: outAsset.id, type: 'transfer_out',
        executedAt, amountMinor: outAmountMinor, currency: outCurrency, transferGroupId, note,
      }).returning()
      const [inTx] = await tx.insert(transactions).values({
        userId, accountId: toAccountId, assetId: inAsset.id, type: 'transfer_in',
        executedAt, amountMinor: inAmountMinor, currency: inCurrency, transferGroupId, note,
      }).returning()
      return { outTx: outTx!, inTx: inTx! }
    })

    return c.json({ outTx: rowToTransaction(result.outTx), inTx: rowToTransaction(result.inTx) }, 201)
  } catch (e) {
    return errResponse(c, e)
  }
})

// ---------------------------------------------------------------------------
// POST /api/transactions/ticker-change  — atomic meta + symbol update
// ---------------------------------------------------------------------------

transactionsRouter.post('/ticker-change', async (c) => {
  const userId = getUserId(c)
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid JSON body' }, 400) }
  const b = body as Record<string, unknown>

  try {
    const asset = await loadOwnedAsset(userId, b['assetId'])
    if (asset.type === 'cash') throw new HttpError(400, 'VALIDATION_ERROR', 'ticker_change is not valid for cash assets')
    const newSymbol = typeof b['newSymbol'] === 'string' ? b['newSymbol'].trim() : ''
    if (!newSymbol) throw new HttpError(400, 'VALIDATION_ERROR', 'newSymbol is required')
    if (newSymbol === asset.symbol) throw new HttpError(400, 'VALIDATION_ERROR', 'newSymbol must differ from the current symbol')
    const executedAt = parseExecutedAt(b['executedAt'])
    const note = typeof b['note'] === 'string' ? b['note'] : ''

    // Symbol uniqueness within (user, type): a taken symbol → 409.
    const taken = await db.select({ id: assets.id }).from(assets)
      .where(and(eq(assets.userId, userId), eq(assets.type, asset.type), eq(assets.symbol, newSymbol))).limit(1)
    if (taken[0]) throw new HttpError(409, 'CONFLICT', `Symbol ${newSymbol} is already in use by another asset`)

    const result = await db.transaction(async (tx) => {
      const [txn] = await tx.insert(transactions).values({
        userId, accountId: await firstAccountForAsset(userId, asset.id, tx),
        assetId: asset.id, type: 'ticker_change', executedAt, currency: asset.currency, note,
        meta: { fromSymbol: asset.symbol, toSymbol: newSymbol },
      }).returning()
      const [updatedAsset] = await tx.update(assets)
        .set({ symbol: newSymbol, updatedAt: new Date() })
        .where(eq(assets.id, asset.id)).returning()
      return { txn: txn!, asset: updatedAsset! }
    })

    return c.json({ transaction: rowToTransaction(result.txn), asset: assetSummary(result.asset) }, 201)
  } catch (e) {
    return errResponse(c, e)
  }
})

/**
 * ticker_change has no natural account; attach it to an account that already
 * trades this asset (any), else the user's first account. Keeps the NOT NULL
 * account_id FK satisfied without affecting position math (it's a no-op fold).
 */
async function firstAccountForAsset(
  userId: string,
  assetId: string,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<string> {
  const existing = await tx.select({ accountId: transactions.accountId }).from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.assetId, assetId))).limit(1)
  if (existing[0]) return existing[0].accountId
  const acc = await tx.select({ id: accounts.id }).from(accounts)
    .where(eq(accounts.userId, userId)).orderBy(asc(accounts.sortOrder), asc(accounts.name)).limit(1)
  if (!acc[0]) throw new HttpError(400, 'VALIDATION_ERROR', 'No account available to attach the ticker change to')
  return acc[0].id
}

// ---------------------------------------------------------------------------
// GET /api/transactions  — filtered + paginated journal
// ---------------------------------------------------------------------------

transactionsRouter.get('/', async (c) => {
  const userId = getUserId(c)

  const accountId = c.req.query('accountId')
  const assetId = c.req.query('assetId')
  const typeParam = c.req.query('type')
  const fromParam = c.req.query('from')
  const toParam = c.req.query('to')

  if (typeParam != null && !isTransactionType(typeParam)) {
    return c.json({ error: 'VALIDATION_ERROR', message: `Invalid type filter ${JSON.stringify(typeParam)}` }, 400)
  }
  const from = parseDateFilter(fromParam, 'from')
  if (from instanceof Response) return from
  const toCondition = parseToCondition(toParam)
  if (toCondition instanceof Response) return toCondition

  let limit = DEFAULT_LIMIT
  if (c.req.query('limit') != null) {
    const n = Number(c.req.query('limit'))
    if (!Number.isInteger(n) || n < 0) return c.json({ error: 'VALIDATION_ERROR', message: 'limit must be a non-negative integer' }, 400)
    limit = Math.min(n === 0 ? DEFAULT_LIMIT : n, MAX_LIMIT)
  }
  let offset = 0
  if (c.req.query('offset') != null) {
    const n = Number(c.req.query('offset'))
    if (!Number.isInteger(n) || n < 0) return c.json({ error: 'VALIDATION_ERROR', message: 'offset must be a non-negative integer' }, 400)
    offset = n
  }

  const conditions = [
    eq(transactions.userId, userId),
    accountId ? eq(transactions.accountId, accountId) : undefined,
    assetId ? eq(transactions.assetId, assetId) : undefined,
    typeParam ? eq(transactions.type, typeParam as TransactionType) : undefined,
    from ? gte(transactions.executedAt, from) : undefined,
    toCondition,
  ].filter(Boolean) as Parameters<typeof and>

  const whereClause = and(...conditions)

  const countRows = await db.select({ total: sql<number>`count(*)::int` })
    .from(transactions).where(whereClause)
  const total = countRows[0]?.total ?? 0

  const rows = await db
    .select({
      id: transactions.id,
      type: transactions.type,
      executedAt: transactions.executedAt,
      accountId: transactions.accountId,
      assetId: transactions.assetId,
      quantity: transactions.quantity,
      price: transactions.price,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      feeMinor: transactions.feeMinor,
      grossMinor: transactions.grossMinor,
      withholdingTaxMinor: transactions.withholdingTaxMinor,
      netMinor: transactions.netMinor,
      transferGroupId: transactions.transferGroupId,
      note: transactions.note,
      accountName: sql<string>`(select name from accounts where accounts.id = ${transactions.accountId})`,
      assetSymbol: assets.symbol,
      assetType: assets.type,
    })
    .from(transactions)
    .innerJoin(assets, eq(transactions.assetId, assets.id))
    .where(whereClause)
    .orderBy(desc(transactions.executedAt), desc(transactions.createdAt), desc(transactions.id))
    .limit(limit)
    .offset(offset)

  const items = rows.map((r) => ({
    id: r.id,
    type: r.type,
    executedAt: r.executedAt.toISOString(),
    accountId: r.accountId,
    accountName: r.accountName,
    assetId: r.assetId,
    assetSymbol: r.assetSymbol,
    assetType: r.assetType,
    quantity: r.quantity,
    price: r.price,
    amountMinor: r.amountMinor,
    currency: r.currency,
    feeMinor: r.feeMinor,
    grossMinor: r.grossMinor,
    withholdingTaxMinor: r.withholdingTaxMinor,
    netMinor: r.netMinor,
    transferGroupId: r.transferGroupId,
    note: r.note,
  }))

  return c.json({ items, total })
})

function parseDateFilter(v: string | undefined, field: 'from' | 'to'): Date | undefined | Response {
  if (v == null || v === '') return undefined
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) {
    return new Response(JSON.stringify({ error: 'VALIDATION_ERROR', message: `${field} is not a valid date` }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }
  return d
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Build the `to` upper-bound condition. A pure `YYYY-MM-DD` is treated as the
 * whole Kyiv business day: exclusive bound at next-day midnight Kyiv via `lt`
 * (so `to=today` includes today's intraday rows, not just T00:00Z). A full ISO
 * timestamp keeps inclusive `lte` semantics.
 */
function parseToCondition(v: string | undefined): ReturnType<typeof lt> | undefined | Response {
  if (v == null || v === '') return undefined
  if (DATE_ONLY_RE.test(v)) {
    return lt(transactions.executedAt, kyivDateExclusiveUpperBound(v))
  }
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) {
    return new Response(JSON.stringify({ error: 'VALIDATION_ERROR', message: 'to is not a valid date' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }
  return lte(transactions.executedAt, d)
}

// ---------------------------------------------------------------------------
// GET /api/transactions/:id
// ---------------------------------------------------------------------------

transactionsRouter.get('/:id', async (c) => {
  const userId = getUserId(c)
  const row = await loadOwnedTransaction(userId, c.req.param('id'))
  if (!row) return c.json({ error: 'NOT_FOUND', message: 'Transaction not found' }, 404)
  return c.json({ transaction: rowToTransaction(row) })
})

// ---------------------------------------------------------------------------
// PUT /api/transactions/:id  — partial update of same-type fields
// ---------------------------------------------------------------------------

transactionsRouter.put('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const row = await loadOwnedTransaction(userId, id)
  if (!row) return c.json({ error: 'NOT_FOUND', message: 'Transaction not found' }, 404)

  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid JSON body' }, 400) }
  const b = body as Record<string, unknown>

  try {
    if ('type' in b && b['type'] !== row.type) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Transaction type cannot be changed')
    }
    if ('netMinor' in b) throw new HttpError(400, 'VALIDATION_ERROR', 'netMinor is server-computed and not accepted')

    // Snapshot for compensating rollback if the fold detects a conflict.
    const prev = { ...row }
    const updates = await buildUpdate(userId, row, b)

    if (row.transferGroupId && (row.type === 'transfer_in' || row.type === 'transfer_out')) {
      // executedAt/note sync to both legs; amount/currency are per-leg.
      await db.transaction(async (tx) => {
        await tx.update(transactions).set(updates).where(eq(transactions.id, id))
        const sibling: Partial<typeof transactions.$inferInsert> = {}
        if (updates.executedAt) sibling.executedAt = updates.executedAt
        if ('note' in updates) sibling.note = updates.note as string
        sibling.updatedAt = new Date()
        if (Object.keys(sibling).length > 0) {
          await tx.update(transactions).set(sibling)
            .where(and(eq(transactions.transferGroupId, row.transferGroupId!),
              sql`${transactions.id} <> ${id}`))
        }
      })
    } else {
      await db.update(transactions).set(updates).where(eq(transactions.id, id))
    }

    if (needsReplay(row.type)) {
      try {
        await assertQuantityInvariant(userId, row.accountId, row.assetId)
      } catch (e) {
        // Revert just this row (transfer legs don't hit replay).
        await db.update(transactions).set({
          quantity: prev.quantity, price: prev.price, amountMinor: prev.amountMinor,
          feeMinor: prev.feeMinor, grossMinor: prev.grossMinor,
          withholdingTaxMinor: prev.withholdingTaxMinor, netMinor: prev.netMinor,
          executedAt: prev.executedAt, note: prev.note, updatedAt: prev.updatedAt,
        }).where(eq(transactions.id, id))
        throw e
      }
    }

    const [updated] = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1)
    return c.json({ transaction: rowToTransaction(updated!) })
  } catch (e) {
    return errResponse(c, e)
  }
})

/** Build a same-type partial update from the request body, validating per-type fields. */
async function buildUpdate(
  userId: string,
  row: typeof transactions.$inferSelect,
  b: Record<string, unknown>,
): Promise<Partial<typeof transactions.$inferInsert> & { updatedAt: Date }> {
  const u: Partial<typeof transactions.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() }
  if ('executedAt' in b) u.executedAt = parseExecutedAt(b['executedAt'])
  if ('note' in b) u.note = typeof b['note'] === 'string' ? b['note'] : ''
  if ('meta' in b && b['meta'] != null && typeof b['meta'] === 'object') u.meta = b['meta'] as Record<string, unknown>

  switch (row.type) {
    case 'buy':
    case 'sell': {
      const quantity = 'quantity' in b ? requireQuantity(b['quantity']) : row.quantity!
      const price = 'price' in b ? requirePrice(b['price']) : row.price!
      if ('quantity' in b) u.quantity = quantity
      if ('price' in b) u.price = price
      if ('feeMinor' in b) {
        if (!isNonNegInt(b['feeMinor'])) throw new HttpError(400, 'VALIDATION_ERROR', 'feeMinor must be a non-negative integer')
        u.feeMinor = b['feeMinor']
      }
      if ('amountMinor' in b) {
        if (!isNonNegInt(b['amountMinor'])) throw new HttpError(400, 'VALIDATION_ERROR', 'amountMinor must be a non-negative integer')
        u.amountMinor = b['amountMinor']
      }
      if (row.type === 'buy') {
        const amt = u.amountMinor ?? row.amountMinor!
        const expected = mulToMinor(u.quantity ?? quantity, u.price ?? price, row.currency)
        if (amt !== expected) throw new HttpError(400, 'VALIDATION_ERROR', `amountMinor (${amt}) must equal quantity×price (${expected}) for a buy`)
      }
      break
    }
    case 'deposit':
    case 'withdraw': {
      if ('amountMinor' in b) {
        if (!isNonNegInt(b['amountMinor']) || b['amountMinor'] <= 0) throw new HttpError(400, 'VALIDATION_ERROR', 'amountMinor must be a positive integer')
        u.amountMinor = b['amountMinor']
      }
      break
    }
    case 'transfer_in':
    case 'transfer_out': {
      if ('amountMinor' in b) {
        if (!isNonNegInt(b['amountMinor']) || b['amountMinor'] <= 0) throw new HttpError(400, 'VALIDATION_ERROR', 'amountMinor must be a positive integer')
        u.amountMinor = b['amountMinor']
      }
      // Amount/currency are per-leg (FR-17). Changing currency re-points this leg
      // to the cash asset of the new currency; executedAt/note still sync to both.
      if ('currency' in b) {
        const currency = normalizeCurrency(b['currency'])
        if (currency !== row.currency) {
          const cashAsset = await ensureCashAsset(userId, currency)
          u.currency = currency
          u.assetId = cashAsset.id
        }
      }
      break
    }
    case 'dividend':
    case 'coupon':
    case 'interest': {
      if ('grossMinor' in b || 'withholdingTaxMinor' in b) {
        const merged = {
          grossMinor: 'grossMinor' in b ? b['grossMinor'] : row.grossMinor,
          withholdingTaxMinor: 'withholdingTaxMinor' in b ? b['withholdingTaxMinor'] : row.withholdingTaxMinor ?? 0,
        }
        const { grossMinor, withholdingTaxMinor, netMinor } = computeIncome(merged)
        u.grossMinor = grossMinor
        u.withholdingTaxMinor = withholdingTaxMinor
        u.netMinor = netMinor
      }
      break
    }
    case 'split':
    case 'opening_balance': {
      if ('quantity' in b && b['quantity'] != null && row.quantity != null) u.quantity = requireQuantity(b['quantity'])
      if ('amountMinor' in b && row.type === 'opening_balance') {
        if (b['amountMinor'] == null) u.amountMinor = null
        else {
          if (!isNonNegInt(b['amountMinor'])) throw new HttpError(400, 'VALIDATION_ERROR', 'amountMinor must be a non-negative integer')
          u.amountMinor = b['amountMinor']
        }
      }
      if ('price' in b && row.type === 'opening_balance' && b['price'] != null) u.price = requirePrice(b['price'])
      break
    }
    case 'ticker_change':
      // Only executedAt/note/meta are mutable; symbol stays (rollback on delete).
      break
  }
  return u
}

// ---------------------------------------------------------------------------
// DELETE /api/transactions/:id
// ---------------------------------------------------------------------------

transactionsRouter.delete('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const row = await loadOwnedTransaction(userId, id)
  if (!row) return c.json({ error: 'NOT_FOUND', message: 'Transaction not found' }, 404)

  try {
    // Transfer leg → delete the whole pair atomically.
    if (row.transferGroupId && (row.type === 'transfer_in' || row.type === 'transfer_out')) {
      await db.delete(transactions).where(eq(transactions.transferGroupId, row.transferGroupId))
      return new Response(null, { status: 204 })
    }

    // ticker_change → if this is the asset's latest ticker_change, roll back symbol.
    if (row.type === 'ticker_change') {
      await db.transaction(async (tx) => {
        const latest = await tx.select({ id: transactions.id, meta: transactions.meta })
          .from(transactions)
          .where(and(eq(transactions.assetId, row.assetId), eq(transactions.type, 'ticker_change')))
          .orderBy(desc(transactions.executedAt), desc(transactions.createdAt), desc(transactions.id))
          .limit(1)
        await tx.delete(transactions).where(eq(transactions.id, id))
        if (latest[0]?.id === id) {
          const meta = (row.meta ?? {}) as Record<string, unknown>
          const fromSymbol = typeof meta['fromSymbol'] === 'string' ? meta['fromSymbol'] : null
          if (fromSymbol) {
            await tx.update(assets).set({ symbol: fromSymbol, updatedAt: new Date() })
              .where(eq(assets.id, row.assetId))
          }
        }
      })
      return new Response(null, { status: 204 })
    }

    // Other types: delete, then verify the invariant; restore the row on conflict.
    await db.delete(transactions).where(eq(transactions.id, id))
    if (needsReplay(row.type)) {
      try {
        await assertQuantityInvariant(userId, row.accountId, row.assetId)
      } catch (e) {
        await db.insert(transactions).values(reinsertValues(row))
        throw e
      }
    }
    return new Response(null, { status: 204 })
  } catch (e) {
    return errResponse(c, e)
  }
})

/** Reconstruct insert values to restore a deleted row verbatim (compensating rollback). */
function reinsertValues(row: typeof transactions.$inferSelect): typeof transactions.$inferInsert {
  return {
    id: row.id, userId: row.userId, accountId: row.accountId, assetId: row.assetId,
    type: row.type, executedAt: row.executedAt, quantity: row.quantity, price: row.price,
    amountMinor: row.amountMinor, currency: row.currency, feeMinor: row.feeMinor,
    grossMinor: row.grossMinor, withholdingTaxMinor: row.withholdingTaxMinor, netMinor: row.netMinor,
    transferGroupId: row.transferGroupId, note: row.note, meta: row.meta,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

// ---------------------------------------------------------------------------
// Shared loaders / serializers
// ---------------------------------------------------------------------------

async function loadOwnedTransaction(userId: string, id: string) {
  const rows = await db.select().from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.id, id))).limit(1)
  return rows[0]
}

function rowToTransaction(row: typeof transactions.$inferSelect) {
  return {
    id: row.id,
    accountId: row.accountId,
    assetId: row.assetId,
    type: row.type,
    executedAt: row.executedAt.toISOString(),
    quantity: row.quantity,
    price: row.price,
    amountMinor: row.amountMinor,
    currency: row.currency,
    feeMinor: row.feeMinor,
    grossMinor: row.grossMinor,
    withholdingTaxMinor: row.withholdingTaxMinor,
    netMinor: row.netMinor,
    transferGroupId: row.transferGroupId,
    note: row.note,
    meta: (row.meta ?? null) as Record<string, unknown> | null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function assetSummary(row: typeof assets.$inferSelect) {
  return {
    id: row.id,
    type: row.type,
    symbol: row.symbol,
    name: row.name,
    currency: row.currency,
    priceSource: row.priceSource,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
