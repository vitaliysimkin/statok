import { Hono } from 'hono'
import { sql } from '../db/index.js'
import { APP_VERSION } from '../lib/version.js'

export const healthRouter = new Hono()

/**
 * GET /health
 * Tardis-style health check: { status, db, version }
 * Returns 200 when ok, 503 when DB is unreachable.
 */
healthRouter.get('/', async (c) => {
  let dbStatus: 'ok' | 'error' = 'ok'

  try {
    // Lightweight connectivity check — no schema required yet
    await sql`SELECT 1`
  } catch {
    dbStatus = 'error'
  }

  const status = dbStatus === 'ok' ? 200 : 503

  return c.json(
    {
      status: 'ok',
      db: dbStatus,
      version: APP_VERSION,
    },
    status,
  )
})
