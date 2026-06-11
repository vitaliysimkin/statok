/**
 * In-memory login rate-limit — FR-03, ТЗ §9.
 *
 * Sliding window of failed attempts keyed by IP (`x-forwarded-for` from Traefik):
 * max 5 failures per 15 min → 429 RATE_LIMITED + Retry-After. A successful login
 * clears the IP's counter. In-memory is sufficient (single instance, single user).
 * Applied ONLY to POST /auth/login (wired in routes/auth.ts).
 */

const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 5

/** Failure timestamps (ms epoch) per IP, oldest first. */
const failures = new Map<string, number[]>()

/** Drop timestamps older than the window; returns the surviving list. */
function prune(list: number[], now: number): number[] {
  const cutoff = now - WINDOW_MS
  // Timestamps are appended in order, so the kept slice is a suffix.
  let i = 0
  while (i < list.length && list[i]! <= cutoff) i++
  return i === 0 ? list : list.slice(i)
}

export interface RateLimitResult {
  /** True when the IP has reached the failure cap and must be blocked. */
  limited: boolean
  /** Seconds until the oldest failure ages out (for Retry-After). 0 when not limited. */
  retryAfterSeconds: number
}

/**
 * Check whether `ip` is currently rate-limited (called BEFORE verifying creds).
 * Does not mutate the counter on its own beyond pruning stale entries.
 */
export function checkRateLimit(ip: string, now: number = Date.now()): RateLimitResult {
  const existing = failures.get(ip)
  if (!existing || existing.length === 0) {
    return { limited: false, retryAfterSeconds: 0 }
  }
  const pruned = prune(existing, now)
  if (pruned.length === 0) {
    failures.delete(ip)
    return { limited: false, retryAfterSeconds: 0 }
  }
  if (pruned !== existing) failures.set(ip, pruned)

  if (pruned.length >= MAX_FAILURES) {
    const oldest = pruned[0]!
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000))
    return { limited: true, retryAfterSeconds }
  }
  return { limited: false, retryAfterSeconds: 0 }
}

/** Record one failed login attempt for `ip` (sliding window). */
export function recordFailure(ip: string, now: number = Date.now()): void {
  const pruned = prune(failures.get(ip) ?? [], now)
  pruned.push(now)
  failures.set(ip, pruned)
}

/** Clear the failure counter for `ip` — called on successful login. */
export function clearFailures(ip: string): void {
  failures.delete(ip)
}

/** Test/maintenance helper: wipe all counters. */
export function resetRateLimit(): void {
  failures.clear()
}
