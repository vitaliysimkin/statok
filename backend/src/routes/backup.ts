/**
 * backup.ts — pg_dump stream endpoint (ST-032, FR-51, arch §5.2).
 *
 *  GET /api/backup/dump
 *
 * Spawns `pg_dump --format=custom DATABASE_URL`, pipes stdout directly as
 * the response body — nothing is written to disk.  Requires auth.
 * Exit code ≠ 0 → 500 Internal Server Error.
 */

import { Hono } from 'hono'
import type { AppEnv } from '../middleware/requestContext.ts'
import { authMiddleware } from '../middleware/auth.ts'

export const backupRouter = new Hono<AppEnv>()
backupRouter.use('*', authMiddleware)

backupRouter.get('/dump', async (c) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) {
    return c.json({ error: 'INTERNAL_ERROR', message: 'DATABASE_URL not configured' }, 500)
  }

  // Filename: statok-YYYYMMDD-HHmm.dump  (UTC clock is fine for a filename)
  const now = new Date()
  const pad2 = (n: number): string => String(n).padStart(2, '0')
  const datePart = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}`
  const timePart = `${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}`
  const filename = `statok-${datePart}-${timePart}.dump`

  const proc = Bun.spawn(['pg_dump', '--format=custom', databaseUrl], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // Wait for the process to finish, collecting stdout as a stream
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    let errMsg = 'pg_dump failed'
    try {
      errMsg = await new Response(proc.stderr).text()
    } catch { /* ignore */ }
    return c.json({ error: 'INTERNAL_ERROR', message: errMsg.slice(0, 500) }, 500)
  }

  // Stream the dump to the client
  return new Response(proc.stdout, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})
