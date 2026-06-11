/**
 * Money helpers — CRR-3 / ТЗ §7.0, §7.6.
 *
 * Fiat amounts are stored and transported as integer `*Minor` units (cents/kopecks)
 * plus an ISO-4217 currency code. Display/parse conversions and rounding live here;
 * formatting goes through `Intl.NumberFormat`. No floating-point money arithmetic —
 * exact decimal math is in `decimal.ts`.
 */

/**
 * Number of minor-unit digits per currency. Default is 2; override here for
 * currencies that differ. Statok's v1 currencies (UAH/USD/EUR) are all 2.
 */
export const MINOR_DIGITS: Record<string, number> = {
  UAH: 2,
  USD: 2,
  EUR: 2,
};

/** Default minor-unit digits when a currency is not listed in MINOR_DIGITS. */
export const DEFAULT_MINOR_DIGITS = 2;

const ISO_CCY_RE = /^[A-Za-z]{3}$/;

function normalizeCcy(ccy: string): string {
  if (typeof ccy !== 'string' || !ISO_CCY_RE.test(ccy)) {
    throw new TypeError(`Invalid ISO-4217 currency code: ${JSON.stringify(ccy)}`);
  }
  return ccy.toUpperCase();
}

/** Minor-unit digit count for a currency (default 2). Validates the ISO code. */
export function minorDigitsOf(ccy: string): number {
  const code = normalizeCcy(ccy);
  return MINOR_DIGITS[code] ?? DEFAULT_MINOR_DIGITS;
}

/**
 * Round a numeric value half-up to the nearest integer (ties away from zero):
 * `roundHalfUp(2.5) === 3`, `roundHalfUp(-2.5) === -3`.
 *
 * For the `numeric → minor` boundary on exact decimal strings prefer the bigint
 * helpers in `decimal.ts`; this is the scalar half-up used where a JS number is
 * already in hand (e.g. an already-integer ratio expressed as a number).
 */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`roundHalfUp: value must be finite, got ${value}`);
  }
  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * Convert an integer minor amount to a plain decimal display string in major units,
 * with exactly the currency's minor-digit count of fractional places.
 * No thousands separators / symbol — use `formatMoney` for locale formatting.
 *
 * `minorToDisplay(123456, 'USD')` → "1234.56"
 * `minorToDisplay(-5, 'USD')`     → "-0.05"
 */
export function minorToDisplay(minor: number, ccy: string): string {
  if (!Number.isInteger(minor)) {
    throw new TypeError(`minorToDisplay: minor must be an integer, got ${minor}`);
  }
  const digits = minorDigitsOf(ccy);
  const negative = minor < 0;
  const abs = Math.abs(minor).toString();

  if (digits === 0) return negative ? `-${abs}` : abs;

  const padded = abs.padStart(digits + 1, '0');
  const intPart = padded.slice(0, padded.length - digits);
  const fracPart = padded.slice(padded.length - digits);
  return `${negative ? '-' : ''}${intPart}.${fracPart}`;
}

/**
 * Parse a human-entered major-unit amount string into an integer minor amount,
 * rounding half-up to the currency's minor digits. Pure integer/bigint math.
 *
 * Accepts an optional leading sign, ASCII digits, and `.` or `,` as the decimal
 * separator (single separator only). Grouping separators are NOT supported — the
 * UI passes a normalized numeric string.
 *
 * `displayToMinor('1234.56', 'USD')` → 123456
 * `displayToMinor('0.005', 'USD')`   → 1   (half-up)
 */
export function displayToMinor(str: string, ccy: string): number {
  const digits = minorDigitsOf(ccy);
  const raw = (typeof str === 'string' ? str : String(str)).trim().replace(',', '.');
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!m) {
    throw new TypeError(`displayToMinor: not a valid amount: ${JSON.stringify(str)}`);
  }
  const sign = m[1] === '-' ? -1n : 1n;
  const intPart = m[2] ?? '0';
  const fracPart = m[3] ?? '';

  const factor = 10n ** BigInt(digits);
  let minor = BigInt(intPart) * factor;

  if (digits > 0 && fracPart.length > 0) {
    if (fracPart.length <= digits) {
      minor += BigInt(fracPart.padEnd(digits, '0'));
    } else {
      const kept = fracPart.slice(0, digits);
      const roundDigit = fracPart.charCodeAt(digits) - 48;
      minor += BigInt(kept.length > 0 ? kept : '0');
      if (roundDigit >= 5) minor += 1n;
    }
  } else if (digits === 0 && fracPart.length > 0) {
    // No minor digits: round whole based on first fractional digit.
    if ((fracPart.charCodeAt(0) - 48) >= 5) minor += 1n;
  }

  const signed = sign * minor;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`displayToMinor: amount ${signed} exceeds JS safe integer range`);
  }
  return Number(signed);
}

/**
 * Format an integer minor amount as a localized currency string via
 * `Intl.NumberFormat`. The base/display currency is independent of locale
 * (e.g. USD totals stay USD whether the UI is uk or en) — ТЗ §7.3.
 *
 * `formatMoney(123456, 'USD', 'en')` → "$1,234.56"
 * `formatMoney(123456, 'USD', 'uk')` → "1 234,56 $" (locale-dependent)
 */
export function formatMoney(minor: number, ccy: string, locale?: string): string {
  if (!Number.isInteger(minor)) {
    throw new TypeError(`formatMoney: minor must be an integer, got ${minor}`);
  }
  const code = normalizeCcy(ccy);
  const digits = minorDigitsOf(code);
  const major = minor / 10 ** digits;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(major);
}
