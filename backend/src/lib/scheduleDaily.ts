/**
 * scheduleDaily.ts — DST-safe daily scheduler (ST-022, arch §4).
 *
 * `scheduleDailyAt(hhmm, tz, fn)` fires `fn` once per day at wall-clock `hhmm`
 * (e.g. '23:30') in IANA time zone `tz` (e.g. 'Europe/Kyiv'). It computes the
 * milliseconds until the next occurrence via `Intl.DateTimeFormat` — never a
 * fixed 24 h interval — and RE-COMPUTES after every run, so spring-forward /
 * fall-back transitions (a 23 h or 25 h civil day) keep the wall-clock time
 * stable instead of drifting (arch §4, tardis pattern).
 *
 * In-process timer only (`setTimeout`); no external cron dependency. Returns a
 * handle with `stop()`; `start()` is idempotent. A run that throws is caught and
 * logged — it never cancels the schedule (the next day is always re-armed).
 */

import { logger } from './logger.ts'

export interface DailySchedule {
  /** Arm the timer (idempotent — a second call while armed is a no-op). */
  start: () => void
  /** Cancel the pending timer; safe to call when not armed. */
  stop: () => void
}

/**
 * The UTC-offset of `tz` at instant `at`, in minutes (e.g. Europe/Kyiv EEST = 180).
 *
 * Derived by formatting `at` as wall-clock components in `tz`, reading those back
 * as if they were UTC, and differencing — the standard offset-from-Intl trick,
 * exact to the minute and correct across DST because it is evaluated AT `at`.
 */
function tzOffsetMinutes(at: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(at)
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type)
    return part ? Number(part.value) : 0
  }
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  // (wall-clock-as-UTC − real-UTC) rounded to whole minutes = offset east of UTC.
  return Math.round((asUtc - at.getTime()) / 60000)
}

/**
 * Milliseconds from `now` until the next instant whose wall-clock time in `tz`
 * is `hh:mm:00`. Always strictly in the future (if today's slot has passed,
 * targets tomorrow). DST-correct because the offset is resolved for the
 * candidate civil day, not assumed constant.
 */
export function msUntilNext(hhmm: string, tz: string, now: Date = new Date()): number {
  const [hStr = '0', mStr = '0'] = hhmm.split(':')
  const targetH = Number(hStr)
  const targetM = Number(mStr)

  // Civil Y-M-D of `now` in `tz`.
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const pick = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = dateParts.find((p) => p.type === type)
    return part ? Number(part.value) : 0
  }
  let year = pick('year')
  let month = pick('month') // 1-12
  let day = pick('day')

  // Resolve the UTC instant for a given civil date's hh:mm in `tz`: guess using
  // the offset at the naive-UTC guess, then re-resolve once (handles the rare
  // case where the guess and target straddle a transition).
  const instantFor = (y: number, mo: number, d: number): number => {
    const naiveUtc = Date.UTC(y, mo - 1, d, targetH, targetM, 0)
    const offset1 = tzOffsetMinutes(new Date(naiveUtc), tz)
    const guess = naiveUtc - offset1 * 60000
    const offset2 = tzOffsetMinutes(new Date(guess), tz)
    return naiveUtc - offset2 * 60000
  }

  let target = instantFor(year, month, day)
  if (target <= now.getTime()) {
    // Advance one civil day and re-resolve (offset may differ across the boundary).
    const next = new Date(Date.UTC(year, month - 1, day + 1))
    year = next.getUTCFullYear()
    month = next.getUTCMonth() + 1
    day = next.getUTCDate()
    target = instantFor(year, month, day)
  }
  return target - now.getTime()
}

/**
 * Create a daily schedule that runs `fn` at wall-clock `hhmm` in `tz`.
 * The schedule is created STOPPED — call `.start()` to arm it.
 */
export function scheduleDailyAt(hhmm: string, tz: string, fn: () => void | Promise<void>): DailySchedule {
  let timer: ReturnType<typeof setTimeout> | null = null

  const arm = (): void => {
    const delay = msUntilNext(hhmm, tz, new Date())
    logger.info('scheduleDaily: armed', { hhmm, tz, delayMs: delay })
    timer = setTimeout(() => {
      // Re-arm for the next day FIRST so a long/throwing run cannot skip a day.
      arm()
      void Promise.resolve()
        .then(fn)
        .catch((err: unknown) => {
          logger.error('scheduleDaily: run failed', { hhmm, tz, message: (err as Error).message })
        })
    }, delay)
  }

  return {
    start(): void {
      if (timer !== null) return
      arm()
    },
    stop(): void {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
