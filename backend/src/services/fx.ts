/**
 * fx.ts — currency conversion with fallback resolution (ТЗ §7.3.4, FR-33).
 *
 * Stored semantics (`fx_rates`, §7.1.8): one row means `1 baseCcy = rate quoteCcy`.
 * Therefore converting an amount `from → to` multiplies by the `(from, to)` rate.
 *
 * resolveRate(from, to, date):
 *   a. direct row `(from, to)` with the greatest `rate_date ≤ date`
 *      (this IS the "last previous rate" fallback for weekends/holidays/gaps);
 *   b. else inverse row `(to, from)` → `1 / rate`;
 *   c. else pivot through USD: `resolveRate(from,'USD') × resolveRate('USD',to)`
 *      (one recursion level only, each leg using steps a–b);
 *   d. nothing → throws FX_RATE_NOT_FOUND.
 *
 * All multiplication is bigint fixed-point (rate scale 8), rounded half-up only at
 * the final `minor` boundary — no float anywhere (CRR-3). Manual rows participate on
 * equal footing (unique per pair+date — a single row).
 */

import { and, desc, eq, lte } from 'drizzle-orm'
import { divRoundHalfUp, RATE_SCALE, type CurrencyCode, type IsoDate } from '@statok/shared'

import { db } from '../db/index.ts'
import { fxRates } from '../db/schema.ts'

const PIVOT = 'USD'
const RATE_FACTOR = 10n ** BigInt(RATE_SCALE) // 1e8 — scale of a single stored rate

/** Domain error carrying the machine code expected by the HTTP error mapper. */
export class FxRateNotFoundError extends Error {
  readonly code = 'FX_RATE_NOT_FOUND'
  constructor(from: string, to: string, date: string) {
    super(`No FX rate to convert ${from}→${to} on or before ${date}`)
    this.name = 'FxRateNotFoundError'
  }
}

/**
 * Effective rate as a fixed-point fraction `num / 10^scale`, plus the as-of date.
 * Kept as numerator+scale (not pre-divided) so a pivot can multiply two legs with
 * zero intermediate rounding before the single final round in `convert`.
 */
interface ResolvedRate {
  num: bigint
  scale: number
  rateDate: IsoDate
}

/** Fetch the most recent stored row for an ordered pair with `rate_date ≤ date`. */
async function fetchLatestRow(
  base: string,
  quote: string,
  date: IsoDate,
): Promise<{ rate: string; rateDate: IsoDate } | null> {
  const rows = await db
    .select({ rate: fxRates.rate, rateDate: fxRates.rateDate })
    .from(fxRates)
    .where(and(eq(fxRates.baseCcy, base), eq(fxRates.quoteCcy, quote), lte(fxRates.rateDate, date)))
    .orderBy(desc(fxRates.rateDate))
    .limit(1)
  const row = rows[0]
  return row ? { rate: row.rate, rateDate: row.rateDate } : null
}

/** Parse a stored numeric rate string into a scale-8 bigint numerator. */
function rateToNum(rateStr: string): bigint {
  // `rate` is numeric(18,8); parse without float to a scale-8 integer.
  const [intPart = '0', fracPart = ''] = rateStr.trim().split('.')
  const frac = fracPart.slice(0, RATE_SCALE).padEnd(RATE_SCALE, '0')
  return BigInt(intPart) * RATE_FACTOR + BigInt(frac)
}

/**
 * Direct-or-inverse rate for an ordered pair (steps a–b only). Returns null when
 * neither a direct `(from,to)` nor an inverse `(to,from)` row exists ≤ date.
 */
async function resolveDirectOrInverse(
  from: string,
  to: string,
  date: IsoDate,
): Promise<ResolvedRate | null> {
  const direct = await fetchLatestRow(from, to, date)
  if (direct) {
    return { num: rateToNum(direct.rate), scale: RATE_SCALE, rateDate: direct.rateDate }
  }
  const inverse = await fetchLatestRow(to, from, date)
  if (inverse) {
    // 1 / rate, kept exact: (1e8 / rateNum) at scale 8 ⇒ (1e8 * 1e8) / rateNum.
    const invNum = rateToNum(inverse.rate)
    return { num: divRoundHalfUp(RATE_FACTOR * RATE_FACTOR, invNum), scale: RATE_SCALE, rateDate: inverse.rateDate }
  }
  return null
}

/**
 * Resolve the effective `from → to` rate on `date` with direct → inverse → USD-pivot
 * fallback. Throws {@link FxRateNotFoundError} when no path exists.
 */
async function resolveRate(from: string, to: string, date: IsoDate): Promise<ResolvedRate> {
  const directOrInverse = await resolveDirectOrInverse(from, to, date)
  if (directOrInverse) return directOrInverse

  // Pivot through USD (one level): from→USD × USD→to, each via steps a–b.
  if (from !== PIVOT && to !== PIVOT) {
    const legA = await resolveDirectOrInverse(from, PIVOT, date)
    const legB = await resolveDirectOrInverse(PIVOT, to, date)
    if (legA && legB) {
      return {
        num: legA.num * legB.num, // scale 8 × scale 8 ⇒ scale 16, no rounding yet
        scale: legA.scale + legB.scale,
        // As-of: the LATER leg date — the date from which BOTH legs are in effect.
        rateDate: legA.rateDate > legB.rateDate ? legA.rateDate : legB.rateDate,
      }
    }
  }

  throw new FxRateNotFoundError(from, to, date)
}

/** Render a fixed-point fraction `num / 10^scale` as a scale-8 numeric string. */
function formatRate(num: bigint, scale: number): string {
  const scaled = scale === RATE_SCALE ? num : divRoundHalfUp(num, 10n ** BigInt(scale - RATE_SCALE))
  const neg = scaled < 0n
  const abs = neg ? -scaled : scaled
  const intPart = abs / RATE_FACTOR
  const frac = (abs % RATE_FACTOR).toString().padStart(RATE_SCALE, '0')
  return `${neg ? '-' : ''}${intPart}.${frac}`
}

export interface ConvertResult {
  amountMinor: number
  rateUsed: string
  rateDate: IsoDate
}

/**
 * Convert `amountMinor` from one currency to another as of `date`.
 *
 * - `from === to` → identity (no rate lookup).
 * - otherwise resolve the rate (direct/inverse/USD-pivot) and apply
 *   `roundHalfUp(amountMinor × rate)` in bigint fixed-point.
 *
 * @throws {FxRateNotFoundError} when no rate path exists on or before `date`.
 */
export async function convert(
  amountMinor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  date: IsoDate,
): Promise<ConvertResult> {
  if (from === to) {
    return { amountMinor, rateUsed: '1.00000000', rateDate: date }
  }

  const { num, scale, rateDate } = await resolveRate(from, to, date)
  // amountMinor × (num / 10^scale), rounded half-up at the single final boundary.
  const converted = divRoundHalfUp(BigInt(amountMinor) * num, 10n ** BigInt(scale))

  if (converted > BigInt(Number.MAX_SAFE_INTEGER) || converted < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`fx.convert: result ${converted} exceeds JS safe integer range`)
  }

  return { amountMinor: Number(converted), rateUsed: formatRate(num, scale), rateDate }
}

// ---------------------------------------------------------------------------
// In-memory resolver (NFR-03) — load every fx_rates row once, resolve with the
// EXACT same semantics as the per-call `convert` above, with zero further SQL.
//
// The service `convert` issues 1–3 SQL round-trips per call (direct → inverse →
// two pivot legs). Period folds (pnl.foldPeriod, dashboards-cashflow) call it
// once per transaction → thousands of sequential round-trips over ~20k history.
// The resolver replaces that with a single SELECT and pure in-memory lookups.
//
// fx_rates is tiny (single-user) so loading it whole is cheap; the in-memory
// index mirrors the unique index `(base_ccy, quote_ccy, rate_date)`.
// ---------------------------------------------------------------------------

/** A stored fx_rates row, as needed by the resolver. */
export interface FxRateRow {
  rateDate: IsoDate
  baseCcy: string
  quoteCcy: string
  rate: string
}

/**
 * Resolver over a preloaded set of fx_rates rows. `convert` is identical in
 * signature, result shape, and numeric behaviour to the service-level `convert`.
 */
export interface FxResolver {
  convert(amountMinor: number, from: CurrencyCode, to: CurrencyCode, date: IsoDate): ConvertResult
}

/**
 * Build a resolver from rows already in memory. Rows are indexed by ordered pair;
 * each pair's rows are sorted ascending by `rate_date` so a "latest ≤ date" lookup
 * is a single descending scan (the set is tiny — no need for binary search).
 */
export function createFxResolver(rows: readonly FxRateRow[]): FxResolver {
  // pair key `base>quote` → rows sorted ascending by rateDate.
  const byPair = new Map<string, { rateDate: IsoDate; rate: string }[]>()
  for (const r of rows) {
    const key = `${r.baseCcy}>${r.quoteCcy}`
    let list = byPair.get(key)
    if (!list) {
      list = []
      byPair.set(key, list)
    }
    list.push({ rateDate: r.rateDate, rate: r.rate })
  }
  for (const list of byPair.values()) {
    list.sort((a, b) => (a.rateDate < b.rateDate ? -1 : a.rateDate > b.rateDate ? 1 : 0))
  }

  // Latest stored row for an ordered pair with `rate_date ≤ date` (mirrors fetchLatestRow).
  const latestRow = (base: string, quote: string, date: IsoDate): { rate: string; rateDate: IsoDate } | null => {
    const list = byPair.get(`${base}>${quote}`)
    if (!list) return null
    for (let i = list.length - 1; i >= 0; i--) {
      const row = list[i]!
      if (row.rateDate <= date) return { rate: row.rate, rateDate: row.rateDate }
    }
    return null
  }

  // Direct-or-inverse for an ordered pair (steps a–b), mirroring resolveDirectOrInverse.
  const directOrInverse = (from: string, to: string, date: IsoDate): ResolvedRate | null => {
    const direct = latestRow(from, to, date)
    if (direct) {
      return { num: rateToNum(direct.rate), scale: RATE_SCALE, rateDate: direct.rateDate }
    }
    const inverse = latestRow(to, from, date)
    if (inverse) {
      const invNum = rateToNum(inverse.rate)
      return { num: divRoundHalfUp(RATE_FACTOR * RATE_FACTOR, invNum), scale: RATE_SCALE, rateDate: inverse.rateDate }
    }
    return null
  }

  // Full resolution with direct → inverse → USD-pivot fallback (mirrors resolveRate).
  const resolve = (from: string, to: string, date: IsoDate): ResolvedRate => {
    const di = directOrInverse(from, to, date)
    if (di) return di

    if (from !== PIVOT && to !== PIVOT) {
      const legA = directOrInverse(from, PIVOT, date)
      const legB = directOrInverse(PIVOT, to, date)
      if (legA && legB) {
        return {
          num: legA.num * legB.num,
          scale: legA.scale + legB.scale,
          // As-of: the LATER leg date — the date from which BOTH legs are in effect.
          rateDate: legA.rateDate > legB.rateDate ? legA.rateDate : legB.rateDate,
        }
      }
    }

    throw new FxRateNotFoundError(from, to, date)
  }

  return {
    convert(amountMinor: number, from: CurrencyCode, to: CurrencyCode, date: IsoDate): ConvertResult {
      if (from === to) {
        return { amountMinor, rateUsed: '1.00000000', rateDate: date }
      }

      const { num, scale, rateDate } = resolve(from, to, date)
      const converted = divRoundHalfUp(BigInt(amountMinor) * num, 10n ** BigInt(scale))

      if (converted > BigInt(Number.MAX_SAFE_INTEGER) || converted < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new RangeError(`fx.convert: result ${converted} exceeds JS safe integer range`)
      }

      return { amountMinor: Number(converted), rateUsed: formatRate(num, scale), rateDate }
    },
  }
}

/** Load every fx_rates row once and build an in-memory {@link FxResolver}. */
export async function loadFxResolver(): Promise<FxResolver> {
  const rows = await db
    .select({
      rateDate: fxRates.rateDate,
      baseCcy: fxRates.baseCcy,
      quoteCcy: fxRates.quoteCcy,
      rate: fxRates.rate,
    })
    .from(fxRates)
  return createFxResolver(rows)
}
