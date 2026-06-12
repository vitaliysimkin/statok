/**
 * assets.ts — CRUD for assets + bond_details (ST-015, FR-10..FR-13, arch §2 assets).
 *
 * Rules:
 *  - type='cash' cannot be created manually (400)
 *  - type='bond' requires bond block; bond block for non-bond → 400
 *  - asset + bond_details created in a single DB transaction (atomic)
 *  - PUT ignores/rejects symbol changes (only via ticker_change)
 *  - DELETE: no transactions → 204 (cascade price_quotes + bond_details); with transactions → 409
 */

import { Hono } from 'hono'
import { and, asc, eq, isNull } from 'drizzle-orm'

import { displayToMinor, minorToDisplay } from '@statok/shared'

import { db } from '../db/index.ts'
import { assets, bondDetails, transactions } from '../db/schema.ts'
import type { AppEnv } from '../middleware/requestContext.ts'
import { getUserId } from '../middleware/requestContext.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { isIso4217 } from '../services/cashAssets.ts'
import {
  couponSchedule,
  currentYield,
  getBondWithAsset,
  latestQuoteMinor,
  ytm,
  type BondInput,
} from '../services/bond.ts'

export const assetsRouter = new Hono<AppEnv>()

assetsRouter.use('*', authMiddleware)

const ASSET_TYPES = ['stock', 'etf', 'crypto', 'bond'] as const
type AssetType = typeof ASSET_TYPES[number]

const PRICE_SOURCES = ['yahoo', 'manual'] as const
type PriceSource = typeof PRICE_SOURCES[number]

/** RFC-4122 UUID shape; an invalid :id must 404, not surface a Postgres cast error (500). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// GET /api/assets
// ---------------------------------------------------------------------------
assetsRouter.get('/', async (c) => {
  const userId = getUserId(c)
  const typeFilter = c.req.query('type')
  const includeArchived = c.req.query('includeArchived') === 'true'

  const conditions = [
    eq(assets.userId, userId),
    includeArchived ? undefined : isNull(assets.archivedAt),
    typeFilter ? eq(assets.type, typeFilter as AssetType) : undefined,
  ].filter(Boolean)

  const rows = await db.select().from(assets)
    .where(and(...(conditions as Parameters<typeof and>)))
    .orderBy(asc(assets.type), asc(assets.symbol))

  // Attach bond details
  const bondIds = rows.filter(r => r.type === 'bond').map(r => r.id)
  const bondsMap = await fetchBondDetailsMap(bondIds)

  return c.json({ items: rows.map(r => assetToDto(r, bondsMap.get(r.id))) })
})

// ---------------------------------------------------------------------------
// POST /api/assets
// ---------------------------------------------------------------------------
assetsRouter.post('/', async (c) => {
  const userId = getUserId(c)
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid JSON body' }, 400) }
  const b = body as Record<string, unknown>

  // type validation
  const type = b['type'] as string
  if (type === 'cash') return c.json({ error: 'VALIDATION_ERROR', message: 'Cash assets are created automatically; do not create them manually' }, 400)
  if (!ASSET_TYPES.includes(type as AssetType)) return c.json({ error: 'VALIDATION_ERROR', message: `type must be one of ${ASSET_TYPES.join(', ')}` }, 400)

  // symbol
  const symbol = typeof b['symbol'] === 'string' ? b['symbol'].trim() : ''
  if (!symbol) return c.json({ error: 'VALIDATION_ERROR', message: 'symbol is required' }, 400)

  // currency
  const currency = typeof b['currency'] === 'string' ? b['currency'].trim().toUpperCase() : ''
  if (!isIso4217(currency)) return c.json({ error: 'VALIDATION_ERROR', message: `currency "${b['currency']}" is not a valid ISO-4217 code` }, 400)

  // bond validation
  if (type === 'bond' && b['bond'] == null) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'bond details are required when type is bond' }, 400)
  }
  if (type !== 'bond' && b['bond'] != null) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'bond details are only allowed for type=bond' }, 400)
  }

  // priceSource default
  let priceSource: PriceSource = type === 'bond' ? 'manual' : 'yahoo'
  if (PRICE_SOURCES.includes(b['priceSource'] as PriceSource)) priceSource = b['priceSource'] as PriceSource

  const name = typeof b['name'] === 'string' ? b['name'] : symbol

  // Duplicate check (user, type, symbol)
  const dup = await db.select({ id: assets.id }).from(assets)
    .where(and(eq(assets.userId, userId), eq(assets.type, type as AssetType), eq(assets.symbol, symbol)))
    .limit(1)
  if (dup.length > 0) return c.json({ error: 'CONFLICT', message: `Asset (${type}, ${symbol}) already exists` }, 409)

  if (type !== 'bond') {
    // Simple insert
    const [asset] = await db.insert(assets).values({
      userId, type: type as AssetType, symbol, name, currency, priceSource,
    }).returning()
    return c.json({ asset: assetToDto(asset!) }, 201)
  }

  // Bond: validate and insert atomically
  const bondInput = b['bond'] as Record<string, unknown>
  const bondErr = validateBondInput(bondInput)
  if (bondErr) return c.json({ error: 'VALIDATION_ERROR', message: bondErr }, 400)

  // Atomic asset + bond_details in one transaction
  const result = await db.transaction(async (tx) => {
    const [asset] = await tx.insert(assets).values({
      userId, type: 'bond', symbol, name, currency, priceSource,
    }).returning()

    const bd = bondInputToValues(asset!.id, bondInput)
    const [bond] = await tx.insert(bondDetails).values(bd).returning()
    return { asset: asset!, bond: bond! }
  })

  return c.json({ asset: assetToDto(result.asset, result.bond) }, 201)
})

// ---------------------------------------------------------------------------
// GET /api/assets/:id
// ---------------------------------------------------------------------------
assetsRouter.get('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'NOT_FOUND', message: 'Asset not found' }, 404)
  const row = await getAssetOwnedBy(userId, id)
  if (!row) return c.json({ error: 'NOT_FOUND', message: 'Asset not found' }, 404)

  let bond: typeof bondDetails.$inferSelect | undefined
  if (row.type === 'bond') {
    const bRows = await db.select().from(bondDetails).where(eq(bondDetails.assetId, id)).limit(1)
    bond = bRows[0]
  }
  return c.json({ ...assetToDto(row, bond) })
})

// ---------------------------------------------------------------------------
// PUT /api/assets/:id
// ---------------------------------------------------------------------------
assetsRouter.put('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'NOT_FOUND', message: 'Asset not found' }, 404)
  const row = await getAssetOwnedBy(userId, id)
  if (!row) return c.json({ error: 'NOT_FOUND', message: 'Asset not found' }, 404)

  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid JSON body' }, 400) }
  const b = body as Record<string, unknown>

  // symbol change via PUT is rejected
  if ('symbol' in b) return c.json({ error: 'VALIDATION_ERROR', message: 'symbol cannot be changed via PUT; use ticker_change transaction' }, 400)

  const assetUpdates: Partial<typeof assets.$inferInsert> & { updatedAt?: Date } = {}

  if ('name' in b) assetUpdates.name = typeof b['name'] === 'string' ? b['name'] : ''
  if ('currency' in b) {
    const ccy = typeof b['currency'] === 'string' ? b['currency'].trim().toUpperCase() : ''
    if (!isIso4217(ccy)) return c.json({ error: 'VALIDATION_ERROR', message: `currency "${b['currency']}" is not a valid ISO-4217 code` }, 400)
    assetUpdates.currency = ccy
  }
  if ('priceSource' in b) {
    if (!PRICE_SOURCES.includes(b['priceSource'] as PriceSource)) return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid priceSource' }, 400)
    assetUpdates.priceSource = b['priceSource'] as PriceSource
  }
  if ('archived' in b) {
    assetUpdates.archivedAt = b['archived'] === true ? new Date() : null
  }

  assetUpdates.updatedAt = new Date()

  // Validate the bond block BEFORE the transaction (as POST does) so an invalid
  // block yields a canonical 400 instead of a 500 escaping the tx callback.
  const updatesBond = 'bond' in b && row.type === 'bond' && b['bond'] != null
  let bondValues: ReturnType<typeof bondInputToValues> | null = null
  if (updatesBond) {
    const bondInput = b['bond'] as Record<string, unknown>
    const bondErr = validateBondInput(bondInput, true)
    if (bondErr) return c.json({ error: 'VALIDATION_ERROR', message: bondErr }, 400)
    bondValues = bondInputToValues(id, bondInput)
  }

  await db.transaction(async (tx) => {
    await tx.update(assets).set(assetUpdates).where(eq(assets.id, id))

    if (bondValues) {
      await tx.insert(bondDetails).values(bondValues)
        .onConflictDoUpdate({ target: bondDetails.assetId, set: { ...bondValues, updatedAt: new Date() } })
    }
  })

  const [updated] = await db.select().from(assets).where(eq(assets.id, id)).limit(1)
  let bond: typeof bondDetails.$inferSelect | undefined
  if (updated!.type === 'bond') {
    const bRows = await db.select().from(bondDetails).where(eq(bondDetails.assetId, id)).limit(1)
    bond = bRows[0]
  }
  return c.json({ asset: assetToDto(updated!, bond) })
})

// ---------------------------------------------------------------------------
// DELETE /api/assets/:id
// ---------------------------------------------------------------------------
assetsRouter.delete('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'NOT_FOUND', message: 'Asset not found' }, 404)
  const row = await getAssetOwnedBy(userId, id)
  if (!row) return c.json({ error: 'NOT_FOUND', message: 'Asset not found' }, 404)

  // Check for any transactions referencing this asset
  const txRows = await db.select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.assetId, id))
    .limit(1)
  if (txRows.length > 0) {
    const errCode = row.type === 'cash' ? 'ASSET_HAS_TRANSACTIONS' : 'ASSET_HAS_TRANSACTIONS'
    return c.json({ error: errCode, message: 'Cannot delete an asset with transactions; archive it instead' }, 409)
  }

  // CASCADE in DB handles price_quotes and bond_details
  await db.delete(assets).where(eq(assets.id, id))
  return new Response(null, { status: 204 })
})

// ---------------------------------------------------------------------------
// GET /api/assets/:id/bond/schedule  (read-only coupon schedule)  — FR-23/24
// ---------------------------------------------------------------------------
assetsRouter.get('/:id/bond/schedule', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'NOT_FOUND', message: 'Bond not found' }, 404)
  const asset = await getAssetOwnedBy(userId, id)
  if (!asset || asset.type !== 'bond') {
    return c.json({ error: 'NOT_FOUND', message: 'Bond not found' }, 404)
  }
  const bond = await getBondWithAsset(id)
  if (!bond) return c.json({ error: 'NOT_FOUND', message: 'Bond not found' }, 404)

  const items = couponSchedule(bondInputOf(bond))
  return c.json({ items, currency: bond.currency })
})

// ---------------------------------------------------------------------------
// GET /api/assets/:id/bond/metrics?price=&date=  (YTM + current yield)  — FR-27
// ---------------------------------------------------------------------------
assetsRouter.get('/:id/bond/metrics', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'NOT_FOUND', message: 'Bond not found' }, 404)
  const asset = await getAssetOwnedBy(userId, id)
  if (!asset || asset.type !== 'bond') {
    return c.json({ error: 'NOT_FOUND', message: 'Bond not found' }, 404)
  }
  const bond = await getBondWithAsset(id)
  if (!bond) return c.json({ error: 'NOT_FOUND', message: 'Bond not found' }, 404)

  // settlement = ?date (YYYY-MM-DD), default today Kyiv — drives ACT/365F discounting.
  const dateParam = c.req.query('date')
  const settlement = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayKyivIso()

  // price resolution: explicit ?price= (clean price, major units, per 1 bond) →
  // else latest quote ≤ settlement → else face value fallback.
  // asOf (FR-27) is the *price* date: the quote's date for a real quote, else the
  // settlement date for an explicit ?price= override or the face fallback.
  const priceParam = c.req.query('price')
  let priceUsedMinor: number // minor units (clean price per 1 bond)
  let priceBasis: 'yahoo' | 'manual' | 'face'
  let asOf: string

  // Parse ?price= via bigint fixed-point (no float Math.round): '1234.565' → 123457.
  if (priceParam != null && /^[+-]?\d+(\.\d+)?$/.test(priceParam.trim())) {
    priceUsedMinor = displayToMinor(priceParam, bond.currency)
    priceBasis = 'manual' // an explicit override is treated as a manual basis
    asOf = settlement
  } else {
    const quote = await latestQuoteMinor(id, bond.currency, settlement)
    if (quote) {
      priceUsedMinor = quote.priceMinor
      priceBasis = quote.source
      asOf = quote.quoteDate
    } else {
      priceUsedMinor = bond.faceValueMinor
      priceBasis = 'face'
      asOf = settlement
    }
  }

  const input = bondInputOf(bond)
  const currentYieldPercent = currentYield(input, priceUsedMinor) * 100
  const ytmPercent = ytm(input, priceUsedMinor, settlement)
  // priceUsed travels as a numeric string in major units (ТЗ §2 numeric convention).
  const priceUsed = minorToDisplay(priceUsedMinor, bond.currency)

  return c.json({ ytmPercent, currentYieldPercent, priceUsed, priceBasis, asOf })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bondInputOf(b: Awaited<ReturnType<typeof getBondWithAsset>> & {}): BondInput {
  return {
    faceValueMinor: b.faceValueMinor,
    couponRatePercent: b.couponRatePercent,
    couponFrequency: b.couponFrequency,
    issueDate: b.issueDate,
    maturityDate: b.maturityDate,
  }
}

function todayKyivIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

async function getAssetOwnedBy(userId: string, id: string) {
  const rows = await db.select().from(assets)
    .where(and(eq(assets.userId, userId), eq(assets.id, id))).limit(1)
  return rows[0]
}

async function fetchBondDetailsMap(ids: string[]): Promise<Map<string, typeof bondDetails.$inferSelect>> {
  if (ids.length === 0) return new Map()
  const rows = await db.select().from(bondDetails)
    .where(and(...(ids.map(id => eq(bondDetails.assetId, id)) as Parameters<typeof and>)))
  return new Map(rows.map(r => [r.assetId, r]))
}

function assetToDto(
  row: typeof assets.$inferSelect,
  bond?: typeof bondDetails.$inferSelect,
) {
  const base = {
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
  if (!bond) return base
  return {
    ...base,
    bond: {
      faceValueMinor: bond.faceValueMinor,
      couponRatePercent: bond.couponRatePercent,
      couponFrequency: bond.couponFrequency,
      issueDate: bond.issueDate ?? null,
      maturityDate: bond.maturityDate,
      isin: bond.isin ?? null,
    },
  }
}

function validateBondInput(b: Record<string, unknown>, partial = false): string | null {
  if (!partial) {
    if (typeof b['faceValueMinor'] !== 'number' || b['faceValueMinor'] <= 0) {
      return 'bond.faceValueMinor must be a positive integer'
    }
    if (b['couponRatePercent'] == null) return 'bond.couponRatePercent is required'
    if (b['couponFrequency'] == null) return 'bond.couponFrequency is required'
    if (!b['maturityDate']) return 'bond.maturityDate is required'
  }

  const VALID_FREQ = [0, 1, 2, 4, 12]
  if ('couponFrequency' in b && !VALID_FREQ.includes(Number(b['couponFrequency']))) {
    return `bond.couponFrequency must be one of ${VALID_FREQ.join(', ')}`
  }

  // Zero-coupon consistency
  const freq = b['couponFrequency'] != null ? Number(b['couponFrequency']) : undefined
  const rate = b['couponRatePercent'] != null ? Number(b['couponRatePercent']) : undefined
  if (freq !== undefined && rate !== undefined) {
    if ((freq === 0) !== (rate === 0)) {
      return 'couponFrequency=0 requires couponRatePercent=0 and vice versa'
    }
  }
  return null
}

function bondInputToValues(assetId: string, b: Record<string, unknown>) {
  return {
    assetId,
    faceValueMinor: Number(b['faceValueMinor']),
    couponRatePercent: String(b['couponRatePercent']),
    couponFrequency: Number(b['couponFrequency']) as 0 | 1 | 2 | 4 | 12,
    maturityDate: String(b['maturityDate']),
    ...(b['issueDate'] != null ? { issueDate: String(b['issueDate']) } : {}),
    ...(b['isin'] != null ? { isin: String(b['isin']) } : {}),
  }
}
