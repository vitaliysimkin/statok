/**
 * Bigint fixed-point decimal helpers — CRR-3 / ТЗ §7.0, §7.6.
 *
 * No floating point anywhere on the money/quantity path. Decimal numbers arriving
 * from the API/DB as strings (drizzle `numeric` default) are parsed into scaled
 * bigint integers, multiplied exactly, and rounded half-up only at the final
 * `numeric → minor` boundary.
 *
 * Conventions (mirror DB column scales):
 *   - quantity  numeric(38,18)  → scale 18
 *   - price     numeric(20,8)   → scale 8
 *   - rate      numeric(18,8)   → scale 8
 */

import { minorDigitsOf } from './money';

/** Canonical fixed-point scales matching the DB numeric columns. */
export const QTY_SCALE = 18;
export const PRICE_SCALE = 8;
export const RATE_SCALE = 8;

const DEC_RE = /^[+-]?(\d+)(\.(\d+))?$/;

/**
 * Parse a decimal string into a bigint scaled by 10^scale, rounding half-up when
 * the string carries more fractional digits than `scale`.
 *
 * `parseDec('1.5', 18)` → 1500000000000000000n
 * `parseDec('0.005', 2)` → 1n  (half-up)
 *
 * @throws on non-finite / non-numeric input or a negative scale.
 */
export function parseDec(str: string, scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new RangeError(`parseDec: scale must be a non-negative integer, got ${scale}`);
  }
  const raw = typeof str === 'string' ? str.trim() : String(str);
  const m = DEC_RE.exec(raw);
  if (!m) {
    throw new TypeError(`parseDec: not a decimal number: ${JSON.stringify(str)}`);
  }
  const negative = raw[0] === '-';
  const intPart = m[1] ?? '0';
  const fracPart = m[3] ?? '';

  const factor = 10n ** BigInt(scale);
  let scaled = BigInt(intPart) * factor;

  if (fracPart.length > 0) {
    if (fracPart.length <= scale) {
      scaled += BigInt(fracPart.padEnd(scale, '0'));
    } else {
      // Keep `scale` digits, use the next digit to round half-up.
      const kept = fracPart.slice(0, scale);
      const roundDigit = fracPart.charCodeAt(scale) - 48; // '0' = 48
      scaled += BigInt(kept.length > 0 ? kept : '0');
      if (roundDigit >= 5) scaled += 1n;
    }
  }

  return negative ? -scaled : scaled;
}

/**
 * Divide two bigints rounding the quotient half-up (away from zero on a .5 tie),
 * sign-correct. Used as the rounding primitive for proportions and conversions.
 */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new RangeError('divRoundHalfUp: division by zero');
  }
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  // half-up: round when remainder*2 >= denominator
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/**
 * Convert a quantity string × price string into an integer amount in minor units
 * of `ccy`, half-up at the final boundary. Pure bigint, no float.
 *
 * qty (scale 18) × price (scale 8) → product at scale 26; then scale down to the
 * currency's minor digits.
 *
 * `mulToMinor('10', '99.5', 'USD')` → 99500  (i.e. 995.00 USD)
 */
export function mulToMinor(qtyStr: string, priceStr: string, ccy: string): number {
  const qty = parseDec(qtyStr, QTY_SCALE);
  const price = parseDec(priceStr, PRICE_SCALE);
  const product = qty * price; // scale = QTY_SCALE + PRICE_SCALE
  const minorDigits = minorDigitsOf(ccy);
  const downscale = 10n ** BigInt(QTY_SCALE + PRICE_SCALE - minorDigits);
  const minor = divRoundHalfUp(product, downscale);
  return bigintToSafeNumber(minor);
}

/**
 * Proportional split of a minor-unit total: `roundHalfUp(totalMinor × part / whole)`.
 * Used for weighted-average cost basis (e.g. cost portion released on a partial sell).
 * Pure bigint, no float.
 *
 * `part`/`whole` are decimal strings (e.g. quantities). `whole` must be non-zero.
 */
export function proportionMinor(totalMinor: number, partStr: string, wholeStr: string): number {
  assertSafeMinor(totalMinor, 'proportionMinor.totalMinor');
  // part/whole can share any common scale; QTY_SCALE covers quantity precision.
  const part = parseDec(partStr, QTY_SCALE);
  const whole = parseDec(wholeStr, QTY_SCALE);
  if (whole === 0n) {
    throw new RangeError('proportionMinor: whole must be non-zero');
  }
  const result = divRoundHalfUp(BigInt(totalMinor) * part, whole);
  return bigintToSafeNumber(result);
}

function assertSafeMinor(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label}: expected a safe integer minor amount, got ${value}`);
  }
}

function bigintToSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`decimal: minor amount ${value} exceeds JS safe integer range`);
  }
  return Number(value);
}
