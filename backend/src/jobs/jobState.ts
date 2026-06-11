/**
 * jobState.ts — persisted background-job run state (ST-023/024, arch §1.10).
 *
 * Reserved `app_settings` keys `job.prices` / `job.fx` / `job.snapshot` hold
 * `{ lastRunAt, lastSuccessAt, lastStatus, lastError }` (spec §1.10). `writeJobState`
 * records the outcome of a run: `lastRunAt` always advances to now; `lastSuccessAt`
 * advances only on success; `lastStatus` is `'ok' | 'error'`; `lastError` carries
 * the failure summary (or null on success). It reads-then-upserts so a prior
 * `lastSuccessAt` survives a later failure.
 */

import { eq } from 'drizzle-orm'

import { db } from '../db/index.ts'
import { appSettings } from '../db/schema.ts'

export type JobStateKey = 'job.prices' | 'job.fx' | 'job.snapshot'

export interface JobState {
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastStatus: 'ok' | 'error' | null
  lastError: string | null
}

/** Read the current state for `key`, or an all-null baseline when absent. */
export async function readJobState(key: JobStateKey): Promise<JobState> {
  const rows = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1)
  const stored = rows[0]?.value as Partial<JobState> | undefined
  return {
    lastRunAt: stored?.lastRunAt ?? null,
    lastSuccessAt: stored?.lastSuccessAt ?? null,
    lastStatus: stored?.lastStatus ?? null,
    lastError: stored?.lastError ?? null,
  }
}

/**
 * Record a completed run. `ok` drives `lastStatus`/`lastSuccessAt`; `lastError`
 * defaults to null on success. Preserves the previous `lastSuccessAt` on failure.
 */
export async function writeJobState(
  key: JobStateKey,
  outcome: { ok: boolean; lastError?: string | null },
): Promise<void> {
  const now = new Date().toISOString()
  const prev = await readJobState(key)
  const next: JobState = {
    lastRunAt: now,
    lastSuccessAt: outcome.ok ? now : prev.lastSuccessAt,
    lastStatus: outcome.ok ? 'ok' : 'error',
    lastError: outcome.ok ? null : (outcome.lastError ?? 'unknown error'),
  }
  await db
    .insert(appSettings)
    .values({ key, value: next })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } })
}
