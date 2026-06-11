import { Hono } from 'hono'

/**
 * Auth routes stub — implemented in ST-011.
 * POST /auth/login  → {token, username}
 * POST /auth/refresh
 * POST /auth/logout
 * GET  /auth/me
 */
export const authRouter = new Hono()

// Placeholder — real implementation in ST-011
authRouter.post('/login', (c) =>
  c.json({ error: 'NOT_IMPLEMENTED', message: 'Auth not yet implemented (ST-011)' }, 501),
)
