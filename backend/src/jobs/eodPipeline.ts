/**
 * eodPipeline.ts — daily end-of-day pipeline + scheduler + boot catch-up
 * (ST-029, FR-39, arch §4 / §4.4, NFR-04).
 *
 * Single entry point `runEodPipeline()` runs the four steps SEQUENTIALLY:
 *   syncPrices → syncFxRates → processMaturedBonds → runDailySnapshot
 * A step that throws is caught + logged; the pipeline continues so the snapshot is
 * still computed from whatever data is on hand (arch §4 — "помилка кроку логується,
 * наступні кроки виконуються"). Each underlying job also records its own
 * `app_settings['job.*']` state.
 *
 * Scheduling: `scheduleDailyAt('23:30','Europe/Kyiv', runEodPipeline)` (DST-safe,
 * §4). A `running` guard prevents overlap if a slow run is still in flight when the
 * next fire (or a boot catch-up) lands — concurrent invocations no-op.
 *
 * Boot catch-up: `startEodPipelineJob()` arms the daily timer AND, when
 * `app_settings['eod.lastSuccessDate']` is older than yesterday (Kyiv) or unset,
 * schedules a one-shot run ~60 s after boot to backfill the missed day(s).
 */

import { logger } from '../lib/logger.ts'
import { scheduleDailyAt, type DailySchedule } from '../lib/scheduleDaily.ts'
import { processMaturedBonds } from '../services/bond.ts'
import {
  readEodLastSuccessDate,
  runDailySnapshot,
  todayInKyiv,
} from './dailySnapshot.ts'
import { syncFxRates } from './syncFxRates.ts'
import { syncPrices } from './syncPrices.ts'

const SCHEDULE_HHMM = '23:30'
const SCHEDULE_TZ = 'Europe/Kyiv'
/** Delay before the boot catch-up run, giving the server time to settle (arch §4). */
const CATCH_UP_DELAY_MS = 60_000

/** Re-entrancy guard — a run already in flight makes a new invocation a no-op. */
let running = false

/**
 * Run one pipeline step, swallowing (but logging) any throw so the next step still
 * executes. The step's own job-state row already captures finer-grained outcome.
 */
async function runStep(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    logger.error('eod.step_failed', { step: name, message: (err as Error).message })
  }
}

/**
 * Execute the EOD pipeline once: prices → fx → matured bonds → daily snapshot,
 * sequentially. Guarded against overlap; safe to call from the scheduler or the
 * boot catch-up. Never throws.
 */
export async function runEodPipeline(): Promise<void> {
  if (running) {
    logger.warn('eod.skip_overlap')
    return
  }
  running = true
  const startedAt = Date.now()
  logger.info('eod.pipeline_start')

  try {
    await runStep('syncPrices', () => syncPrices())
    await runStep('syncFxRates', () => syncFxRates())
    await runStep('processMaturedBonds', () => processMaturedBonds())
    await runStep('dailySnapshot', () => runDailySnapshot())
  } finally {
    running = false
    logger.info('eod.pipeline_done', { durationMs: Date.now() - startedAt })
  }
}

/** Yesterday's Kyiv calendar date (YYYY-MM-DD). */
function yesterdayInKyiv(now: Date = new Date()): string {
  // Shift 24 h back, then read the Kyiv civil date. A DST boundary shifts the
  // instant by ±1 h, never enough to cross an extra calendar day, so this is exact
  // for date-label purposes.
  return todayInKyiv(new Date(now.getTime() - 86_400_000))
}

/**
 * True when a catch-up run is warranted: the last fully-successful EOD date is
 * unset, or strictly older than yesterday (Kyiv). ISO `YYYY-MM-DD` strings order
 * lexicographically, so `<` is a valid date comparison.
 */
export async function shouldCatchUp(now: Date = new Date()): Promise<boolean> {
  const last = await readEodLastSuccessDate()
  if (last === null) return true
  return last < yesterdayInKyiv(now)
}

let schedule: DailySchedule | null = null
let catchUpTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Arm the daily 23:30 Europe/Kyiv schedule and, when the watermark indicates a
 * missed day, queue a one-shot catch-up run ~60 s after boot. Idempotent: a second
 * call while already started is a no-op. Call after migrate + seed in boot.
 */
export function startEodPipelineJob(): void {
  if (schedule !== null) return

  schedule = scheduleDailyAt(SCHEDULE_HHMM, SCHEDULE_TZ, runEodPipeline)
  schedule.start()

  // Decide catch-up asynchronously; never let it crash boot.
  void shouldCatchUp()
    .then((due) => {
      if (!due) {
        logger.info('eod.catch_up_skip')
        return
      }
      logger.info('eod.catch_up_scheduled', { delayMs: CATCH_UP_DELAY_MS })
      catchUpTimer = setTimeout(() => {
        catchUpTimer = null
        void runEodPipeline()
      }, CATCH_UP_DELAY_MS)
    })
    .catch((err: unknown) => {
      logger.error('eod.catch_up_check_failed', { message: (err as Error).message })
    })
}

/** Cancel the daily schedule and any pending catch-up timer. Safe if not started. */
export function stopEodPipelineJob(): void {
  if (schedule !== null) {
    schedule.stop()
    schedule = null
  }
  if (catchUpTimer !== null) {
    clearTimeout(catchUpTimer)
    catchUpTimer = null
  }
}
