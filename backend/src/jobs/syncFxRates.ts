/**
 * syncFxRates.ts — daily FX rate sweep, two independent branches (ST-024,
 * FR-32/34, arch §4.2).
 *
 * `needed = distinct(assets.currency) ∪ {BASE_CURRENCY, UAH, USD, EUR}`.
 *
 *  - Frankfurter (ECB cross-rates, base USD): `GET .../latest?base=USD&symbols=…`
 *    over `needed − {USD, UAH}` (UAH is absent from ECB — that is why NBU is
 *    mandatory). Primary host api.frankfurter.dev, fallback api.frankfurter.app
 *    on any network/HTTP error. Each `(ccy, rate)` → upsert
 *    `(rate_date=body.date, USD, ccy, rate, 'frankfurter')`. On weekends body.date
 *    is the prior Friday — that date is upserted (natural fallback).
 *  - НБУ (official UAH): `GET bank.gov.ua/.../exchange?json` → filter `cc ∈ needed`,
 *    `exchangedate` (dd.MM.yyyy) → rate_date, upsert `(rate_date, cc, 'UAH', rate, 'nbu')`.
 *
 * Branches are independent: one failing does not block the other. Upserts never
 * overwrite manual rows. Combined run-state lands in `app_settings['job.fx']`.
 *
 * Privacy (NFR-01): only api.frankfurter.dev / api.frankfurter.app / bank.gov.ua.
 */

import { sql } from 'drizzle-orm'

import { db } from '../db/index.ts'
import { assets, fxRates } from '../db/schema.ts'
import { logger } from '../lib/logger.ts'
import { withRetry } from '../lib/retry.ts'
import { writeJobState } from './jobState.ts'

const FRANKFURTER_PRIMARY = 'https://api.frankfurter.dev/v1/latest'
const FRANKFURTER_FALLBACK = 'https://api.frankfurter.app/latest'
const NBU_URL = 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json'

interface FrankfurterResponse {
  amount?: number
  base?: string
  date?: string
  rates?: Record<string, number>
}

interface NbuRow {
  cc?: string
  rate?: number
  exchangedate?: string
}

export interface FxBranchResult {
  ok: boolean
  ratesUpserted: number
  error?: string
}

export interface SyncFxResult {
  frankfurter: FxBranchResult
  nbu: FxBranchResult
}

/**
 * `needed` currency set: distinct asset currencies plus the always-required
 * BASE_CURRENCY/UAH/USD/EUR. BASE_CURRENCY is read from env (default USD).
 */
async function computeNeeded(): Promise<Set<string>> {
  const rows = await db.selectDistinct({ currency: assets.currency }).from(assets)
  const base = (process.env.BASE_CURRENCY ?? 'USD').toUpperCase()
  const needed = new Set<string>(['UAH', 'USD', 'EUR', base])
  for (const r of rows) {
    if (r.currency) needed.add(r.currency.toUpperCase())
  }
  return needed
}

/** Upsert one FX row, never clobbering a manual row for the same (date, base, quote). */
async function upsertRate(
  rateDate: string,
  baseCcy: string,
  quoteCcy: string,
  rate: number,
  source: 'frankfurter' | 'nbu',
): Promise<void> {
  await db
    .insert(fxRates)
    .values({ rateDate, baseCcy, quoteCcy, rate: String(rate), source })
    .onConflictDoUpdate({
      target: [fxRates.rateDate, fxRates.baseCcy, fxRates.quoteCcy],
      set: { rate: String(rate), source },
      setWhere: sql`${fxRates.source} <> 'manual'`,
    })
}

/** Convert NBU `dd.MM.yyyy` to ISO `YYYY-MM-DD`. */
function nbuDateToIso(ddmmyyyy: string): string {
  const [dd = '01', mm = '01', yyyy = '1970'] = ddmmyyyy.split('.')
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

/** Frankfurter branch: fetch USD-based cross-rates and upsert them. */
async function syncFrankfurter(needed: Set<string>): Promise<FxBranchResult> {
  const symbols = [...needed].filter((c) => c !== 'USD' && c !== 'UAH').sort()
  if (symbols.length === 0) {
    return { ok: true, ratesUpserted: 0 }
  }
  const query = `?base=USD&symbols=${symbols.join(',')}`

  const attempt = async (baseUrl: string): Promise<FrankfurterResponse> => {
    const res = await fetch(`${baseUrl}${query}`)
    if (!res.ok) throw new Error(`Frankfurter ${baseUrl} HTTP ${res.status}`)
    return (await res.json()) as FrankfurterResponse
  }

  try {
    let body: FrankfurterResponse
    try {
      body = await withRetry(() => attempt(FRANKFURTER_PRIMARY))
    } catch (primaryErr) {
      logger.warn('fx.frankfurter_fallback', { message: (primaryErr as Error).message })
      body = await withRetry(() => attempt(FRANKFURTER_FALLBACK))
    }

    const rateDate = body.date
    const rates = body.rates ?? {}
    if (!rateDate) throw new Error('Frankfurter: missing date in response')

    let upserted = 0
    for (const [ccy, rate] of Object.entries(rates)) {
      if (rate == null) continue
      await upsertRate(rateDate, 'USD', ccy.toUpperCase(), rate, 'frankfurter')
      upserted++
    }
    logger.info('fx.frankfurter_done', { rateDate, ratesUpserted: upserted })
    return { ok: true, ratesUpserted: upserted }
  } catch (err) {
    const message = (err as Error).message
    logger.error('fx.frankfurter_failed', { message })
    return { ok: false, ratesUpserted: 0, error: message }
  }
}

/** НБУ branch: fetch official UAH rates and upsert the needed currencies. */
async function syncNbu(needed: Set<string>): Promise<FxBranchResult> {
  try {
    const rows = await withRetry(async () => {
      const res = await fetch(NBU_URL)
      if (!res.ok) throw new Error(`NBU HTTP ${res.status}`)
      return (await res.json()) as NbuRow[]
    })

    let upserted = 0
    for (const row of rows) {
      const cc = row.cc?.toUpperCase()
      if (!cc || !needed.has(cc) || cc === 'UAH') continue
      if (row.rate == null || !row.exchangedate) continue
      const rateDate = nbuDateToIso(row.exchangedate)
      await upsertRate(rateDate, cc, 'UAH', row.rate, 'nbu')
      upserted++
    }
    logger.info('fx.nbu_done', { ratesUpserted: upserted })
    return { ok: true, ratesUpserted: upserted }
  } catch (err) {
    const message = (err as Error).message
    logger.error('fx.nbu_failed', { message })
    return { ok: false, ratesUpserted: 0, error: message }
  }
}

/**
 * Run both FX branches independently and record combined run-state. Never throws
 * for a branch failure — the partial result is returned and reflected in
 * `app_settings['job.fx']` (ok only when BOTH branches succeeded).
 */
export async function syncFxRates(): Promise<SyncFxResult> {
  const needed = await computeNeeded()

  // Independent branches: a rejection in one must not abort the other.
  const [frankfurter, nbu] = await Promise.all([syncFrankfurter(needed), syncNbu(needed)])

  const ok = frankfurter.ok && nbu.ok
  const errorParts: string[] = []
  if (!frankfurter.ok) errorParts.push(`frankfurter: ${frankfurter.error}`)
  if (!nbu.ok) errorParts.push(`nbu: ${nbu.error}`)

  await writeJobState('job.fx', {
    ok,
    lastError: ok ? null : errorParts.join('; '),
  })

  return { frankfurter, nbu }
}
