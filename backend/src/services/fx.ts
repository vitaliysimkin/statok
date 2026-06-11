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
        // Conservative as-of: the earlier leg date — the date by which BOTH legs hold.
        rateDate: legA.rateDate < legB.rateDate ? legA.rateDate : legB.rateDate,
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
