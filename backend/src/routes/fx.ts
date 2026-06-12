/**
 * fx.ts — FX rate history, convert, manual upsert, manual sync trigger
 * (ST-026, FR-33/34, arch §7.1.8, §7.3.4).
 *
 * Routes:
 *   GET  /api/fx?base=&quote=&from=&to=                 — history with source
 *   GET  /api/fx/convert?amountMinor=&from=&to=&date=   — convert with fallback
 *   PUT  /api/fx/:date/:base/:quote  { rate }            — upsert manual rate
 *   POST /api/fx/sync                                    — trigger both FX branches
 */

import { Hono } from 'hono'
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import { sql } from 'drizzle-orm'

import { db } from '../db/index.ts'
import { fxRates } from '../db/schema.ts'
import { authMiddleware } from '../middleware/auth.ts'
import type { AppEnv } from '../middleware/requestContext.ts'
import { convert, FxRateNotFoundError } from '../services/fx.ts'
import { syncFxRates } from '../jobs/syncFxRates.ts'

export const fxRouter = new Hono<AppEnv>()

fxRouter.use('*', authMiddleware)

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
// ISO-4217: exactly 3 ASCII letters
const CCY_RE = /^[A-Za-z]{3}$/
// Positive decimal, up to 8 decimal places
const DECIMAL_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/

// ---------------------------------------------------------------------------
// GET /api/fx?base=&quote=&from=&to=
// Returns stored fx_rates history for a pair, including source.
// ---------------------------------------------------------------------------
fxRouter.get('/', async (c) => {
  const { base, quote, from, to } = c.req.query()

  if (!base || !quote) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'base and quote are required' }, 400)
  }

  if (!CCY_RE.test(base)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'base must be a 3-letter ISO-4217 currency code' }, 400)
  }
  if (!CCY_RE.test(quote)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'quote must be a 3-letter ISO-4217 currency code' }, 400)
  }

  if (from && !ISO_DATE.test(from)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'from must be YYYY-MM-DD' }, 400)
  }
  if (to && !ISO_DATE.test(to)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'to must be YYYY-MM-DD' }, 400)
  }

  const filters = [
    eq(fxRates.baseCcy, base.toUpperCase()),
    eq(fxRates.quoteCcy, quote.toUpperCase()),
  ]
  if (from) filters.push(gte(fxRates.rateDate, from))
  if (to) filters.push(lte(fxRates.rateDate, to))

  const rows = await db
    .select({
      id: fxRates.id,
      rateDate: fxRates.rateDate,
      baseCcy: fxRates.baseCcy,
      quoteCcy: fxRates.quoteCcy,
      rate: fxRates.rate,
      source: fxRates.source,
      createdAt: fxRates.createdAt,
    })
    .from(fxRates)
    .where(and(...filters))
    .orderBy(asc(fxRates.rateDate))

  return c.json({ items: rows })
})

// ---------------------------------------------------------------------------
// GET /api/fx/convert?amountMinor=&from=&to=&date=
// Convert using resolveRate (direct/inverse/USD-pivot). No rate → 404.
// Returns { amountMinor, from, to, rateUsed, rateDate }.
// ---------------------------------------------------------------------------
fxRouter.get('/convert', async (c) => {
  const { amountMinor: amountStr, from, to, date } = c.req.query()

  if (!amountStr || !from || !to || !date) {
    return c.json(
      { error: 'VALIDATION_ERROR', message: 'amountMinor, from, to and date are required' },
      400,
    )
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'date must be YYYY-MM-DD' }, 400)
  }

  const amountMinor = parseInt(amountStr, 10)
  if (!Number.isInteger(amountMinor)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'amountMinor must be an integer' }, 400)
  }

  try {
    const result = await convert(amountMinor, from.toUpperCase() as any, to.toUpperCase() as any, date)
    return c.json({ amountMinor: result.amountMinor, from: from.toUpperCase(), to: to.toUpperCase(), rateUsed: result.rateUsed, rateDate: result.rateDate })
  } catch (err) {
    if (err instanceof FxRateNotFoundError) {
      return c.json({ error: 'FX_RATE_NOT_FOUND', message: err.message }, 404)
    }
    throw err
  }
})

// ---------------------------------------------------------------------------
// PUT /api/fx/:date/:base/:quote  { rate }
// Upsert a manual FX rate. Participates in resolveRate on equal footing.
// ---------------------------------------------------------------------------
fxRouter.put('/:date/:base/:quote', async (c) => {
  const { date, base, quote } = c.req.param()

  if (!ISO_DATE.test(date)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'date must be YYYY-MM-DD' }, 400)
  }

  if (!CCY_RE.test(base)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'base must be a 3-letter ISO-4217 currency code' }, 400)
  }
  if (!CCY_RE.test(quote)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'quote must be a 3-letter ISO-4217 currency code' }, 400)
  }

  const body = await c.req.json().catch(() => null)
  if (body === null || typeof body !== 'object') {
    return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid JSON body' }, 400)
  }

  const rateRaw = body.rate
  if (rateRaw === undefined || rateRaw === null) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'rate is required' }, 400)
  }

  // Accept number or string; coerce to string for regex validation
  const rateStr = String(rateRaw)
  if (!DECIMAL_RE.test(rateStr)) {
    return c.json(
      { error: 'VALIDATION_ERROR', message: 'rate must be a positive decimal with up to 8 decimal places' },
      400,
    )
  }
  // Zero is not allowed (rate must be > 0)
  if (parseFloat(rateStr) <= 0) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'rate must be greater than zero' }, 400)
  }

  const baseCcy = base.toUpperCase()
  const quoteCcy = quote.toUpperCase()

  await db
    .insert(fxRates)
    .values({
      rateDate: date,
      baseCcy,
      quoteCcy,
      rate: rateStr,
      source: 'manual',
    })
    .onConflictDoUpdate({
      target: [fxRates.rateDate, fxRates.baseCcy, fxRates.quoteCcy],
      set: {
        rate: rateStr,
        source: 'manual',
      },
      setWhere: sql`true`,
    })

  const [row] = await db
    .select()
    .from(fxRates)
    .where(
      and(
        eq(fxRates.rateDate, date),
        eq(fxRates.baseCcy, baseCcy),
        eq(fxRates.quoteCcy, quoteCcy),
      ),
    )
    .limit(1)

  return c.json(row, 200)
})

// ---------------------------------------------------------------------------
// POST /api/fx/sync
// Trigger both FX branches synchronously.
// Returns { frankfurter: { ok, ratesUpserted }, nbu: { ok, ratesUpserted } }.
// ---------------------------------------------------------------------------
fxRouter.post('/sync', async (c) => {
  const result = await syncFxRates()
  return c.json(result)
})
