/**
 * Auth routes — FR-02, FR-03, FR-04 (ТЗ §2 auth) + Google sign-in
 * (tasks/google-auth-task.md §1.2, §3, §6).
 *
 *  POST /auth/login    {username,password} → {token,username}   (bcrypt + rate-limit)
 *  POST /auth/google   {credential}        → {token,username}   (jose OIDC + rate-limit)
 *  POST /auth/refresh   (Bearer)           → {token}            (sliding, fresh TTL 7d)
 *  GET  /auth/me        (Bearer)           → {userId,username}
 *  POST /auth/logout    (Bearer)           → {ok:true}          (log only)
 *
 * Mounted at /auth in index.ts. Rate-limit (FR-03) applies to BOTH /login and
 * /google (same IP counter). /refresh, /me, /logout sit behind authMiddleware.
 * Both /login and /google end by issuing the SAME Statok JWT (signToken), so the
 * sliding-session machinery (FR-04) and the whole protected API work unchanged.
 *
 * Password login is a break-glass path gated by ENABLE_PASSWORD_LOGIN: when the
 * env var is not exactly 'true' (the prod default — the var is simply absent),
 * /auth/login returns 403 FORBIDDEN WITHOUT touching the DB. Google is the
 * primary path; the owner allowlist is a single email (ALLOWED_GOOGLE_EMAIL).
 *
 * Logs carry username/email + ip + reason only — NEVER the password, the Google
 * credential, or the issued token (FR-02, NFR-02, google-auth-task §6).
 */

import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { signToken } from '../lib/jwt.js'
import { verifyPassword } from '../lib/password.js'
import { logger } from '../lib/logger.js'
import { checkRateLimit, recordFailure, clearFailures } from '../lib/rateLimit.js'
import { verifyGoogleIdToken, GoogleVerifyError } from '../lib/googleAuth.js'
import { authMiddleware } from '../middleware/auth.js'
import { getClientIp, getUserId, getUsername } from '../middleware/requestContext.js'
import type { AppEnv } from '../middleware/requestContext.js'

export const authRouter = new Hono<AppEnv>()

// Same opaque message for bad password AND unknown user (FR-02: do not reveal which).
const INVALID_CREDS = { error: 'UNAUTHORIZED', message: 'Invalid username or password' } as const

// Canonical 403 for a non-owner Google account (google-auth-task §1.2).
const FORBIDDEN = { error: 'FORBIDDEN', message: 'Access denied' } as const

/** Break-glass gate: password login is enabled only when the env var is exactly 'true'. */
function isPasswordLoginEnabled(): boolean {
  return process.env.ENABLE_PASSWORD_LOGIN === 'true'
}

// ---------------------------------------------------------------------------
// POST /auth/login — public, rate-limited, bcrypt verification
//   Break-glass only: disabled unless ENABLE_PASSWORD_LOGIN === 'true' (§3).
// ---------------------------------------------------------------------------

authRouter.post('/login', async (c) => {
  const ip = getClientIp(c)

  // Break-glass gate FIRST — when disabled, refuse without rate-limit or DB I/O.
  if (!isPasswordLoginEnabled()) {
    logger.warn('auth.login: password login disabled', { ip, reason: 'password_login_disabled' })
    return c.json(FORBIDDEN, 403)
  }

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
// POST /auth/google — public, rate-limited, jose OIDC verification (§1.2, §6)
//   Body {credential}. Verifies Google ID-token signature + claims, then
//   enforces the single-email allowlist (ALLOWED_GOOGLE_EMAIL). On success
//   issues the SAME Statok JWT as /login (signToken) so refresh/me/logout and
//   the protected API work unchanged. NEVER logs the credential or the token.
// ---------------------------------------------------------------------------

authRouter.post('/google', async (c) => {
  const ip = getClientIp(c)

  // Rate-limit gate BEFORE any network/DB I/O (same IP counter as /login).
  const rl = checkRateLimit(ip)
  if (rl.limited) {
    logger.warn('auth.google: rate limited', { ip, reason: 'rate_limited' })
    c.header('Retry-After', String(rl.retryAfterSeconds))
    return c.json({ error: 'RATE_LIMITED', message: 'Too many failed attempts, try again later' }, 429)
  }

  // Parse + validate body shape: missing / non-string credential → 400.
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    body = undefined
  }
  const credential = (body as { credential?: unknown } | undefined)?.credential
  if (typeof credential !== 'string' || credential.length === 0) {
    return c.json({ error: 'VALIDATION_ERROR', message: 'credential is required' }, 400)
  }

  // Config gate: no GOOGLE_CLIENT_ID → cannot verify; respond without touching
  // the network or DB. (verifyGoogleIdToken would throw 'not_configured', but we
  // short-circuit here to keep the 503 path explicit and side-effect-free.)
  if (!process.env.GOOGLE_CLIENT_ID) {
    logger.warn('auth.google: not configured', { ip, reason: 'auth_not_configured' })
    return c.json({ error: 'AUTH_NOT_CONFIGURED', message: 'Google sign-in is not configured' }, 503)
  }

  // Verify the Google ID token (signature via JWKS + iss/aud/exp/email_verified).
  let identity: { email: string }
  try {
    identity = await verifyGoogleIdToken(credential)
  } catch (err) {
    if (err instanceof GoogleVerifyError) {
      if (err.reason === 'not_configured') {
        // Race: env cleared between the check above and here. Treat as 503.
        logger.warn('auth.google: not configured', { ip, reason: 'auth_not_configured' })
        return c.json({ error: 'AUTH_NOT_CONFIGURED', message: 'Google sign-in is not configured' }, 503)
      }
      if (err.reason === 'email_unverified') {
        // Google did not verify the email → not the owner; deny without detail.
        recordFailure(ip)
        logger.warn('auth.google: email unverified', { ip, reason: 'email_unverified' })
        return c.json(FORBIDDEN, 403)
      }
      // invalid_token: bad signature / iss / aud / exp / shape — opaque 401.
      recordFailure(ip)
      logger.warn('auth.google: token rejected', { ip, reason: err.reason })
      return c.json({ error: 'UNAUTHORIZED', message: 'Invalid Google credential' }, 401)
    }
    // Unexpected error — let the global handler map it (500).
    throw err
  }

  // Owner allowlist — case-insensitive compare of BOTH sides (§6).
  const allowed = (process.env.ALLOWED_GOOGLE_EMAIL ?? '').trim().toLowerCase()
  const email = identity.email.trim().toLowerCase()
  if (allowed.length === 0 || email !== allowed) {
    recordFailure(ip)
    logger.warn('auth.google: email not allowed', { email, ip, reason: 'email_not_allowed' })
    return c.json(FORBIDDEN, 403)
  }

  // Resolve the single seeded user (carrier of userId). Missing → config error.
  const rows = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .limit(1)
  const user = rows[0]
  if (!user) {
    logger.error('auth.google: no user in DB (seed did not run)', { ip, reason: 'no_user' })
    return c.json({ error: 'INTERNAL', message: 'No user provisioned' }, 500)
  }

  clearFailures(ip)
  const token = await signToken({ userId: user.id, username: user.username })
  logger.info('auth.google: success', { email, ip })
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
