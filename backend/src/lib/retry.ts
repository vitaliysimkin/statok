/**
 * retry.ts — exponential-backoff retry helper (ST-022, NFR-04, arch §4).
 *
 * `withRetry(fn, { attempts: 3, baseDelayMs: 1000, factor: 4 })` runs `fn` and,
 * on rejection, retries up to `attempts` total tries with backoff pauses of
 * `baseDelayMs × factor^k` (k = 0, 1, …) — i.e. 1s / 4s / 16s with the defaults —
 * each jittered by ±20 % to avoid thundering-herd alignment between symbols.
 *
 * Applied per individual HTTP request inside the sync jobs. After the final
 * attempt the last error is re-thrown; the job (not this helper) is responsible
 * for logging it and recording `app_settings['job.*'].lastError` so the process
 * itself never crashes (arch §4).
 */

export interface RetryOptions {
  /** Total number of attempts (initial try + retries). Default 3. */
  attempts?: number
  /** Base pause before the FIRST retry, in milliseconds. Default 1000. */
  baseDelayMs?: number
  /** Multiplier applied to the pause after each failed attempt. Default 4. */
  factor?: number
}

/** Resolve after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

/**
 * Apply ±`spread` (fractional, e.g. 0.2 → ±20 %) uniform jitter to `ms`.
 * Never returns a negative delay.
 */
function jitter(ms: number, spread = 0.2): number {
  const delta = ms * spread
  const jittered = ms - delta + Math.random() * delta * 2
  return jittered < 0 ? 0 : Math.round(jittered)
}

/**
 * Run `fn`, retrying on rejection with jittered exponential backoff.
 *
 * Pauses follow `baseDelayMs × factor^k` (k = 0-based retry index): with the
 * defaults that is 1s before retry 1, 4s before retry 2, 16s before retry 3 —
 * each ±20 % jitter. The first invocation is immediate (no pause).
 *
 * @throws the error from the final failed attempt (after exhausting `attempts`).
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3
  const baseDelayMs = options.baseDelayMs ?? 1000
  const factor = options.factor ?? 4

  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      const isLast = attempt === attempts - 1
      if (isLast) break
      const pause = jitter(baseDelayMs * factor ** attempt)
      await sleep(pause)
    }
  }
  throw lastError
}
