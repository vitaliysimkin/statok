/**
 * dashboards.ts — net-worth series and cashflow aggregation (ST-030, FR-42/FR-43).
 *
 *  GET /api/dashboards/networth-series?from=&to=
 *      Returns snapshot points as-stored (no interpolation for missing days).
 *
 *  GET /api/dashboards/cashflow?from=&to=&groupBy=month|quarter|year
 *      Aggregates deposit/withdraw/dividend/coupon/interest/fee transactions
 *      into calendar buckets after converting each tx to BASE_CURRENCY at its
 *      own date.  Transfer pairs (transfer_in / transfer_out) are excluded.
 *      All components are positive magnitudes; net = deposits − withdrawals
 *      + dividends + coupons + interest − fees.
 */

import { Hono } from 'hono'
import { and, asc, eq, gte, lte } from 'drizzle-orm'

import { db } from '../db/index.ts'
import { netWorthSnapshots, transactions, assets } from '../db/schema.ts'
import type { AppEnv } from '../middleware/requestContext.ts'
import { getUserId } from '../middleware/requestContext.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { convert, FxRateNotFoundError } from '../services/fx.ts'
import type { IsoDate } from '@statok/shared'

const BASE_CURRENCY = (process.env['BASE_CURRENCY'] ?? 'USD') as string

export const dashboardsRouter = new Hono<AppEnv>()
dashboardsRouter.use('*', authMiddleware)

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// ---------------------------------------------------------------------------
// GET /api/dashboards/networth-series?from=&to=
// ---------------------------------------------------------------------------
dashboardsRouter.get('/networth-series', async (c) => {
  const userId = getUserId(c)
  const fromParam = c.req.query('from')
  const toParam = c.req.query('to')

  if (fromParam && !ISO_DATE.test(fromParam)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'from must be YYYY-MM-DD' }, 400)
  }
  if (toParam && !ISO_DATE.test(toParam)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'to must be YYYY-MM-DD' }, 400)
  }

  const conditions = [
    eq(netWorthSnapshots.userId, userId),
    fromParam ? gte(netWorthSnapshots.snapshotDate, fromParam) : undefined,
    toParam ? lte(netWorthSnapshots.snapshotDate, toParam) : undefined,
  ].filter(Boolean) as Parameters<typeof and>

  const rows = await db
    .select({
      date: netWorthSnapshots.snapshotDate,
      totalMinor: netWorthSnapshots.totalMinor,
    })
    .from(netWorthSnapshots)
    .where(and(...conditions))
    .orderBy(asc(netWorthSnapshots.snapshotDate))

  return c.json({
    points: rows.map((r) => ({ date: r.date, totalMinor: r.totalMinor })),
    baseCurrency: BASE_CURRENCY,
  })
})

// ---------------------------------------------------------------------------
// GET /api/dashboards/cashflow?from=&to=&groupBy=month|quarter|year
// ---------------------------------------------------------------------------

type GroupBy = 'month' | 'quarter' | 'year'

function periodKey(dateStr: string, groupBy: GroupBy): string {
  // dateStr is YYYY-MM-DD (ISO date from DB)
  const year = dateStr.slice(0, 4)
  const month = parseInt(dateStr.slice(5, 7), 10)
  if (groupBy === 'year') return year
  if (groupBy === 'quarter') return `${year}-Q${Math.ceil(month / 3)}`
  // month
  return dateStr.slice(0, 7) // YYYY-MM
}

interface CashflowBucket {
  depositsMinor: number
  withdrawalsMinor: number
  dividendsMinor: number
  couponsMinor: number
  interestMinor: number
  feesMinor: number
}

dashboardsRouter.get('/cashflow', async (c) => {
  const userId = getUserId(c)
  const fromParam = c.req.query('from')
  const toParam = c.req.query('to')
  const groupByParam = (c.req.query('groupBy') ?? 'month') as GroupBy

  if (!['month', 'quarter', 'year'].includes(groupByParam)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'groupBy must be month|quarter|year' }, 400)
  }
  if (fromParam && !ISO_DATE.test(fromParam)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'from must be YYYY-MM-DD' }, 400)
  }
  if (toParam && !ISO_DATE.test(toParam)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'to must be YYYY-MM-DD' }, 400)
  }

  // Fetch cashflow-relevant transaction types, excluding transfer pairs.
  const relevantTypes = ['deposit', 'withdraw', 'dividend', 'coupon', 'interest', 'buy', 'sell'] as const
  // For fees we need buy/sell feeMinor; for income types we use netMinor.

  const conditions = [
    eq(transactions.userId, userId),
    fromParam ? gte(transactions.executedAt, new Date(fromParam + 'T00:00:00Z')) : undefined,
    toParam ? lte(transactions.executedAt, new Date(toParam + 'T23:59:59.999Z')) : undefined,
  ].filter(Boolean) as Parameters<typeof and>

  const rows = await db
    .select({
      id: transactions.id,
      type: transactions.type,
      executedAt: transactions.executedAt,
      amountMinor: transactions.amountMinor,
      currency: transactions.currency,
      feeMinor: transactions.feeMinor,
      netMinor: transactions.netMinor,
      assetCurrency: assets.currency,
    })
    .from(transactions)
    .leftJoin(assets, eq(transactions.assetId, assets.id))
    .where(and(...conditions))
    .orderBy(asc(transactions.executedAt))

  const buckets = new Map<string, CashflowBucket>()

  const getBucket = (key: string): CashflowBucket => {
    if (!buckets.has(key)) {
      buckets.set(key, {
        depositsMinor: 0,
        withdrawalsMinor: 0,
        dividendsMinor: 0,
        couponsMinor: 0,
        interestMinor: 0,
        feesMinor: 0,
      })
    }
    return buckets.get(key)!
  }

  for (const row of rows) {
    // Skip transfer pairs — excluded per FR-43 / spec
    if (row.type === 'transfer_in' || row.type === 'transfer_out') continue
    // Skip ticker_change / split / opening_balance
    if (!relevantTypes.includes(row.type as typeof relevantTypes[number])) continue

    const txDate = isoDateFromTimestamp(row.executedAt)
    const period = periodKey(txDate, groupByParam)
    const bucket = getBucket(period)

    const sourceCcy = (row.currency ?? row.assetCurrency ?? BASE_CURRENCY) as string

    if (row.type === 'deposit') {
      const amount = row.amountMinor ?? 0
      const converted = await safeConvert(amount, sourceCcy, BASE_CURRENCY, txDate)
      bucket.depositsMinor += converted
    } else if (row.type === 'withdraw') {
      const amount = row.amountMinor ?? 0
      const converted = await safeConvert(amount, sourceCcy, BASE_CURRENCY, txDate)
      bucket.withdrawalsMinor += converted
    } else if (row.type === 'dividend') {
      const net = row.netMinor ?? 0
      const converted = await safeConvert(net, sourceCcy, BASE_CURRENCY, txDate)
      bucket.dividendsMinor += converted
    } else if (row.type === 'coupon') {
      const net = row.netMinor ?? 0
      const converted = await safeConvert(net, sourceCcy, BASE_CURRENCY, txDate)
      bucket.couponsMinor += converted
    } else if (row.type === 'interest') {
      const net = row.netMinor ?? 0
      const converted = await safeConvert(net, sourceCcy, BASE_CURRENCY, txDate)
      bucket.interestMinor += converted
    }

    // Fees from buy/sell transactions
    if ((row.type === 'buy' || row.type === 'sell') && row.feeMinor && row.feeMinor > 0) {
      const converted = await safeConvert(row.feeMinor, sourceCcy, BASE_CURRENCY, txDate)
      bucket.feesMinor += converted
    }
  }

  // Sort buckets by period key (lexicographic works for YYYY-MM, YYYY-Q*, YYYY)
  const sortedKeys = [...buckets.keys()].sort()
  const periods = sortedKeys.map((period) => {
    const b = buckets.get(period)!
    return {
      period,
      depositsMinor: b.depositsMinor,
      withdrawalsMinor: b.withdrawalsMinor,
      dividendsMinor: b.dividendsMinor,
      couponsMinor: b.couponsMinor,
      interestMinor: b.interestMinor,
      feesMinor: b.feesMinor,
      netMinor: b.depositsMinor - b.withdrawalsMinor + b.dividendsMinor + b.couponsMinor + b.interestMinor - b.feesMinor,
    }
  })

  return c.json({ periods, baseCurrency: BASE_CURRENCY })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoDateFromTimestamp(ts: Date | string | null | undefined): IsoDate {
  if (!ts) return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date()) as IsoDate
  const d = ts instanceof Date ? ts : new Date(ts)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d) as IsoDate
}

/** Convert with FX; if rate is missing, return the original amount (best-effort). */
async function safeConvert(amount: number, from: string, to: string, date: IsoDate): Promise<number> {
  try {
    const result = await convert(amount, from as never, to as never, date)
    return result.amountMinor
  } catch (err) {
    if (err instanceof FxRateNotFoundError) return amount
    throw err
  }
}
