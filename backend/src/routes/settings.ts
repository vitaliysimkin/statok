/**
 * settings.ts — app config + job-state endpoints (ST-033, FR-54, arch §1.10/§8.3).
 *
 *  GET  /api/settings          → { baseCurrency, version, jobs }
 *  PUT  /api/settings/:key     → whitelist-guarded value update
 *
 * baseCurrency is read-only (env-driven); only explicitly whitelisted keys
 * may be updated via PUT (anything else → 400 INVALID_SETTING_KEY).
 */

import { Hono } from 'hono'

import { db } from '../db/index.ts'
import { appSettings } from '../db/schema.ts'
import type { AppEnv } from '../middleware/requestContext.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { APP_VERSION } from '../lib/version.ts'
import { readJobState } from '../jobs/jobState.ts'

const BASE_CURRENCY = process.env['BASE_CURRENCY'] ?? 'USD'

export const settingsRouter = new Hono<AppEnv>()
settingsRouter.use('*', authMiddleware)

/** Keys users may update via PUT /api/settings/:key. */
const WRITABLE_KEYS = new Set([
  'ui.theme',
  'ui.locale',
])

// ---------------------------------------------------------------------------
// GET /api/settings
// ---------------------------------------------------------------------------
settingsRouter.get('/', async (c) => {
  const [prices, fx, snapshot] = await Promise.all([
    readJobState('job.prices'),
    readJobState('job.fx'),
    readJobState('job.snapshot'),
  ])

  return c.json({
    baseCurrency: BASE_CURRENCY,
    version: APP_VERSION,
    jobs: { prices, fx, snapshot },
  })
})

// ---------------------------------------------------------------------------
// PUT /api/settings/:key  { value }
// ---------------------------------------------------------------------------
settingsRouter.put('/:key', async (c) => {
  const key = c.req.param('key')

  if (!WRITABLE_KEYS.has(key)) {
    return c.json({ error: 'INVALID_SETTING_KEY', message: `Key "${key}" is not writable` }, 400)
  }

  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid JSON body' }, 400)
  }

  if (!('value' in body)) {
    return c.json({ error: 'VALIDATION_ERROR', message: '"value" field is required' }, 400)
  }

  const value = body['value'] as unknown

  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })

  return c.json({ key, value })
})
