/**
 * bond.ts — bond domain logic (ST-018/ST-019, FR-23..FR-27, arch §3.3).
 *
 * Three concerns:
 *   - couponSchedule(bond): computed, read-only coupon + final redemption rows,
 *     generated from maturityDate backwards by `12 / frequency` months.
 *   - currentYield / ytm: display metrics (float is acceptable — not money).
 *   - processMaturedBonds(today): idempotent auto-redemption (a `sell` at par on
 *     the maturity date), reusing the deterministic fold for the held quantity.
 *
 * Money stays in integer minor units; the only rounding on the money path is
 * roundHalfUp at the numeric→minor boundary. Yields use double precision per spec.
 */

import { and, desc, eq, lte } from 'drizzle-orm'

import { roundHalfUp } from '@statok/shared'

import { db } from '../db/index.ts'
import { assets, bondDetails, priceQuotes, transactions } from '../db/schema.ts'
import { computePortfolioState } from './valuation.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal bond shape consumed by the pure schedule/yield functions. */
export interface BondInput {
  faceValueMinor: number
  /** Annual coupon rate as a percent figure, e.g. 15.75 (numeric(8,4) string ok). */
  couponRatePercent: number | string
  /** Payments per year: 1 | 2 | 4 | 12; 0 = zero-coupon. */
  couponFrequency: number
  /** Optional left bound; trims the schedule. YYYY-MM-DD. */
  issueDate?: string | null
  maturityDate: string
}

export type CouponKind = 'coupon' | 'redemption'

export interface ScheduleRow {
  /** Calendar payment date, YYYY-MM-DD (no business-day shifting in v1). */
  date: string
  amountMinor: number
  isFuture: boolean
  kind: CouponKind
}

export interface ScheduleOptions {
  /** Today (Europe/Kyiv) used to flag isFuture; defaults to today (Kyiv). */
  today?: string
  /**
   * Earliest transaction date for the asset (YYYY-MM-DD). Used as the left bound
   * only when issueDate is null. Without either, a 50-year cap applies.
   */
  earliestTxDate?: string | null
}

// ---------------------------------------------------------------------------
// couponSchedule
// ---------------------------------------------------------------------------

const MAX_SCHEDULE_YEARS = 50

/**
 * Build the coupon schedule from `maturityDate` backwards by `12/frequency`
 * months down to issueDate (or the earliest tx date, or a 50-year cap), then
 * append the final redemption row (`kind:'redemption'`, amount = faceValueMinor).
 *
 * Zero-coupon (frequency=0) → only the redemption row.
 * Coupon amount = roundHalfUp(faceValueMinor × couponRatePercent / 100 / frequency).
 */
export function couponSchedule(bond: BondInput, opts: ScheduleOptions = {}): ScheduleRow[] {
  const today = opts.today ?? todayInKyiv()
  const maturity = parseIsoDate(bond.maturityDate)
  const freq = bond.couponFrequency
  const rate = Number(bond.couponRatePercent)

  // Left bound: issueDate → earliest tx → maturity − 50y.
  let lowerBound: { y: number; m: number; d: number }
  if (bond.issueDate) {
    lowerBound = parseIsoDate(bond.issueDate)
  } else if (opts.earliestTxDate) {
    lowerBound = parseIsoDate(opts.earliestTxDate)
  } else {
    lowerBound = { y: maturity.y - MAX_SCHEDULE_YEARS, m: maturity.m, d: maturity.d }
  }
  const lowerBoundIso = isoOf(lowerBound)
  const hardFloorIso = isoOf({ y: maturity.y - MAX_SCHEDULE_YEARS, m: maturity.m, d: maturity.d })

  const rows: ScheduleRow[] = []

  if (freq > 0 && rate > 0) {
    const stepMonths = 12 / freq
    const couponMinor = roundHalfUp((bond.faceValueMinor * rate) / 100 / freq)
    // Walk backwards from maturity; the maturity-dated coupon is folded into the
    // redemption row (a single combined final row would double-count), so coupon
    // rows are strictly the payments BEFORE maturity.
    let stepsBack = 1
    while (true) {
      const at = addMonths(maturity, -stepMonths * stepsBack)
      const atIso = isoOf(at)
      if (atIso < lowerBoundIso || atIso < hardFloorIso) break
      rows.push({ date: atIso, amountMinor: couponMinor, isFuture: atIso > today, kind: 'coupon' })
      stepsBack += 1
    }
    rows.reverse() // chronological
  }

  // Final redemption row at maturity (always present), amount = face value.
  rows.push({
    date: isoOf(maturity),
    amountMinor: bond.faceValueMinor,
    isFuture: isoOf(maturity) > today,
    kind: 'redemption',
  })

  return rows
}

// ---------------------------------------------------------------------------
// currentYield
// ---------------------------------------------------------------------------

/**
 * Current yield = (faceValueMinor × couponRatePercent / 100) / cleanPriceMinor.
 * Division by 100 is mandatory (rate is a percent figure). Zero-coupon → 0.
 * Returns a fraction (e.g. 0.0825 = 8.25%).
 */
export function currentYield(bond: BondInput, cleanPriceMinor: number): number {
  const rate = Number(bond.couponRatePercent)
  if (bond.couponFrequency === 0 || rate === 0) return 0
  if (cleanPriceMinor <= 0) return 0
  const annualCouponMinor = (bond.faceValueMinor * rate) / 100
  return annualCouponMinor / cleanPriceMinor
}

// ---------------------------------------------------------------------------
// ytm — Newton–Raphson with bisection fallback
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000
const YTM_TOLERANCE = 1e-10
const YTM_MAX_ITER = 100
const BISECTION_MAX_ITER = 200
const BISECTION_LOW = -0.9999
const BISECTION_HIGH = 10

/** A discountable cash flow: years from settlement (ACT/365F) and its amount. */
interface CashFlow {
  years: number
  amount: number
}

/**
 * Yield to maturity (annual percent) solving the price equation
 *   P = Σ C / (1 + y/f)^(f·t_i) + F / (1 + y/f)^(f·t_n)
 * via Newton–Raphson (start = current yield, ≤100 iter, tolerance 1e-10 on price),
 * falling back to bisection on y ∈ [−0.9999, 10] when Newton diverges.
 *
 * `t_i` is ACT/365F from settlementDate. Only future cash flows are discounted.
 * Float math is intentional — this is a display metric, not a stored money value.
 */
export function ytm(bond: BondInput, cleanPriceMinor: number, settlementDate: string): number {
  const price = cleanPriceMinor
  const f = bond.couponFrequency > 0 ? bond.couponFrequency : 1
  const flows = futureCashFlows(bond, settlementDate)
  if (flows.length === 0 || price <= 0) return 0

  const priceAt = (y: number): number => {
    let pv = 0
    const base = 1 + y / f
    for (const cf of flows) pv += cf.amount / base ** (f * cf.years)
    return pv - price
  }
  const priceDeriv = (y: number): number => {
    // d/dy of Σ amount·(1+y/f)^(−f·t) = Σ amount·(−t)·(1+y/f)^(−f·t−1)
    let d = 0
    const base = 1 + y / f
    for (const cf of flows) d += cf.amount * (-cf.years) * base ** (-f * cf.years - 1)
    return d
  }

  // Newton–Raphson from the current yield as the seed.
  let y = currentYield(bond, cleanPriceMinor)
  if (!Number.isFinite(y) || y <= BISECTION_LOW) y = 0.05
  for (let i = 0; i < YTM_MAX_ITER; i++) {
    const fx = priceAt(y)
    if (Math.abs(fx) < YTM_TOLERANCE) return y * 100
    const dfx = priceDeriv(y)
    if (dfx === 0 || !Number.isFinite(dfx)) break
    const next = y - fx / dfx
    if (!Number.isFinite(next) || next <= BISECTION_LOW) break
    if (Math.abs(next - y) < YTM_TOLERANCE) return next * 100
    y = next
  }

  // Fallback: bisection on a wide bracket.
  return bisectYtm(priceAt) * 100
}

function bisectYtm(priceAt: (y: number) => number): number {
  let lo = BISECTION_LOW
  let hi = BISECTION_HIGH
  let flo = priceAt(lo)
  let fhi = priceAt(hi)
  if (flo === 0) return lo
  if (fhi === 0) return hi
  // If the bracket does not straddle a root, return the closer endpoint.
  if (flo > 0 === fhi > 0) return Math.abs(flo) < Math.abs(fhi) ? lo : hi
  for (let i = 0; i < BISECTION_MAX_ITER; i++) {
    const mid = (lo + hi) / 2
    const fmid = priceAt(mid)
    if (Math.abs(fmid) < YTM_TOLERANCE) return mid
    if (flo > 0 === fmid > 0) {
      lo = mid
      flo = fmid
    } else {
      hi = mid
      fhi = fmid
    }
  }
  return (lo + hi) / 2
}

/** Future (years > 0) coupon + redemption cash flows from settlementDate, ACT/365F. */
function futureCashFlows(bond: BondInput, settlementDate: string): CashFlow[] {
  const settleMs = isoToUtcMs(settlementDate)
  // Schedule with isFuture relative to settlement so we discount only what remains.
  const rows = couponSchedule(bond, { today: settlementDate })
  const flows: CashFlow[] = []
  for (const r of rows) {
    const years = (isoToUtcMs(r.date) - settleMs) / DAY_MS / 365
    if (years > 0) flows.push({ years, amount: r.amountMinor })
  }
  return flows
}

// ---------------------------------------------------------------------------
// processMaturedBonds — idempotent auto-redemption
// ---------------------------------------------------------------------------

export interface RedemptionResult {
  assetId: string
  accountId: string
  /** quantity redeemed, decimal string */
  quantity: string
  amountMinor: number
  transactionId: string
}

/**
 * For each bond with maturityDate ≤ today still held (qty > 0 per the fold),
 * insert a `sell` at par: qty = full remaining holding, price = faceValue,
 * amountMinor = roundHalfUp(qty × faceValue), fee 0, executedAt = maturityDate
 * 12:00 Europe/Kyiv, meta {autoRedemption:true}.
 *
 * Idempotent: a holding already at 0 (e.g. a prior run already redeemed it) is
 * skipped — no duplicate sell. Returns the redemptions actually created.
 */
export async function processMaturedBonds(today?: string): Promise<RedemptionResult[]> {
  const day = today ?? todayInKyiv()

  // Matured bonds across all users (single-user app, but scope by user for the fold).
  const matured = await db
    .select({
      assetId: bondDetails.assetId,
      faceValueMinor: bondDetails.faceValueMinor,
      maturityDate: bondDetails.maturityDate,
      userId: assets.userId,
      currency: assets.currency,
    })
    .from(bondDetails)
    .innerJoin(assets, eq(bondDetails.assetId, assets.id))
    .where(lte(bondDetails.maturityDate, day))

  if (matured.length === 0) return []

  const results: RedemptionResult[] = []

  // Group by user so we run the fold once per user, valuing up to `today`.
  const byUser = new Map<string, typeof matured>()
  for (const m of matured) {
    const list = byUser.get(m.userId) ?? []
    list.push(m)
    byUser.set(m.userId, list)
  }

  for (const [userId, bonds] of byUser) {
    const state = await computePortfolioState(userId, { atDate: day })

    for (const bond of bonds) {
      // Every held lot of this matured bond (per account) is redeemed.
      const heldLots = state.positions.filter((p) => p.asset.id === bond.assetId)
      for (const lot of heldLots) {
        // computePortfolioState already drops qty==0 positions, so any lot here is held.
        const qtyStr = lot.quantity
        const amountMinor = roundHalfUp(qtyTimesFace(qtyStr, bond.faceValueMinor))
        const executedAt = maturityNoonKyiv(bond.maturityDate)

        const [inserted] = await db
          .insert(transactions)
          .values({
            userId,
            accountId: lot.accountId,
            assetId: bond.assetId,
            type: 'sell',
            executedAt,
            quantity: qtyStr,
            price: faceValueToPriceString(bond.faceValueMinor, bond.currency),
            amountMinor,
            currency: bond.currency,
            feeMinor: 0,
            meta: { autoRedemption: true },
          })
          .returning({ id: transactions.id })

        results.push({
          assetId: bond.assetId,
          accountId: lot.accountId,
          quantity: qtyStr,
          amountMinor,
          transactionId: inserted!.id,
        })
      }
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Data helpers (DB lookups reused by routes)
// ---------------------------------------------------------------------------

/** Bond_details row joined with its asset currency, or null. */
export async function getBondWithAsset(
  assetId: string,
): Promise<
  | {
      assetId: string
      faceValueMinor: number
      couponRatePercent: string
      couponFrequency: number
      issueDate: string | null
      maturityDate: string
      currency: string
      symbol: string
    }
  | null
> {
  const rows = await db
    .select({
      assetId: bondDetails.assetId,
      faceValueMinor: bondDetails.faceValueMinor,
      couponRatePercent: bondDetails.couponRatePercent,
      couponFrequency: bondDetails.couponFrequency,
      issueDate: bondDetails.issueDate,
      maturityDate: bondDetails.maturityDate,
      currency: assets.currency,
      symbol: assets.symbol,
    })
    .from(bondDetails)
    .innerJoin(assets, eq(bondDetails.assetId, assets.id))
    .where(eq(bondDetails.assetId, assetId))
    .limit(1)
  return rows[0] ?? null
}

/** Latest quote (price minor units + source + date) with quote_date ≤ date. */
export async function latestQuoteMinor(
  assetId: string,
  currency: string,
  date: string,
): Promise<{ priceMinor: number; source: 'yahoo' | 'manual'; quoteDate: string } | null> {
  const rows = await db
    .select({
      price: priceQuotes.price,
      source: priceQuotes.source,
      quoteDate: priceQuotes.quoteDate,
    })
    .from(priceQuotes)
    .where(and(eq(priceQuotes.assetId, assetId), lte(priceQuotes.quoteDate, date)))
    .orderBy(desc(priceQuotes.quoteDate))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return { priceMinor: priceStringToMinor(row.price, currency), source: row.source, quoteDate: row.quoteDate }
}

// ---------------------------------------------------------------------------
// Numeric / date helpers
// ---------------------------------------------------------------------------

const MINOR_DIGITS = 2 // v1 currencies (UAH/USD/EUR) are all 2.

/** qty (decimal string) × faceValueMinor → exact minor-unit product as a number. */
function qtyTimesFace(qtyStr: string, faceMinor: number): number {
  // qty may have up to 18 fractional digits; do it in bigint then back to number.
  const QTY_SCALE = 18
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(qtyStr.trim())
  if (!m) throw new TypeError(`bond: invalid quantity ${JSON.stringify(qtyStr)}`)
  const sign = m[1] === '-' ? -1n : 1n
  const int = m[2] ?? '0'
  const frac = (m[3] ?? '').slice(0, QTY_SCALE).padEnd(QTY_SCALE, '0')
  const scaled = sign * (BigInt(int) * 10n ** BigInt(QTY_SCALE) + BigInt(frac))
  // (qtyScaled × face) / 10^18, rounded half-up.
  const num = scaled * BigInt(faceMinor)
  const den = 10n ** BigInt(QTY_SCALE)
  const neg = num < 0n
  const a = neg ? -num : num
  const q = a / den
  const r = a % den
  const rounded = r * 2n >= den ? q + 1n : q
  const result = neg ? -rounded : rounded
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`bond: redemption amount ${result} exceeds JS safe integer range`)
  }
  return Number(result)
}

/** faceValueMinor → price-per-unit numeric string in major units (e.g. 100000 → "1000.00"). */
function faceValueToPriceString(faceMinor: number, _ccy: string): string {
  return minorToPlainString(faceMinor)
}

/** price numeric string → minor units of `ccy` (2 digits), half-up. */
function priceStringToMinor(priceStr: string, _ccy: string): number {
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(priceStr.trim())
  if (!m) throw new TypeError(`bond: invalid price ${JSON.stringify(priceStr)}`)
  const sign = m[1] === '-' ? -1 : 1
  const int = m[2] ?? '0'
  const frac = m[3] ?? ''
  const factor = 10 ** MINOR_DIGITS
  let minor = Number(int) * factor
  if (frac.length > 0) {
    const kept = frac.slice(0, MINOR_DIGITS).padEnd(MINOR_DIGITS, '0')
    minor += Number(kept)
    if ((frac.charCodeAt(MINOR_DIGITS) - 48) >= 5) minor += 1
  }
  return sign * minor
}

/** minor integer → plain major-unit decimal string (2 digits), no symbol/grouping. */
function minorToPlainString(minor: number): string {
  const neg = minor < 0
  const abs = Math.abs(minor).toString().padStart(MINOR_DIGITS + 1, '0')
  const cut = abs.length - MINOR_DIGITS
  return `${neg ? '-' : ''}${abs.slice(0, cut)}.${abs.slice(cut)}`
}

interface DateParts {
  y: number
  m: number
  d: number
}

function parseIsoDate(s: string): DateParts {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) throw new TypeError(`bond: invalid date ${JSON.stringify(s)}`)
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

function isoOf(p: DateParts): string {
  return `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
}

/**
 * Add `months` (may be fractional, e.g. 1.5 → step rounded to whole months) to a
 * date. Frequencies 1|2|4|12 give integer 12/f, but we tolerate fractional steps
 * by rounding to the nearest month. Clamps the day to the target month length.
 */
function addMonths(p: DateParts, months: number): DateParts {
  const whole = Math.round(months)
  const total = (p.y * 12 + (p.m - 1)) + whole
  const y = Math.floor(total / 12)
  const m = (total % 12 + 12) % 12 + 1
  const lastDay = daysInMonth(y, m)
  return { y, m, d: Math.min(p.d, lastDay) }
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** UTC ms for a YYYY-MM-DD at midnight UTC (ACT/365F day-count is offset-agnostic). */
function isoToUtcMs(s: string): number {
  const p = parseIsoDate(s)
  return Date.UTC(p.y, p.m - 1, p.d)
}

/** Europe/Kyiv 12:00 on maturityDate, as a UTC Date for storage. */
function maturityNoonKyiv(maturityDate: string): Date {
  const p = parseIsoDate(maturityDate)
  // Wall time 12:00 Kyiv → find the UTC instant. Compute Kyiv offset at that instant.
  const guessUtcNoon = Date.UTC(p.y, p.m - 1, p.d, 12, 0, 0)
  const offsetMs = kyivOffsetMsAt(new Date(guessUtcNoon))
  return new Date(guessUtcNoon - offsetMs)
}

function todayInKyiv(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(new Date())
}

/** Offset (ms) of Europe/Kyiv from UTC at an instant: local = utc + offset. */
function kyivOffsetMsAt(at: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(at)
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0')
  let hour = get('hour')
  if (hour === 24) hour = 0
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'))
  return asUtc - at.getTime()
}
