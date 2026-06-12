/**
 * snapshots.ts — net-worth snapshot endpoints (ST-028, FR-40/FR-41).
 *
 *  - POST /run       {date?}     → {snapshot}  (upsert for one Kyiv date)
 *  - POST /rebuild   {from,to}   → {count}     (sequential recompute of a range)
 *  - GET  /?from=&to=            → {items}     (stored snapshots, ascending)
 *
 * Recompute reads from the stored price/FX history (no live fetch). Deletions of
 * transactions do NOT auto-rebuild snapshots — the user/EOD job triggers it.
 */

import { Hono } from 'hono'
import { and, asc, eq, gte, lte } from 'drizzle-orm'

import { db } from '../db/index.ts'
import { netWorthSnapshots } from '../db/schema.ts'
import type { AppEnv } from '../middleware/requestContext.ts'
import { getUserId } from '../middleware/requestContext.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { processMaturedBonds } from '../services/bond.ts'
import { runSnapshot, rebuild } from '../services/snapshot.ts'

export const snapshotsRouter = new Hono<AppEnv>()

snapshotsRouter.use('*', authMiddleware)

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// ---------------------------------------------------------------------------
// POST /api/snapshots/run  {date?}  → {snapshot}
// ---------------------------------------------------------------------------
snapshotsRouter.post('/run', async (c) => {
  const userId = getUserId(c)
  let body: Record<string, unknown> = {}
  try { body = (await c.req.json()) as Record<string, unknown> } catch { /* empty body allowed */ }

  let date: string
  if (body['date'] != null) {
    if (typeof body['date'] !== 'string' || !ISO_DATE.test(body['date'])) {
      return c.json({ error: 'VALIDATION_ERROR', message: 'date must be a YYYY-MM-DD string' }, 400)
    }
    date = body['date']
  } else {
    date = todayKyiv()
  }

  // FR-26/arch §3.3: auto-redeem matured bonds before computing the snapshot.
  // Idempotent — bonds already at qty=0 are skipped inside processMaturedBonds.
  await processMaturedBonds(date)

  const snapshot = await runSnapshot(userId, date)
  return c.json({ snapshot })
})

// ---------------------------------------------------------------------------
// POST /api/snapshots/rebuild  {from,to}  → {count}
// ---------------------------------------------------------------------------
snapshotsRouter.post('/rebuild', async (c) => {
  const userId = getUserId(c)
  let body: Record<string, unknown>
  try { body = (await c.req.json()) as Record<string, unknown> } catch {
    return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid JSON body' }, 400)
  }

  const from = body['from']
  const to = body['to']
  if (typeof from !== 'string' || !ISO_DATE.test(from)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'from is required (YYYY-MM-DD)' }, 400)
  }
  if (typeof to !== 'string' || !ISO_DATE.test(to)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'to is required (YYYY-MM-DD)' }, 400)
  }
  if (from > to) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'from must be on or before to' }, 400)
  }

  const fromMs = new Date(from).getTime()
  const toMs = new Date(to).getTime()
  const daySpan = Math.round((toMs - fromMs) / 86_400_000) + 1
  if (daySpan > 3700) {
    return c.json(
      { error: 'VALIDATION_ERROR', message: `Range too large: ${daySpan} days (max 3700). Split into smaller intervals.` },
      400,
    )
  }

  // processMaturedBonds is intentionally NOT called here: rebuild replays history
  // from stored transactions/prices, and redemptions were already created by
  // EOD/run on those dates. Inserting them again would duplicate sells.
  const count = await rebuild(userId, from, to)
  return c.json({ count })
})

// ---------------------------------------------------------------------------
// GET /api/snapshots?from=&to=  → {items}
// ---------------------------------------------------------------------------
snapshotsRouter.get('/', async (c) => {
  const userId = getUserId(c)
  const fromParam = c.req.query('from')
  const toParam = c.req.query('to')

  if (fromParam != null && fromParam !== '' && !ISO_DATE.test(fromParam)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'from must be a YYYY-MM-DD date' }, 400)
  }
  if (toParam != null && toParam !== '' && !ISO_DATE.test(toParam)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'to must be a YYYY-MM-DD date' }, 400)
  }

  const conditions = [
    eq(netWorthSnapshots.userId, userId),
    fromParam ? gte(netWorthSnapshots.snapshotDate, fromParam) : undefined,
    toParam ? lte(netWorthSnapshots.snapshotDate, toParam) : undefined,
  ].filter(Boolean) as Parameters<typeof and>

  const rows = await db
    .select({
      snapshotDate: netWorthSnapshots.snapshotDate,
      totalMinor: netWorthSnapshots.totalMinor,
      baseCurrency: netWorthSnapshots.baseCurrency,
      breakdown: netWorthSnapshots.breakdown,
    })
    .from(netWorthSnapshots)
    .where(and(...conditions))
    .orderBy(asc(netWorthSnapshots.snapshotDate))

  const items = rows.map((r) => ({
    snapshotDate: r.snapshotDate,
    totalMinor: r.totalMinor,
    baseCurrency: r.baseCurrency,
    breakdown: r.breakdown,
  }))

  return c.json({ items })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayKyiv(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
