/**
 * prices.ts — price history, manual upsert/delete, manual sync trigger
 * (ST-025, FR-29/30/31, arch §7.1.7).
 *
 * Routes:
 *   GET  /api/prices?assetId=&from=&to=   — history with source
 *   PUT  /api/prices/:assetId/:date        — upsert manual price
 *   DELETE /api/prices/:assetId/:date      — delete manual price
 *   POST /api/prices/sync                  — trigger syncPrices synchronously
 */

import { Hono } from 'hono'
import { and, asc, eq, gte, lte } from 'drizzle-orm'

import { db } from '../db/index.ts'
import { assets, priceQuotes } from '../db/schema.ts'
import { authMiddleware } from '../middleware/auth.ts'
import type { AppEnv } from '../middleware/requestContext.ts'
import { getUserId } from '../middleware/requestContext.ts'
import { syncPrices } from '../jobs/syncPrices.ts'

export const pricesRouter = new Hono<AppEnv>()

pricesRouter.use('*', authMiddleware)

// ---------------------------------------------------------------------------
// GET /api/prices?assetId=&from=&to=
// Returns price history for an asset over a date range, including source.
// ---------------------------------------------------------------------------
pricesRouter.get('/', async (c) => {
  const userId = getUserId(c)
  const { assetId, from, to } = c.req.query()

  if (!assetId) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'assetId is required' }, 400)
  }

  // Verify asset belongs to user
  const [asset] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.userId, userId)))
    .limit(1)

  if (!asset) {
    return c.json({ error: 'NOT_FOUND', message: 'Asset not found' }, 404)
  }

  const filters = [eq(priceQuotes.assetId, assetId)]
  if (from) filters.push(gte(priceQuotes.quoteDate, from))
  if (to) filters.push(lte(priceQuotes.quoteDate, to))

  const rows = await db
    .select({
      id: priceQuotes.id,
      assetId: priceQuotes.assetId,
      quoteDate: priceQuotes.quoteDate,
      price: priceQuotes.price,
      currency: priceQuotes.currency,
      source: priceQuotes.source,
      createdAt: priceQuotes.createdAt,
      updatedAt: priceQuotes.updatedAt,
    })
    .from(priceQuotes)
    .where(and(...filters))
    .orderBy(asc(priceQuotes.quoteDate))

  return c.json({ items: rows })
})

// ---------------------------------------------------------------------------
// PUT /api/prices/:assetId/:date  { price }
// Upsert a manual price. Bond clean price per paper. Negative/zero → 400.
// ---------------------------------------------------------------------------
pricesRouter.put('/:assetId/:date', async (c) => {
  const userId = getUserId(c)
  const { assetId, date } = c.req.param()

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'date must be YYYY-MM-DD' }, 400)
  }

  const body = await c.req.json().catch(() => null)
  if (body === null || typeof body !== 'object') {
    return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid JSON body' }, 400)
  }

  const price = body.price
  if (price === undefined || price === null) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'price is required' }, 400)
  }
  const priceNum = Number(price)
  if (!isFinite(priceNum) || priceNum < 0) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'price must be a non-negative number' }, 400)
  }

  // Verify asset belongs to user
  const [asset] = await db
    .select({ id: assets.id, currency: assets.currency })
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.userId, userId)))
    .limit(1)

  if (!asset) {
    return c.json({ error: 'NOT_FOUND', message: 'Asset not found' }, 404)
  }

  await db
    .insert(priceQuotes)
    .values({
      assetId,
      quoteDate: date,
      price: String(priceNum),
      currency: asset.currency,
      source: 'manual',
    })
    .onConflictDoUpdate({
      target: [priceQuotes.assetId, priceQuotes.quoteDate],
      set: {
        price: String(priceNum),
        source: 'manual',
        updatedAt: new Date(),
      },
    })

  const [row] = await db
    .select()
    .from(priceQuotes)
    .where(and(eq(priceQuotes.assetId, assetId), eq(priceQuotes.quoteDate, date)))
    .limit(1)

  return c.json(row, 200)
})

// ---------------------------------------------------------------------------
// DELETE /api/prices/:assetId/:date → 204
// ---------------------------------------------------------------------------
pricesRouter.delete('/:assetId/:date', async (c) => {
  const userId = getUserId(c)
  const { assetId, date } = c.req.param()

  // Verify asset belongs to user
  const [asset] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.userId, userId)))
    .limit(1)

  if (!asset) {
    return c.json({ error: 'NOT_FOUND', message: 'Asset not found' }, 404)
  }

  await db
    .delete(priceQuotes)
    .where(and(eq(priceQuotes.assetId, assetId), eq(priceQuotes.quoteDate, date)))

  return c.body(null, 204)
})

// ---------------------------------------------------------------------------
// POST /api/prices/sync  { assetId? }
// Synchronously triggers syncPrices; returns { okCount, errCount, errors }.
// Manual rows are never overwritten (handled inside syncPrices).
// ---------------------------------------------------------------------------
pricesRouter.post('/sync', async (c) => {
  // Validate ownership if assetId provided
  let assetId: string | undefined
  const body = await c.req.json().catch(() => ({}))
  if (body && typeof body === 'object' && 'assetId' in body) {
    const userId = getUserId(c)
    assetId = body.assetId as string
    const [asset] = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.userId, userId)))
      .limit(1)
    if (!asset) {
      return c.json({ error: 'NOT_FOUND', message: 'Asset not found' }, 404)
    }
  }

  const result = await syncPrices({ assetId })
  return c.json(result)
})
