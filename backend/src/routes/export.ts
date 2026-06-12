/**
 * export.ts — CSV export of transactions and positions (ST-031, FR-49/FR-50).
 *
 *  GET /api/export/transactions.csv?from=&to=&accountId=
 *  GET /api/export/positions.csv?date=
 *
 * Both return text/csv; charset=utf-8 with UTF-8 BOM (RFC 4180, Excel-safe).
 * All monetary values are in major units (divided by 100 for 2-decimal ccys).
 */

import { Hono } from 'hono'
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm'

import { db } from '../db/index.ts'
import { transactions, accounts, assets } from '../db/schema.ts'
import type { AppEnv } from '../middleware/requestContext.ts'
import { getUserId } from '../middleware/requestContext.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { computePortfolioState } from '../services/valuation.ts'
import { convert, FxRateNotFoundError } from '../services/fx.ts'
import { kyivStartInstant, kyivEndInstant } from '../services/pnl.ts'
import { buildCsv } from '../lib/csv.ts'
import { minorToDisplay, divRoundHalfUp } from '@statok/shared'
import type { IsoDate } from '@statok/shared'

const BASE_CURRENCY = (process.env['BASE_CURRENCY'] ?? 'USD') as string

export const exportRouter = new Hono<AppEnv>()
exportRouter.use('*', authMiddleware)

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minor units → major-unit decimal string for the given currency, via the shared
 * fixed-point helper (no float, honours per-currency MINOR_DIGITS). Empty for null.
 */
function toMajor(minor: number | null | undefined, ccy: string): string {
  if (minor === null || minor === undefined) return ''
  return minorToDisplay(minor, ccy)
}

/**
 * unrealized / costBasis as a fixed-point ratio string (8 dp, trailing zeros
 * trimmed), mirroring portfolio.ts. Empty when costBasis ≤ 0 or unrealized absent.
 */
function unrealizedPctCsv(unrealizedMinor: number | null, costBasisMinor: number): string {
  if (unrealizedMinor === null || costBasisMinor <= 0) return ''
  const scaled = divRoundHalfUp(BigInt(unrealizedMinor) * 100_000_000n, BigInt(costBasisMinor))
  const neg = scaled < 0n
  const abs = neg ? -scaled : scaled
  const int = abs / 100_000_000n
  const frac = (abs % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '')
  const body = frac.length > 0 ? `${int}.${frac}` : `${int}`
  return neg ? `-${body}` : body
}

function todayKyiv(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function isoDateFromTimestamp(ts: Date | string | null | undefined): IsoDate {
  if (!ts) return todayKyiv() as IsoDate
  const d = ts instanceof Date ? ts : new Date(ts)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d) as IsoDate
}

// ---------------------------------------------------------------------------
// GET /api/export/transactions.csv
// ---------------------------------------------------------------------------

const TX_HEADERS = [
  'id', 'executed_at', 'account', 'asset_symbol', 'asset_type',
  'type', 'quantity', 'price', 'currency', 'amount', 'fee',
  'gross', 'withholding_tax', 'net', 'transfer_group_id', 'note',
]

exportRouter.get('/transactions.csv', async (c) => {
  const userId = getUserId(c)
  const fromParam = c.req.query('from')
  const toParam = c.req.query('to')
  const accountIdParam = c.req.query('accountId')

  if (fromParam && !ISO_DATE.test(fromParam)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'from must be YYYY-MM-DD' }, 400)
  }
  if (toParam && !ISO_DATE.test(toParam)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'to must be YYYY-MM-DD' }, 400)
  }

  // Range bounds aligned to Europe/Kyiv day boundaries (matches the business-date /
  // export convention), so txns near Kyiv midnight fall inside the right window.
  const conditions = [
    eq(transactions.userId, userId),
    fromParam ? gte(transactions.executedAt, kyivStartInstant(fromParam as IsoDate)) : undefined,
    toParam ? lte(transactions.executedAt, kyivEndInstant(toParam as IsoDate)) : undefined,
    accountIdParam ? eq(transactions.accountId, accountIdParam) : undefined,
  ].filter(Boolean) as Parameters<typeof and>

  const rows = await db
    .select({
      id: transactions.id,
      executedAt: transactions.executedAt,
      accountName: accounts.name,
      assetSymbol: assets.symbol,
      assetType: assets.type,
      type: transactions.type,
      quantity: transactions.quantity,
      price: transactions.price,
      currency: transactions.currency,
      amountMinor: transactions.amountMinor,
      feeMinor: transactions.feeMinor,
      grossMinor: transactions.grossMinor,
      withholdingTaxMinor: transactions.withholdingTaxMinor,
      netMinor: transactions.netMinor,
      transferGroupId: transactions.transferGroupId,
      note: transactions.note,
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(assets, eq(transactions.assetId, assets.id))
    .where(and(...conditions))
    .orderBy(asc(transactions.executedAt))

  const csvRows: unknown[][] = rows.map((r) => [
    r.id,
    r.executedAt instanceof Date ? r.executedAt.toISOString() : r.executedAt,
    r.accountName ?? '',
    r.assetSymbol ?? '',
    r.assetType ?? '',
    r.type,
    r.quantity ?? '',
    r.price ?? '',
    r.currency,
    toMajor(r.amountMinor, r.currency),
    toMajor(r.feeMinor, r.currency),
    toMajor(r.grossMinor, r.currency),
    toMajor(r.withholdingTaxMinor, r.currency),
    toMajor(r.netMinor, r.currency),
    r.transferGroupId ?? '',
    r.note,
  ])

  const csv = buildCsv(TX_HEADERS, csvRows)
  const filename = `statok-transactions-${todayKyiv()}.csv`

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})

// ---------------------------------------------------------------------------
// GET /api/export/positions.csv
// ---------------------------------------------------------------------------

const POS_HEADERS = [
  'account', 'asset_symbol', 'asset_type', 'currency',
  'quantity', 'avg_cost', 'cost_basis', 'last_price', 'price_date',
  'value', 'value_base', 'unrealized', 'unrealized_pct',
]

exportRouter.get('/positions.csv', async (c) => {
  const userId = getUserId(c)
  const dateParam = c.req.query('date')

  if (dateParam && !ISO_DATE.test(dateParam)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'date must be YYYY-MM-DD' }, 400)
  }

  const asOf: IsoDate = (dateParam && ISO_DATE.test(dateParam) ? dateParam : todayKyiv()) as IsoDate

  const state = await computePortfolioState(userId, { atDate: asOf })

  // We need account names — fetch once
  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.userId, userId))

  const accountMap = new Map(accountRows.map((a) => [a.id, a.name]))

  const csvRows: unknown[][] = []

  for (const pos of state.positions) {
    const currency = pos.asset.currency
    let valueBase = ''
    let unrealizedBase = ''
    if (pos.valueMinor !== null) {
      try {
        const res = await convert(pos.valueMinor, currency as never, BASE_CURRENCY as never, asOf)
        valueBase = toMajor(res.amountMinor, BASE_CURRENCY)
        if (pos.unrealizedMinor !== null) {
          const ur = await convert(pos.unrealizedMinor, currency as never, BASE_CURRENCY as never, asOf)
          unrealizedBase = toMajor(ur.amountMinor, BASE_CURRENCY)
        }
      } catch (err) {
        if (!(err instanceof FxRateNotFoundError)) throw err
      }
    }

    // unrealizedPct = unrealized / costBasis (fixed-point; empty for non-positive basis)
    const unrealizedPct = unrealizedPctCsv(pos.unrealizedMinor, pos.costBasisMinor)

    const accountName = accountMap.get(pos.accountId) ?? pos.accountId

    csvRows.push([
      accountName,
      pos.asset.symbol,
      pos.asset.type,
      currency,
      pos.quantity,       // already a display string from valuation
      toMajor(pos.avgCostMinor, currency),
      toMajor(pos.costBasisMinor, currency),
      pos.lastPrice ?? '',
      pos.priceDate ?? '',
      toMajor(pos.valueMinor, currency),
      valueBase,
      toMajor(pos.unrealizedMinor, currency),
      unrealizedPct,
    ])
  }

  const csv = buildCsv(POS_HEADERS, csvRows)
  const filename = `statok-positions-${asOf}.csv`

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})
