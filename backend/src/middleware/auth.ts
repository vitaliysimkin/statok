/**
 * Auth middleware — CRR-1 / FR-04.
 *
 * Requires a valid `Authorization: Bearer <jwt>` header. Missing, malformed,
 * invalid, or expired token → 401 UNAUTHORIZED ({error, message}). On success
 * the token's userId/username are placed on the request context for routes.
 *
 * Mounted on every router except POST /auth/login and GET /health (the latter
 * are not behind this middleware).
 */

import type { MiddlewareHandler } from 'hono'

import { verifyToken } from '../lib/jwt.js'
import type { AppEnv } from './requestContext.js'

const UNAUTHORIZED = { error: 'UNAUTHORIZED', message: 'Authentication required' } as const

/** Extract a bearer token from the Authorization header, or null. */
function extractBearer(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer (.+)$/.exec(header.trim())
  return match ? match[1]!.trim() || null : null
}

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = extractBearer(c.req.header('Authorization'))
  if (!token) {
    return c.json(UNAUTHORIZED, 401)
  }

  const payload = await verifyToken(token)
  if (!payload) {
    return c.json(UNAUTHORIZED, 401)
  }

  c.set('userId', payload.userId)
  c.set('username', payload.username)
  await next()
}
