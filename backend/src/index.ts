/**
 * Statok backend entry point.
 *
 * Boot sequence: validate env → migrate → seed → start jobs → listen
 * (migrate/seed/jobs are stubs until ST-009/ST-029)
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'

import { logger } from './lib/logger.js'
import { APP_VERSION } from './lib/version.js'
import { healthRouter } from './routes/health.js'
import { authRouter } from './routes/auth.js'
import { apiRouter } from './routes/api.js'

// ---------------------------------------------------------------------------
// 1. Validate required env — fatal exit if missing
// ---------------------------------------------------------------------------

function validateEnv(): void {
  const { DATABASE_URL, JWT_SECRET } = process.env

  if (!DATABASE_URL) {
    logger.error('Missing required env var: DATABASE_URL')
    process.exit(1)
  }

  if (!JWT_SECRET) {
    logger.error('Missing required env var: JWT_SECRET')
    process.exit(1)
  }

  if (JWT_SECRET.length < 32) {
    logger.error('JWT_SECRET must be at least 32 characters long', {
      length: JWT_SECRET.length,
    })
    process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// 2. Boot sequence helpers (stubs — wired in ST-009, ST-029)
// ---------------------------------------------------------------------------

async function runMigrations(): Promise<void> {
  // TODO ST-009: import and call drizzle migrator
  logger.info('migrations: skipped (stub until ST-009)')
}

async function seedAdmin(): Promise<void> {
  // TODO ST-009: create admin user from ADMIN_USERNAME / ADMIN_PASSWORD if absent
  logger.info('seed: skipped (stub until ST-009)')
}

async function startJobs(): Promise<void> {
  // TODO ST-029: startEodPipelineJob()
  logger.info('jobs: skipped (stub until ST-029)')
}

// ---------------------------------------------------------------------------
// 3. Build CORS origin allowlist from CORS_ORIGINS env
// ---------------------------------------------------------------------------

function buildCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS ?? ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// 4. Create Hono app
// ---------------------------------------------------------------------------

const app = new Hono()

// Global error handler — CRR-2 format: {error, message}
app.onError((err, c) => {
  logger.error('unhandled error', { message: err.message, stack: err.stack })
  return c.json(
    {
      error: 'INTERNAL',
      message: 'Internal server error',
    },
    500,
  )
})

// Security headers (X-Content-Type-Options, X-Frame-Options, …)
app.use('*', secureHeaders())

// CORS — strict allowlist, credentials: false (auth via Bearer header)
const corsOrigins = buildCorsOrigins()
app.use('*', cors({
  origin: corsOrigins.length > 0 ? corsOrigins : [],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}))

// ---------------------------------------------------------------------------
// 5. Route mounts
// ---------------------------------------------------------------------------

app.route('/health', healthRouter)
app.route('/auth', authRouter)
app.route('/api', apiRouter)

// ---------------------------------------------------------------------------
// 6. Start function
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  validateEnv()

  await runMigrations()
  await seedAdmin()
  await startJobs()

  const port = Number(process.env.PORT ?? 3100)

  logger.info('statok backend starting', { version: APP_VERSION, port })

  Bun.serve({
    fetch: app.fetch,
    port,
  })

  logger.info(`listening on http://localhost:${port}`)
}

start().catch((err: unknown) => {
  logger.error('fatal startup error', { message: (err as Error).message })
  process.exit(1)
})

export default app
