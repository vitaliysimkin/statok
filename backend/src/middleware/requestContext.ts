/**
 * Request context typing + helpers (ST-010).
 *
 * Defines the Hono context variables shared across middleware/routes:
 *  - `userId`   — set by authMiddleware after a valid Bearer token
 *  - `username` — likewise, the token's username claim
 *
 * Routes read these via `getUserId(c)` / `getUsername(c)` instead of touching
 * the untyped variable map directly.
 */

import type { Context } from 'hono'

/** Shape of variables stored on the Hono context after auth. */
export interface RequestVariables {
  userId: string
  username: string
}

/** Hono env binding so `c.get('userId')` is typed across the app. */
export interface AppEnv {
  Variables: RequestVariables
}

/**
 * Resolve the client IP from `x-forwarded-for` (Traefik sets it). Takes the
 * first hop; falls back to 'unknown' when the header is absent. Used by the
 * login rate-limiter (FR-03).
 */
export function getClientIp(c: Context): string {
  const fwd = c.req.header('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return c.req.header('x-real-ip')?.trim() || 'unknown'
}

/** Authenticated user id (present only after authMiddleware). */
export function getUserId(c: Context<AppEnv>): string {
  return c.get('userId')
}

/** Authenticated username (present only after authMiddleware). */
export function getUsername(c: Context<AppEnv>): string {
  return c.get('username')
}
