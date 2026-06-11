/**
 * Auth routes — FR-02, FR-03, FR-04 (ТЗ §2 auth).
 *
 *  POST /auth/login    {username,password} → {token,username}   (bcrypt + rate-limit)
 *  POST /auth/refresh   (Bearer)           → {token}            (sliding, fresh TTL 7d)
 *  GET  /auth/me        (Bearer)           → {userId,username}
 *  POST /auth/logout    (Bearer)           → {ok:true}          (log only)
 *
 * Mounted at /auth in index.ts. Rate-limit (FR-03) and bcrypt verification apply
 * ONLY to /login. /refresh, /me, /logout sit behind authMiddleware. Logs carry
 * username + ip + reason only — never the password or token (FR-02, NFR-02).
 */

import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { signToken } from '../lib/jwt.js'
import { verifyPassword } from '../lib/password.js'
import { logger } from '../lib/logger.js'
import { checkRateLimit, recordFailure, clearFailures } from '../lib/rateLimit.js'
import { authMiddleware } from '../middleware/auth.js'
import { getClientIp, getUserId, getUsername } from '../middleware/requestContext.js'
import type { AppEnv } from '../middleware/requestContext.js'

export const authRouter = new Hono<AppEnv>()

// Same opaque message for bad password AND unknown user (FR-02: do not reveal which).
const INVALID_CREDS = { error: 'UNAUTHORIZED', message: 'Invalid username or password' } as const

// ---------------------------------------------------------------------------
// POST /auth/login — public, rate-limited, bcrypt verification
// ---------------------------------------------------------------------------

authRouter.post('/login', async (c) => {
  const ip = getClientIp(c)

  // Rate-limit gate BEFORE touching the DB (FR-03).
  const rl = checkRateLimit(ip)
  if (rl.limited) {
    logger.warn('auth.login: rate limited', { ip, reason: 'rate_limited' })
    c.header('Retry-After', String(rl.retryAfterSeconds))
    return c.json({ error: 'RATE_LIMITED', message: 'Too many failed attempts, try again later' }, 429)
  }

  // Parse + validate body shape (FR-02: missing fields → 400).
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    body = undefined
  }
  const username = (body as { username?: unknown } | undefined)?.username
  const password = (body as { password?: unknown } | undefined)?.password
  if (typeof username !== 'string' || username.length === 0 ||
      typeof password !== 'string' || password.length === 0) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'username and password are required' }, 400)
  }

  // Look up user; verify bcrypt hash. Unknown user vs bad password are indistinguishable.
  const rows = await db
    .select({ id: users.id, username: users.username, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.username, username))
    .limit(1)
  const user = rows[0]

  const ok = user ? await verifyPassword(password, user.passwordHash) : false
  if (!user || !ok) {
    recordFailure(ip)
    logger.warn('auth.login: invalid credentials', { username, ip, reason: 'invalid_credentials' })
    return c.json(INVALID_CREDS, 401)
  }

  clearFailures(ip)
  const token = await signToken({ userId: user.id, username: user.username })
  logger.info('auth.login: success', { username: user.username, ip })
  return c.json({ token, username: user.username }, 200)
})

// ---------------------------------------------------------------------------
// Protected: /refresh, /me, /logout — require valid Bearer (FR-04)
// ---------------------------------------------------------------------------

authRouter.use('/refresh', authMiddleware)
authRouter.use('/me', authMiddleware)
authRouter.use('/logout', authMiddleware)

// POST /auth/refresh — sliding re-issue with a fresh 7-day TTL.
authRouter.post('/refresh', async (c) => {
  const userId = getUserId(c)
  const username = getUsername(c)
  const token = await signToken({ userId, username })
  return c.json({ token }, 200)
})

// GET /auth/me — identity for the current token.
authRouter.get('/me', (c) => {
  return c.json({ userId: getUserId(c), username: getUsername(c) }, 200)
})

// POST /auth/logout — client-side invalidation; we only log the event.
authRouter.post('/logout', (c) => {
  logger.info('auth.logout', { username: getUsername(c), ip: getClientIp(c) })
  return c.json({ ok: true }, 200)
})
