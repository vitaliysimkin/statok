/**
 * cashAssets.ts — automatic cash-asset provisioning (ST-012, FR-16, arch §1.4).
 *
 * Cash assets (`type='cash'`) are never created by the user directly; they are
 * materialised on demand the first time a money movement in a given currency is
 * recorded (deposit/withdraw/transfer/dividend/coupon/interest/opening_balance).
 *
 * `ensureCashAsset(userId, currency)` is idempotent: it returns the existing
 * cash asset for the (user, currency) pair or creates one with
 *   type='cash', symbol=<currency>, name=<currency>, currency=<currency>,
 *   priceSource='manual'
 * The implicit price of a cash asset is identically 1 (handled by valuation,
 * not stored). The DB CHECK `assets_cash_symbol_check` enforces symbol=currency.
 */

import { and, eq } from 'drizzle-orm'

import { db } from '../db/index.ts'
import { assets } from '../db/schema.ts'

/** Row shape returned to callers — the persisted cash asset. */
export type CashAsset = typeof assets.$inferSelect

/**
 * Active ISO-4217 alphabetic currency codes (CRR-4). Validation set kept local
 * to this service — the only place a free-form currency becomes a cash asset.
 * Funds/precious-metals (X-codes) and obsolete codes are intentionally excluded.
 */
const ISO_4217: ReadonlySet<string> = new Set([
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
  'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL',
  'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHF', 'CLP', 'CNY',
  'COP', 'CRC', 'CUP', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP',
  'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD',
  'GNF', 'GTQ', 'GYD', 'HKD', 'HNL', 'HTG', 'HUF', 'IDR', 'ILS', 'INR',
  'IQD', 'IRR', 'ISK', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF',
  'KPW', 'KRW', 'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL',
  'LYD', 'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR',
  'MVR', 'MWK', 'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR',
  'NZD', 'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR',
  'RON', 'RSD', 'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD',
  'SHP', 'SLE', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP', 'SZL', 'THB',
  'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX',
  'USD', 'UYU', 'UZS', 'VED', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XCD',
  'XOF', 'XPF', 'YER', 'ZAR', 'ZMW', 'ZWG',
])

/** True when `currency` (case-insensitive) is a known active ISO-4217 code. */
export function isIso4217(currency: unknown): currency is string {
  return typeof currency === 'string' && ISO_4217.has(currency.trim().toUpperCase())
}

/**
 * Idempotently return (or create) the cash asset for `(userId, currency)`.
 *
 * @throws Error('INVALID_CURRENCY') when `currency` is not a valid ISO-4217 code
 *         (CRR-4). The message carries the offending code for the caller/log.
 */
export async function ensureCashAsset(userId: string, currency: string): Promise<CashAsset> {
  if (!isIso4217(currency)) {
    throw new Error(`INVALID_CURRENCY: ${JSON.stringify(currency)} is not a valid ISO-4217 code`)
  }
  const code = currency.trim().toUpperCase()

  // Fast path: already exists.
  const existing = await findCashAsset(userId, code)
  if (existing) return existing

  // Create; rely on the unique index (userId, type, symbol) to absorb a race
  // (two concurrent first-movements in the same currency). On conflict we fall
  // through and re-select the winner's row.
  const inserted = await db
    .insert(assets)
    .values({
      userId,
      type: 'cash',
      symbol: code,
      name: code,
      currency: code,
      priceSource: 'manual',
    })
    .onConflictDoNothing({ target: [assets.userId, assets.type, assets.symbol] })
    .returning()

  if (inserted[0]) return inserted[0]

  const winner = await findCashAsset(userId, code)
  if (winner) return winner

  // Should be unreachable: insert returned nothing and the row is absent.
  throw new Error(`ensureCashAsset: failed to provision cash asset for ${code}`)
}

async function findCashAsset(userId: string, code: string): Promise<CashAsset | undefined> {
  const rows = await db
    .select()
    .from(assets)
    .where(and(eq(assets.userId, userId), eq(assets.type, 'cash'), eq(assets.symbol, code)))
    .limit(1)
  return rows[0]
}
