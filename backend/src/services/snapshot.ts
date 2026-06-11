/**
 * snapshot.ts — net-worth snapshot builder (ST-028, arch §3.5, FR-39/FR-40).
 *
 * `runSnapshot(userId, date)`:
 *   1. computePortfolioState(atDate=date) → positions (valued in asset ccy) + cash;
 *   2. convert every value to BASE_CURRENCY at the rate as-of `date`
 *      (fallback "last previous", §3.4);
 *   3. aggregate byAccount / byClass / byCurrency (all in base minor units);
 *   4. upsert net_worth_snapshots on (userId, snapshotDate).
 *
 * `rebuild(userId, from, to)` replays runSnapshot for each Kyiv calendar date in
 * the inclusive range, sequentially, from the stored price/FX history.
 *
 * Unpriced positions (stock/etf/crypto without a quote) and currencies without an
 * FX path are simply excluded from the totals (best-effort snapshot — the EOD
 * pipeline never blocks on a single gap, arch §4).
 */

import { eq } from 'drizzle-orm'

import type { AssetType, CurrencyCode, IsoDate } from '@statok/shared'

import { db } from '../db/index.ts'
import { accounts, netWorthSnapshots } from '../db/schema.ts'
import { computePortfolioState } from './valuation.ts'
import { convert, FxRateNotFoundError } from './fx.ts'

// ---------------------------------------------------------------------------
// Types (mirror SnapshotBreakdown / NetWorthSnapshot DTOs)
// ---------------------------------------------------------------------------

interface ByAccount { accountId: string; name: string; valueMinor: number }
interface ByClass { class: AssetType; valueMinor: number }
interface ByCurrency { currency: CurrencyCode; valueMinor: number }

export interface SnapshotBreakdown {
  byAccount: ByAccount[]
  byClass: ByClass[]
  byCurrency: ByCurrency[]
}

export interface SnapshotResult {
  snapshotDate: IsoDate
  totalMinor: number
  baseCurrency: CurrencyCode
  breakdown: SnapshotBreakdown
}

function baseCcy(): CurrencyCode {
  return (process.env['BASE_CURRENCY'] ?? 'USD') as CurrencyCode
}

// ---------------------------------------------------------------------------
// runSnapshot
// ---------------------------------------------------------------------------

export async function runSnapshot(userId: string, date: IsoDate): Promise<SnapshotResult> {
  const baseCurrency = baseCcy()
  const state = await computePortfolioState(userId, { atDate: date })

  const accNames = await accountNameMap(userId)

  const byAccount = new Map<string, ByAccount>()
  const byClass = new Map<AssetType, ByClass>()
  const byCurrency = new Map<CurrencyCode, ByCurrency>()
  let totalMinor = 0

  const addAccount = (accountId: string, base: number): void => {
    const cur = byAccount.get(accountId)
    if (cur) cur.valueMinor += base
    else byAccount.set(accountId, { accountId, name: accNames.get(accountId) ?? '', valueMinor: base })
  }
  const addClass = (cls: AssetType, base: number): void => {
    const cur = byClass.get(cls)
    if (cur) cur.valueMinor += base
    else byClass.set(cls, { class: cls, valueMinor: base })
  }
  const addCurrency = (ccy: CurrencyCode, base: number): void => {
    const cur = byCurrency.get(ccy)
    if (cur) cur.valueMinor += base
    else byCurrency.set(ccy, { currency: ccy, valueMinor: base })
  }

  // Positions (asset currency → base). Unpriced positions are skipped.
  for (const pos of state.positions) {
    if (pos.valueMinor === null) continue
    const base = await toBase(pos.valueMinor, pos.asset.currency, baseCurrency, date)
    if (base === null) continue // no FX path — exclude from totals
    addAccount(pos.accountId, base)
    addClass(pos.asset.type, base)
    addCurrency(pos.asset.currency, base)
    totalMinor += base
  }

  // Cash balances (currency → base). Classified as 'cash'. May be negative.
  for (const c of state.cash) {
    if (c.balanceMinor === 0) continue
    const base = await toBase(c.balanceMinor, c.currency, baseCurrency, date)
    if (base === null) continue
    addAccount(c.accountId, base)
    addClass('cash', base)
    addCurrency(c.currency, base)
    totalMinor += base
  }

  const breakdown: SnapshotBreakdown = {
    byAccount: [...byAccount.values()],
    byClass: [...byClass.values()],
    byCurrency: [...byCurrency.values()],
  }

  // Upsert on (userId, snapshotDate).
  await db
    .insert(netWorthSnapshots)
    .values({
      userId,
      snapshotDate: date,
      baseCurrency,
      totalMinor,
      breakdown,
    })
    .onConflictDoUpdate({
      target: [netWorthSnapshots.userId, netWorthSnapshots.snapshotDate],
      set: { baseCurrency, totalMinor, breakdown, updatedAt: new Date() },
    })

  return { snapshotDate: date, totalMinor, baseCurrency, breakdown }
}

// ---------------------------------------------------------------------------
// rebuild
// ---------------------------------------------------------------------------

/** Sequentially run a snapshot for each Kyiv date in [from, to]; returns the count. */
export async function rebuild(userId: string, from: IsoDate, to: IsoDate): Promise<number> {
  const dates = enumerateDates(from, to)
  let count = 0
  for (const d of dates) {
    await runSnapshot(userId, d)
    count++
  }
  return count
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function toBase(
  amountMinor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  date: IsoDate,
): Promise<number | null> {
  if (amountMinor === 0) return 0
  try {
    const res = await convert(amountMinor, from, to, date)
    return res.amountMinor
  } catch (e) {
    if (e instanceof FxRateNotFoundError) return null
    throw e
  }
}

async function accountNameMap(userId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.userId, userId))
  return new Map(rows.map((r) => [r.id, r.name]))
}

/** Inclusive list of `YYYY-MM-DD` from `from` to `to` (calendar days). */
export function enumerateDates(from: IsoDate, to: IsoDate): IsoDate[] {
  const start = parseIso(from)
  const end = parseIso(to)
  const out: IsoDate[] = []
  // Iterate on a UTC calendar cursor (date-only — DST irrelevant for the date label).
  let cursor = Date.UTC(start.y, start.mo - 1, start.d)
  const endUtc = Date.UTC(end.y, end.mo - 1, end.d)
  // Guard against an inverted range or pathological spans (cap ~50 years).
  let guard = 0
  while (cursor <= endUtc && guard < 20000) {
    const dt = new Date(cursor)
    const y = dt.getUTCFullYear()
    const mo = String(dt.getUTCMonth() + 1).padStart(2, '0')
    const d = String(dt.getUTCDate()).padStart(2, '0')
    out.push(`${y}-${mo}-${d}`)
    cursor += 86_400_000
    guard++
  }
  return out
}

function parseIso(isoDate: IsoDate): { y: number; mo: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!m) throw new TypeError(`snapshot: invalid date ${JSON.stringify(isoDate)}`)
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) }
}
