/**
 * syncPrices.ts — daily Yahoo close-price sweep (ST-023, FR-28/29, arch §4.1).
 *
 * Scope: assets `type IN ('stock','etf','crypto') AND price_source='yahoo' AND
 * archived_at IS NULL`. For each, fetch the Yahoo unofficial chart API
 * (`interval=1d&range=7d` — range 7d back-fills days missed after downtime),
 * parse one close per exchange-local day, and upsert into `price_quotes` with
 * `source='yahoo'`. Manual rows are NEVER overwritten (ON CONFLICT … WHERE
 * source <> 'manual'). Per-symbol errors are logged and do not abort the sweep;
 * a summary (okCount/errCount) and run-state land in `app_settings['job.prices']`.
 *
 * Privacy (NFR-01): the only hosts contacted are query1/query2.finance.yahoo.com.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import { db } from '../db/index.ts'
import { assets, priceQuotes } from '../db/schema.ts'
import { logger } from '../lib/logger.ts'
import { withRetry } from '../lib/retry.ts'
import { writeJobState } from './jobState.ts'

const PRIMARY_HOST = 'query1.finance.yahoo.com'
const FALLBACK_HOST = 'query2.finance.yahoo.com'
const USER_AGENT = 'Mozilla/5.0 (compatible; Statok/1.0)'
const INTER_SYMBOL_PAUSE_MS = 500

/** Minimal shape of the Yahoo chart payload we consume. */
interface YahooChartResponse {
  chart?: {
    error?: unknown
    result?: Array<{
      meta?: { currency?: string; exchangeTimezoneName?: string }
      timestamp?: number[]
      indicators?: { quote?: Array<{ close?: Array<number | null> }> }
    }>
  }
}

export interface SyncPricesResult {
  okCount: number
  errCount: number
  errors: Array<{ symbol: string; message: string }>
}

/** Per-asset scope row. */
type ScopedAsset = Pick<typeof assets.$inferSelect, 'id' | 'symbol' | 'currency'>

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

/**
 * Convert a unix-seconds session timestamp to the exchange-local calendar date
 * (`YYYY-MM-DD`) using the exchange IANA TZ. en-CA yields ISO order natively.
 */
function quoteDateInTz(unixSeconds: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unixSeconds * 1000))
}

/**
 * Fetch + parse one symbol's chart, trying the primary host then the fallback
 * host on any network/HTTP error. Each host attempt is wrapped in `withRetry`.
 * @throws when both hosts fail or Yahoo reports `chart.error`.
 */
async function fetchChart(symbol: string): Promise<YahooChartResponse> {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=7d`
  const attemptHost = async (host: string): Promise<YahooChartResponse> => {
    const res = await fetch(`https://${host}${path}`, {
      headers: { 'User-Agent': USER_AGENT },
    })
    if (!res.ok) {
      throw new Error(`Yahoo ${host} HTTP ${res.status}`)
    }
    return (await res.json()) as YahooChartResponse
  }

  let body: YahooChartResponse
  try {
    body = await withRetry(() => attemptHost(PRIMARY_HOST))
  } catch (primaryErr) {
    logger.warn('prices.host_fallback', {
      symbol,
      message: (primaryErr as Error).message,
    })
    body = await withRetry(() => attemptHost(FALLBACK_HOST))
  }

  if (body.chart?.error != null) {
    throw new Error(`Yahoo chart.error for ${symbol}: ${JSON.stringify(body.chart.error)}`)
  }
  return body
}

/**
 * Upsert one (asset, date) close at `source='yahoo'`. The partial WHERE keeps
 * manual rows untouched: a manual row for the same (asset, date) is left as-is.
 */
async function upsertQuote(
  assetId: string,
  quoteDate: string,
  priceStr: string,
  currency: string,
): Promise<void> {
  await db
    .insert(priceQuotes)
    .values({ assetId, quoteDate, price: priceStr, currency, source: 'yahoo' })
    .onConflictDoUpdate({
      target: [priceQuotes.assetId, priceQuotes.quoteDate],
      set: { price: priceStr, currency, updatedAt: sql`now()` },
      setWhere: sql`${priceQuotes.source} <> 'manual'`,
    })
}

/** Process a single asset; returns the number of quote rows written. */
async function syncOneAsset(asset: ScopedAsset): Promise<number> {
  const body = await fetchChart(asset.symbol)
  const result = body.chart?.result?.[0]
  if (!result) {
    throw new Error(`Yahoo: empty result for ${asset.symbol}`)
  }

  const quoteCurrency = (result.meta?.currency ?? asset.currency).toUpperCase()
  if (quoteCurrency !== asset.currency.toUpperCase()) {
    // Quotes are written in the currency Yahoo reports (meta.currency), per spec.
    logger.warn('prices.currency_mismatch', {
      symbol: asset.symbol,
      assetCurrency: asset.currency,
      quoteCurrency,
    })
  }

  const exchangeTz = result.meta?.exchangeTimezoneName ?? 'UTC'
  const timestamps = result.timestamp ?? []
  const closes = result.indicators?.quote?.[0]?.close ?? []

  let written = 0
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i]
    const close = closes[i]
    if (ts == null || close == null) continue // null-elements skipped (FR-28)
    const quoteDate = quoteDateInTz(ts, exchangeTz)
    await upsertQuote(asset.id, quoteDate, String(close), quoteCurrency)
    written++
  }
  return written
}

/**
 * Run the price sweep. With `assetId` set, only that asset is synced (used by
 * the manual `POST /api/prices/sync` trigger); otherwise the full Yahoo scope.
 * Always returns a summary — never throws for per-symbol failures.
 */
export async function syncPrices(opts: { assetId?: string } = {}): Promise<SyncPricesResult> {
  const startedAt = Date.now()

  const scope: ScopedAsset[] = await db
    .select({ id: assets.id, symbol: assets.symbol, currency: assets.currency })
    .from(assets)
    .where(
      and(
        inArray(assets.type, ['stock', 'etf', 'crypto']),
        eq(assets.priceSource, 'yahoo'),
        isNull(assets.archivedAt),
        ...(opts.assetId ? [eq(assets.id, opts.assetId)] : []),
      ),
    )

  const errors: Array<{ symbol: string; message: string }> = []
  let okCount = 0

  for (let i = 0; i < scope.length; i++) {
    const asset = scope[i]
    if (!asset) continue
    try {
      await syncOneAsset(asset)
      okCount++
    } catch (err) {
      const message = (err as Error).message
      errors.push({ symbol: asset.symbol, message })
      logger.error('prices.symbol_failed', { symbol: asset.symbol, message })
    }
    if (i < scope.length - 1) await sleep(INTER_SYMBOL_PAUSE_MS)
  }

  const errCount = errors.length
  const durationMs = Date.now() - startedAt
  logger.info('prices.sweep_done', { okCount, errCount, durationMs })

  await writeJobState('job.prices', {
    ok: errCount === 0,
    lastError: errCount === 0 ? null : `${errCount} symbol(s) failed`,
  })

  return { okCount, errCount, errors }
}
