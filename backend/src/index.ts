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
import { runMigrations } from './db/migrate.js'
import { seedAdmin } from './lib/seed.js'
import { startEodPipelineJob } from './jobs/eodPipeline.js'
import { healthRouter } from './routes/health.js'
import { authRouter } from './routes/auth.js'
import { apiRouter } from './routes/api.js'

// ---------------------------------------------------------------------------
// 1. Validate required env — fatal exit if missing (ТЗ §8.3, FR-01, NFR-02)
// ---------------------------------------------------------------------------

function fatal(message: string): never {
  logger.error(`fatal: ${message}`)
  process.exit(1)
}

function validateEnv(): void {
  const { DATABASE_URL, JWT_SECRET } = process.env

  if (!DATABASE_URL) {
    fatal('DATABASE_URL is required but not set — cannot start (see backend/.env.dev)')
  }

  if (!JWT_SECRET) {
    fatal('JWT_SECRET is required but not set — cannot start (see backend/.env.dev)')
  }

  // JWT_SECRET must be >= 32 bytes for HS256 (ТЗ §8.3, §9).
  const secretBytes = Buffer.byteLength(JWT_SECRET, 'utf8')
  if (secretBytes < 32) {
    fatal(`JWT_SECRET must be at least 32 bytes (got ${secretBytes}) — refusing to start`)
  }

  // BASE_CURRENCY read once on boot; default USD (ТЗ §8.3).
  const baseCurrency = process.env.BASE_CURRENCY ?? 'USD'
  logger.info('env validated', { baseCurrency })

  // Google sign-in config — NOT fatal (google-auth-task §5/§8): the process must
  // start even without it. Missing GOOGLE_CLIENT_ID → /auth/google returns 503
  // AUTH_NOT_CONFIGURED. Just warn so misconfiguration is visible in logs.
  if (!process.env.GOOGLE_CLIENT_ID) {
    logger.warn('GOOGLE_CLIENT_ID not set — Google sign-in disabled (/auth/google → 503)')
  }
  if (!process.env.ALLOWED_GOOGLE_EMAIL) {
    logger.warn('ALLOWED_GOOGLE_EMAIL not set — no Google account will be allowed in (403)')
  }
}

// ---------------------------------------------------------------------------
// 2. Background jobs (ST-029 EOD pipeline)
// ---------------------------------------------------------------------------

function startJobs(): void {
  // scheduleDailyAt('23:30','Europe/Kyiv', runEodPipeline) + boot catch-up (arch §4.4).
  startEodPipelineJob()
  logger.info('jobs: EOD pipeline scheduled (23:30 Europe/Kyiv)')
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
  c.header('X-Content-Type-Options', 'nosniff')
  return c.json(
    {
      error: 'INTERNAL',
      message: 'Internal server error',
    },
    500,
  )
})

// 404 handler — CRR-2 format: {error, message}
app.notFound((c) => {
  return c.json({ error: 'NOT_FOUND', message: 'Route not found' }, 404)
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
  startJobs()

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
