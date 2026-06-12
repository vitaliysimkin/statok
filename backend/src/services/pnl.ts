/**
 * pnl.ts — realized / income / fees / unrealized P&L (ST-027, arch §3.2, FR-37/FR-38).
 *
 * Three components, all reported in BASE_CURRENCY:
 *   - realizedTrading — a dedicated fold over the FULL history (cost basis is
 *     dragged from the beginning of time) that accumulates ONLY sells whose
 *     `executed_at ∈ [from, to]`. Each sell's realized delta is converted to base
 *     at the FX rate of that sell's own date (arch §3.2).
 *   - income — Σ netMinor of dividend/coupon/interest in [from, to], each converted
 *     at the FX rate of its payout date; split into dividends/coupons/interest.
 *   - fees — Σ feeMinor in [from, to] (informational; already baked into basis/proceeds).
 *   - unrealized — from the CURRENT state (computePortfolioState), at the current rate.
 *
 * total = realizedTrading + income + unrealized.  Fees are reported but NOT added
 * to total (they are already reflected inside realized/unrealized).
 *
 * Money is integer minor units; quantity arithmetic is bigint fixed-point scale 18
 * (mirrors valuation.ts). The only rounding is half-up at the cost-basis proportion
 * and the FX boundary (CRR-3) — never float.
 */

import { and, asc, eq } from 'drizzle-orm'

import { QTY_SCALE, divRoundHalfUp } from '@statok/shared'
import type { CurrencyCode, IsoDate } from '@statok/shared'

import { db } from '../db/index.ts'
import { assets, transactions } from '../db/schema.ts'
import { computePortfolioState } from './valuation.ts'
import { FxRateNotFoundError, loadFxResolver, type FxResolver } from './fx.ts'

const QTY_FACTOR = 10n ** BigInt(QTY_SCALE)

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PnlOptions {
  /** Restrict the period components to a single account. */
  accountId?: string
  /** Inclusive period start (YYYY-MM-DD, Kyiv). Open-ended when omitted. */
  from?: IsoDate
  /** Inclusive period end (YYYY-MM-DD, Kyiv). Open-ended when omitted. */
  to?: IsoDate
  /** Valuation date for the unrealized leg. Defaults to today (Kyiv). */
  atDate?: IsoDate
}

export interface PnlPerAsset {
  assetId: string
  symbol: string
  currency: CurrencyCode
  realizedMinor: number
  incomeMinor: number
  unrealizedMinor: number
  realizedBaseMinor: number
  incomeBaseMinor: number
  unrealizedBaseMinor: number
}

export interface PnlResult {
  realizedTradingBaseMinor: number
  income: {
    dividendsBaseMinor: number
    couponsBaseMinor: number
    interestBaseMinor: number
  }
  feesBaseMinor: number
  unrealizedBaseMinor: number
  totalBaseMinor: number
  perAsset: PnlPerAsset[]
  /** True when an FX rate was missing for some leg (excluded from the base totals). */
  valuationIncomplete: boolean
}

// ---------------------------------------------------------------------------
// Internal per-asset accumulator (asset currency + base, for perAsset rows)
// ---------------------------------------------------------------------------

interface PerAssetAcc {
  assetId: string
  symbol: string
  currency: CurrencyCode
  realizedMinor: number
  incomeMinor: number
  unrealizedMinor: number
  realizedBaseMinor: number
  incomeBaseMinor: number
  unrealizedBaseMinor: number
}

/** Cost-basis fold state for one (account, asset). */
interface FoldPos {
  qty: bigint
  costBasisMinor: number
}

// ---------------------------------------------------------------------------
// computePnl
// ---------------------------------------------------------------------------

export async function computePnl(userId: string, opts: PnlOptions = {}): Promise<PnlResult> {
  const atDate = opts.atDate ?? todayInKyiv()

  // Single FX load per request — all conversions below resolve in memory (NFR-03).
  const fx = await loadFxResolver()

  const acc = new Map<string, PerAssetAcc>()
  let valuationIncomplete = false

  const getAcc = (assetId: string, symbol: string, currency: CurrencyCode): PerAssetAcc => {
    let a = acc.get(assetId)
    if (!a) {
      a = {
        assetId, symbol, currency,
        realizedMinor: 0, incomeMinor: 0, unrealizedMinor: 0,
        realizedBaseMinor: 0, incomeBaseMinor: 0, unrealizedBaseMinor: 0,
      }
      acc.set(assetId, a)
    }
    return a
  }

  // --- realized trading + income + fees over [from, to] -------------------
  const baseCurrency = baseCcy()
  const { realizedTradingBaseMinor, dividendsBaseMinor, couponsBaseMinor, interestBaseMinor, feesBaseMinor, anyFxMissing } =
    await foldPeriod(userId, opts, baseCurrency, getAcc, fx)
  if (anyFxMissing) valuationIncomplete = true

  // --- unrealized from current state --------------------------------------
  const state = await computePortfolioState(userId, {
    ...(opts.accountId ? { accountId: opts.accountId } : {}),
    atDate,
  })

  let unrealizedBaseMinor = 0
  for (const pos of state.positions) {
    if (pos.unrealizedMinor === null) {
      // Unpriced position — cannot value its unrealized; flag and skip.
      valuationIncomplete = true
      continue
    }
    const a = getAcc(pos.asset.id, pos.asset.symbol, pos.asset.currency)
    a.unrealizedMinor += pos.unrealizedMinor
    try {
      const res = fx.convert(pos.unrealizedMinor, pos.asset.currency, baseCurrency, atDate)
      a.unrealizedBaseMinor += res.amountMinor
      unrealizedBaseMinor += res.amountMinor
    } catch (e) {
      if (e instanceof FxRateNotFoundError) valuationIncomplete = true
      else throw e
    }
  }

  const incomeTotalBase = dividendsBaseMinor + couponsBaseMinor + interestBaseMinor
  const totalBaseMinor = realizedTradingBaseMinor + incomeTotalBase + unrealizedBaseMinor

  const perAsset: PnlPerAsset[] = [...acc.values()]
    .filter((a) => a.realizedMinor !== 0 || a.incomeMinor !== 0 || a.unrealizedMinor !== 0)
    .map((a) => ({
      assetId: a.assetId,
      symbol: a.symbol,
      currency: a.currency,
      realizedMinor: a.realizedMinor,
      incomeMinor: a.incomeMinor,
      unrealizedMinor: a.unrealizedMinor,
      realizedBaseMinor: a.realizedBaseMinor,
      incomeBaseMinor: a.incomeBaseMinor,
      unrealizedBaseMinor: a.unrealizedBaseMinor,
    }))

  return {
    realizedTradingBaseMinor,
    income: { dividendsBaseMinor, couponsBaseMinor, interestBaseMinor },
    feesBaseMinor,
    unrealizedBaseMinor,
    totalBaseMinor,
    perAsset,
    valuationIncomplete,
  }
}

// ---------------------------------------------------------------------------
// Period fold — full-history cost basis, accumulate sells/income in [from, to]
// ---------------------------------------------------------------------------

async function foldPeriod(
  userId: string,
  opts: PnlOptions,
  baseCurrency: CurrencyCode,
  getAcc: (assetId: string, symbol: string, currency: CurrencyCode) => PerAssetAcc,
  fx: FxResolver,
): Promise<{
  realizedTradingBaseMinor: number
  dividendsBaseMinor: number
  couponsBaseMinor: number
  interestBaseMinor: number
  feesBaseMinor: number
  anyFxMissing: boolean
}> {
  // Full chronological history (no upper bound — period filter is applied per-row
  // on accumulation, but cost basis must replay from the beginning of time).
  const rows = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      assetId: transactions.assetId,
      type: transactions.type,
      executedAt: transactions.executedAt,
      quantity: transactions.quantity,
      amountMinor: transactions.amountMinor,
      feeMinor: transactions.feeMinor,
      netMinor: transactions.netMinor,
      txCurrency: transactions.currency,
      assetSymbol: assets.symbol,
    })
    .from(transactions)
    .innerJoin(assets, eq(transactions.assetId, assets.id))
    .where(
      and(
        eq(transactions.userId, userId),
        opts.accountId ? eq(transactions.accountId, opts.accountId) : undefined,
      ),
    )
    .orderBy(asc(transactions.executedAt), asc(transactions.createdAt), asc(transactions.id))

  const fromBound = opts.from ? kyivStartInstant(opts.from) : null
  const toBound = opts.to ? kyivEndInstant(opts.to) : null

  const pos = new Map<string, FoldPos>()
  const getPos = (accountId: string, assetId: string): FoldPos => {
    const key = `${accountId} ${assetId}`
    let p = pos.get(key)
    if (!p) {
      p = { qty: 0n, costBasisMinor: 0 }
      pos.set(key, p)
    }
    return p
  }

  let realizedTradingBaseMinor = 0
  let dividendsBaseMinor = 0
  let couponsBaseMinor = 0
  let interestBaseMinor = 0
  let feesBaseMinor = 0
  let anyFxMissing = false

  const inPeriod = (at: Date): boolean => {
    if (fromBound && at.getTime() < fromBound.getTime()) return false
    if (toBound && at.getTime() > toBound.getTime()) return false
    return true
  }

  for (const r of rows) {
    const ccy = r.txCurrency
    switch (r.type) {
      case 'buy': {
        const p = getPos(r.accountId, r.assetId)
        p.qty += parseQty(r.quantity)
        p.costBasisMinor += (r.amountMinor ?? 0) + r.feeMinor
        if (inPeriod(r.executedAt) && r.feeMinor !== 0) {
          feesBaseMinor += safeConvertAdd(fx, r.feeMinor, ccy, baseCurrency, r.executedAt, () => { anyFxMissing = true })
        }
        break
      }
      case 'sell': {
        const p = getPos(r.accountId, r.assetId)
        const amount = r.amountMinor ?? 0
        const fee = r.feeMinor
        const sellQty = parseQty(r.quantity)
        const costPart =
          p.qty > 0n ? Number(divRoundHalfUp(BigInt(p.costBasisMinor) * sellQty, p.qty)) : 0
        const realizedDelta = amount - fee - costPart
        p.costBasisMinor -= costPart
        p.qty -= sellQty

        if (inPeriod(r.executedAt)) {
          const a = getAcc(r.assetId, r.assetSymbol, ccy)
          a.realizedMinor += realizedDelta
          feesBaseMinor += safeConvertAdd(fx, fee, ccy, baseCurrency, r.executedAt, () => { anyFxMissing = true })
          const baseDelta = safeConvert(fx, realizedDelta, ccy, baseCurrency, r.executedAt)
          if (baseDelta === null) anyFxMissing = true
          else {
            a.realizedBaseMinor += baseDelta
            realizedTradingBaseMinor += baseDelta
          }
        }
        break
      }
      case 'split': {
        const p = getPos(r.accountId, r.assetId)
        const mul = parseQty(r.quantity)
        p.qty = (p.qty * mul) / QTY_FACTOR
        break
      }
      case 'opening_balance': {
        // Asset variant contributes cost basis; cash variant is irrelevant to P&L.
        if (r.quantity != null) {
          const p = getPos(r.accountId, r.assetId)
          p.qty += parseQty(r.quantity)
          p.costBasisMinor += r.amountMinor ?? 0
        }
        break
      }
      case 'dividend':
      case 'coupon':
      case 'interest': {
        if (inPeriod(r.executedAt)) {
          const net = r.netMinor ?? 0
          const a = getAcc(r.assetId, r.assetSymbol, ccy)
          a.incomeMinor += net
          const base = safeConvert(fx, net, ccy, baseCurrency, r.executedAt)
          if (base === null) anyFxMissing = true
          else {
            a.incomeBaseMinor += base
            if (r.type === 'dividend') dividendsBaseMinor += base
            else if (r.type === 'coupon') couponsBaseMinor += base
            else interestBaseMinor += base
          }
        }
        break
      }
      // deposit/withdraw/transfer_in/transfer_out/ticker_change — no P&L impact.
    }
  }

  return {
    realizedTradingBaseMinor,
    dividendsBaseMinor,
    couponsBaseMinor,
    interestBaseMinor,
    feesBaseMinor,
    anyFxMissing,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert; return null (and let caller flag) when no FX path exists. */
function safeConvert(
  fx: FxResolver,
  amountMinor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  at: Date,
): number | null {
  if (amountMinor === 0) return 0
  try {
    const res = fx.convert(amountMinor, from, to, kyivDateOf(at))
    return res.amountMinor
  } catch (e) {
    if (e instanceof FxRateNotFoundError) return null
    throw e
  }
}

/** Convert-and-add helper for the fees tally (fees are positive informational sums). */
function safeConvertAdd(
  fx: FxResolver,
  amountMinor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  at: Date,
  onMissing: () => void,
): number {
  const v = safeConvert(fx, amountMinor, from, to, at)
  if (v === null) { onMissing(); return 0 }
  return v
}

function baseCcy(): CurrencyCode {
  return (process.env['BASE_CURRENCY'] ?? 'USD') as CurrencyCode
}

/** Parse a numeric quantity string into scaled bigint; null/empty → 0n. */
function parseQty(q: string | null): bigint {
  if (q == null) return 0n
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(q.trim())
  if (!m) throw new TypeError(`pnl: invalid quantity ${JSON.stringify(q)}`)
  const sign = m[1] === '-' ? -1n : 1n
  const int = m[2] ?? '0'
  const frac = m[3] ?? ''
  let scaled = BigInt(int) * QTY_FACTOR
  if (frac.length > 0) {
    if (frac.length <= QTY_SCALE) {
      scaled += BigInt(frac.padEnd(QTY_SCALE, '0'))
    } else {
      scaled += BigInt(frac.slice(0, QTY_SCALE))
      if (frac.charCodeAt(QTY_SCALE) - 48 >= 5) scaled += 1n
    }
  }
  return sign * scaled
}

// --- Europe/Kyiv date handling (mirrors valuation.ts) ----------------------

function todayInKyiv(): IsoDate {
  return kyivDateOf(new Date())
}

function kyivDateOf(at: Date): IsoDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

/** UTC instant of 00:00 Kyiv on `isoDate` (inclusive period start). */
export function kyivStartInstant(isoDate: IsoDate): Date {
  const { y, mo, d } = parseIso(isoDate)
  const utcMidnight = Date.UTC(y, mo - 1, d, 0, 0, 0)
  return new Date(utcMidnight - kyivOffsetMsAt(new Date(utcMidnight)))
}

/** UTC instant just before 00:00 Kyiv on (isoDate + 1) — inclusive period end. */
export function kyivEndInstant(isoDate: IsoDate): Date {
  const { y, mo, d } = parseIso(isoDate)
  const nextUtcMidnight = Date.UTC(y, mo - 1, d + 1, 0, 0, 0)
  const start = new Date(nextUtcMidnight - kyivOffsetMsAt(new Date(nextUtcMidnight)))
  return new Date(start.getTime() - 1)
}

function parseIso(isoDate: IsoDate): { y: number; mo: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!m) throw new TypeError(`pnl: invalid date ${JSON.stringify(isoDate)}`)
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) }
}

function kyivOffsetMsAt(at: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const parts = fmt.formatToParts(at)
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0')
  let hour = get('hour')
  if (hour === 24) hour = 0
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'))
  return asUtc - at.getTime()
}
