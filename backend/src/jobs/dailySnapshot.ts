/**
 * dailySnapshot.ts — final EOD-pipeline step (ST-029, FR-39, arch §4.3).
 *
 * Computes today's (Europe/Kyiv) net-worth snapshot for every user via the shared
 * `runSnapshot(userId, date)` service (§3.5: computePortfolioState + valuation →
 * upsert net_worth_snapshots). Single-user app, but we iterate `users` so the loop
 * is correct regardless of seeded-account count.
 *
 * On full success the EOD watermark advances: `app_settings['eod.lastSuccessDate']`
 * is set to today — this is what the boot catch-up (eodPipeline) reads to decide
 * whether a missed day must be replayed. A per-user failure is logged and does NOT
 * abort the others, but it DOES hold back the watermark (and records an error in
 * `app_settings['job.snapshot']`), so the next boot still triggers catch-up.
 *
 * Manual triggers (`POST /api/snapshots/run|rebuild`) call the same `runSnapshot`
 * service directly and intentionally do NOT touch the EOD watermark.
 */

import { eq } from 'drizzle-orm'

import { db } from '../db/index.ts'
import { appSettings, users } from '../db/schema.ts'
import { logger } from '../lib/logger.ts'
import { runSnapshot } from '../services/snapshot.ts'
import { writeJobState } from './jobState.ts'

/** Reserved app_settings key holding the last fully-successful EOD date (YYYY-MM-DD). */
export const EOD_LAST_SUCCESS_KEY = 'eod.lastSuccessDate'

/** Today's calendar date (YYYY-MM-DD) in Europe/Kyiv. */
export function todayInKyiv(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Read `eod.lastSuccessDate` (or null when never set). */
export async function readEodLastSuccessDate(): Promise<string | null> {
  const rows = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, EOD_LAST_SUCCESS_KEY))
    .limit(1)
  const v = rows[0]?.value
  return typeof v === 'string' ? v : null
}

/** Persist `eod.lastSuccessDate = date`. */
async function writeEodLastSuccessDate(date: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: EOD_LAST_SUCCESS_KEY, value: date })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: date, updatedAt: new Date() },
    })
}

export interface DailySnapshotResult {
  date: string
  okUsers: number
  errUsers: number
}

/**
 * Build today's snapshot for all users. `today` defaults to the current Kyiv date.
 * Never throws for a single user's failure — failures are collected, logged, and
 * surfaced via the return value + `app_settings['job.snapshot']`.
 *
 * Side effects on full success: `eod.lastSuccessDate = today`.
 */
export async function runDailySnapshot(today?: string): Promise<DailySnapshotResult> {
  const date = today ?? todayInKyiv()
  const startedAt = Date.now()

  const rows = await db.select({ id: users.id }).from(users)

  let okUsers = 0
  const errors: string[] = []

  for (const u of rows) {
    try {
      await runSnapshot(u.id, date)
      okUsers++
    } catch (err) {
      const message = (err as Error).message
      errors.push(`${u.id}: ${message}`)
      logger.error('snapshot.user_failed', { userId: u.id, date, message })
    }
  }

  const errUsers = errors.length
  const ok = errUsers === 0
  const durationMs = Date.now() - startedAt
  logger.info('snapshot.daily_done', { date, okUsers, errUsers, durationMs })

  await writeJobState('job.snapshot', {
    ok,
    lastError: ok ? null : errors.join('; '),
  })

  // Advance the EOD watermark only when every user succeeded — a partial run must
  // still trip the next boot catch-up.
  if (ok) await writeEodLastSuccessDate(date)

  return { date, okUsers, errUsers }
}
