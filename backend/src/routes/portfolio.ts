/**
 * portfolio.ts — positions / valuation / pnl read surface (ST-027, FR-35..FR-38).
 *
 * All monetary totals are reported in BASE_CURRENCY, converted via the fx service
 * at the rate as-of the requested date (fallback "last previous", §3.4).
 *
 *  - GET /positions  — held positions (asset-ccy value + base) + cash block.
 *  - GET /valuation  — totalBaseMinor + byClass/byAccount/byCurrency (snapshot shape).
 *                      A missing FX rate is fatal here → 404 FX_RATE_NOT_FOUND.
 *  - GET /pnl        — realized + income + fees + unrealized, all in base.
 */

import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import { divRoundHalfUp } from '@statok/shared'

import { db } from '../db/index.ts'
import { accounts } from '../db/schema.ts'
import type { AppEnv } from '../middleware/requestContext.ts'
import { getUserId } from '../middleware/requestContext.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { computePortfolioState } from '../services/valuation.ts'
import { convert, FxRateNotFoundError } from '../services/fx.ts'
import { computePnl } from '../services/pnl.ts'

const BASE_CURRENCY = (process.env['BASE_CURRENCY'] ?? 'USD') as string

export const portfolioRouter = new Hono<AppEnv>()

portfolioRouter.use('*', authMiddleware)

// ---------------------------------------------------------------------------
// GET /api/portfolio/positions?accountId=&date=
// ---------------------------------------------------------------------------
portfolioRouter.get('/positions', async (c) => {
  const userId = getUserId(c)
  const accountId = c.req.query('accountId') || undefined
  const dateParam = c.req.query('date')
  const asOf = isIsoDate(dateParam) ? dateParam : todayKyiv()

  const state = await computePortfolioState(userId, {
    ...(accountId ? { accountId } : {}),
    atDate: asOf,
  })

  const positions = await Promise.all(state.positions.map(async (p) => {
    let valueBaseMinor: number | null = null
    let unrealizedBaseMinor: number | null = null
    if (p.valueMinor !== null) {
      valueBaseMinor = await convertOrNull(p.valueMinor, p.asset.currency, asOf)
    }
    if (p.unrealizedMinor !== null) {
      unrealizedBaseMinor = await convertOrNull(p.unrealizedMinor, p.asset.currency, asOf)
    }
    return {
      accountId: p.accountId,
      asset: p.asset,
      quantity: p.quantity,
      costBasisMinor: p.costBasisMinor,
      avgCostMinor: p.avgCostMinor,
      lastPrice: p.lastPrice,
      priceDate: p.priceDate,
      valueMinor: p.valueMinor,
      valueBaseMinor,
      unrealizedMinor: p.unrealizedMinor,
      unrealizedBaseMinor,
      unrealizedPct: unrealizedPct(p.unrealizedMinor, p.costBasisMinor),
      ...(p.costBasisIncomplete ? { costBasisIncomplete: true } : {}),
    }
  }))

  const cash = await Promise.all(state.cash.map(async (c2) => ({
    accountId: c2.accountId,
    currency: c2.currency,
    balanceMinor: c2.balanceMinor,
    balanceBaseMinor: await convertOrNull(c2.balanceMinor, c2.currency, asOf),
  })))

  return c.json({ positions, cash, baseCurrency: BASE_CURRENCY, asOf })
})

// ---------------------------------------------------------------------------
// GET /api/portfolio/valuation?date=
// ---------------------------------------------------------------------------
portfolioRouter.get('/valuation', async (c) => {
  const userId = getUserId(c)
  const dateParam = c.req.query('date')
  const asOf = isIsoDate(dateParam) ? dateParam : todayKyiv()

  const state = await computePortfolioState(userId, { atDate: asOf })
  const accNames = await accountNameMap(userId)

  const byAccount = new Map<string, { accountId: string; name: string; valueMinor: number }>()
  const byClass = new Map<string, { class: string; valueMinor: number }>()
  const byCurrency = new Map<string, { currency: string; valueMinor: number }>()
  let totalBaseMinor = 0

  const add = (
    accountId: string,
    cls: string,
    ccy: string,
    base: number,
  ): void => {
    const a = byAccount.get(accountId)
    if (a) a.valueMinor += base
    else byAccount.set(accountId, { accountId, name: accNames.get(accountId) ?? '', valueMinor: base })
    const k = byClass.get(cls)
    if (k) k.valueMinor += base
    else byClass.set(cls, { class: cls, valueMinor: base })
    const u = byCurrency.get(ccy)
    if (u) u.valueMinor += base
    else byCurrency.set(ccy, { currency: ccy, valueMinor: base })
    totalBaseMinor += base
  }

  try {
    for (const p of state.positions) {
      if (p.valueMinor === null) continue // unpriced — excluded from totals
      const base = await convertOrThrow(p.valueMinor, p.asset.currency, asOf)
      add(p.accountId, p.asset.type, p.asset.currency, base)
    }
    for (const c2 of state.cash) {
      if (c2.balanceMinor === 0) continue
      const base = await convertOrThrow(c2.balanceMinor, c2.currency, asOf)
      add(c2.accountId, 'cash', c2.currency, base)
    }
  } catch (e) {
    if (e instanceof FxRateNotFoundError) {
      return c.json({ error: 'FX_RATE_NOT_FOUND', message: e.message }, 404)
    }
    throw e
  }

  return c.json({
    totalBaseMinor,
    byClass: [...byClass.values()],
    byAccount: [...byAccount.values()],
    byCurrency: [...byCurrency.values()],
    baseCurrency: BASE_CURRENCY,
    asOf,
  })
})

// ---------------------------------------------------------------------------
// GET /api/portfolio/pnl?accountId=&from=&to=
// ---------------------------------------------------------------------------
portfolioRouter.get('/pnl', async (c) => {
  const userId = getUserId(c)
  const accountId = c.req.query('accountId') || undefined
  const fromParam = c.req.query('from')
  const toParam = c.req.query('to')

  if (fromParam != null && fromParam !== '' && !isIsoDate(fromParam)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'from must be a YYYY-MM-DD date' }, 400)
  }
  if (toParam != null && toParam !== '' && !isIsoDate(toParam)) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'to must be a YYYY-MM-DD date' }, 400)
  }

  const result = await computePnl(userId, {
    ...(accountId ? { accountId } : {}),
    ...(isIsoDate(fromParam) ? { from: fromParam } : {}),
    ...(isIsoDate(toParam) ? { to: toParam } : {}),
  })

  return c.json({
    realizedTradingBaseMinor: result.realizedTradingBaseMinor,
    income: result.income,
    feesBaseMinor: result.feesBaseMinor,
    unrealizedBaseMinor: result.unrealizedBaseMinor,
    totalBaseMinor: result.totalBaseMinor,
    perAsset: result.perAsset,
    baseCurrency: BASE_CURRENCY,
    ...(result.valuationIncomplete ? { valuationIncomplete: true } : {}),
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert to base; return null when no FX path exists (positions/cash tolerate gaps). */
async function convertOrNull(amountMinor: number, from: string, date: string): Promise<number | null> {
  if (amountMinor === 0) return 0
  try {
    const res = await convert(amountMinor, from, BASE_CURRENCY, date)
    return res.amountMinor
  } catch (e) {
    if (e instanceof FxRateNotFoundError) return null
    throw e
  }
}

/** Convert to base; propagate FxRateNotFoundError (valuation treats it as fatal → 404). */
async function convertOrThrow(amountMinor: number, from: string, date: string): Promise<number> {
  if (amountMinor === 0) return 0
  const res = await convert(amountMinor, from, BASE_CURRENCY, date)
  return res.amountMinor
}

/**
 * unrealized / costBasis as a numeric ratio string (8 dp). Null when costBasis ≤ 0
 * or unrealized is unavailable (FR-35: undefined for non-positive basis).
 */
function unrealizedPct(unrealizedMinor: number | null, costBasisMinor: number): string | null {
  if (unrealizedMinor === null || costBasisMinor <= 0) return null
  // ratio = unrealized / costBasis, computed in fixed-point (scale 8) without float.
  const scaled = divRoundHalfUp(BigInt(unrealizedMinor) * 100_000_000n, BigInt(costBasisMinor))
  const neg = scaled < 0n
  const abs = neg ? -scaled : scaled
  const int = abs / 100_000_000n
  const frac = (abs % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '')
  const body = frac.length > 0 ? `${int}.${frac}` : `${int}`
  return neg ? `-${body}` : body
}

async function accountNameMap(userId: string): Promise<Map<string, string>> {
  const rows = await db.select({ id: accounts.id, name: accounts.name })
    .from(accounts).where(eq(accounts.userId, userId))
  return new Map(rows.map((r) => [r.id, r.name]))
}

function isIsoDate(v: string | undefined): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

function todayKyiv(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
