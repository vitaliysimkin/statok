/**
 * backup.ts — pg_dump stream endpoint (ST-032, FR-51, arch §5.2).
 *
 *  GET /api/backup/dump
 *
 * Spawns `pg_dump --format=custom DATABASE_URL`, pipes stdout directly as
 * the response body — nothing is written to disk.  Requires auth.
 *
 * Streaming model (no deadlock): the response body is wired to pg_dump's
 * stdout *before* awaiting exit, so the OS pipe never fills up and blocks the
 * writer.  We peek the first chunk and race it against process exit: an early
 * failure (non-zero exit before any byte) → 500 with no details.  A failure
 * *after* the stream has started can only abort the stream — the 200 status is
 * already on the wire.  pg_dump's stderr never reaches the client; it goes to
 * the server log only.
 */

import { Hono } from 'hono'
import type { AppEnv } from '../middleware/requestContext.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { logger } from '../lib/logger.ts'

export const backupRouter = new Hono<AppEnv>()
backupRouter.use('*', authMiddleware)

backupRouter.get('/dump', async (c) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) {
    return c.json({ error: 'INTERNAL', message: 'DATABASE_URL not configured' }, 500)
  }

  // Filename: statok-YYYYMMDD-HHmm.dump  (UTC clock is fine for a filename)
  const now = new Date()
  const pad2 = (n: number): string => String(n).padStart(2, '0')
  const datePart = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}`
  const timePart = `${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}`
  const filename = `statok-${datePart}-${timePart}.dump`

  // Spawn as an argv array (no shell) — guards against argument injection.
  const proc = Bun.spawn(['pg_dump', '--format=custom', databaseUrl], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // Collect stderr lazily; only ever emitted to the server log, never to the client.
  const stderrText = (): Promise<string> =>
    new Response(proc.stderr).text().catch(() => '')

  const reader = proc.stdout.getReader()

  // Peek the first chunk, racing it against process exit.  A single read()
  // resolves with `done` once stdout closes (which happens on process exit),
  // so it already covers the early-failure case; the `exited` racer is a
  // belt-and-suspenders guard for the rare lag between exit and pipe-close.
  // A `done:true` result (from either source) means "no first byte" and
  // routes to the empty-output handler below.
  type ReadResult = Awaited<ReturnType<typeof reader.read>>
  const exitedAsDone: Promise<ReadResult> = proc.exited.then(
    () => ({ done: true, value: undefined }),
  )
  let first: ReadResult
  try {
    first = await Promise.race([reader.read(), exitedAsDone])
  } catch (err) {
    await reader.cancel().catch(() => {})
    proc.stderr.cancel().catch(() => {})
    logger.error('backup.dump_read_failed', { message: (err as Error).message })
    return c.json({ error: 'INTERNAL', message: 'pg_dump failed' }, 500)
  }

  // No first byte → pg_dump closed stdout without output.  Treat a non-zero
  // exit as failure; log stderr server-side only and return 500 without details.
  if (first.done) {
    // cancel() (not releaseLock) settles any read still pending from the lost
    // race branch and releases the lock without throwing.
    await reader.cancel().catch(() => {})
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      logger.error('backup.dump_failed', { exitCode, stderr: (await stderrText()).slice(0, 2000) })
      return c.json({ error: 'INTERNAL', message: 'pg_dump failed' }, 500)
    }
    // Exit 0 with empty output is unexpected but not an error — return empty body.
    return new Response(new Uint8Array(0), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }

  // We have the first byte → stream begins.  Re-emit the peeked chunk, then
  // drain the rest of stdout.  Any later failure can only abort the stream
  // (status 200 is already committed); we log it server-side.
  const firstChunk = first.value
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(firstChunk)
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          const exitCode = await proc.exited
          if (exitCode !== 0) {
            logger.error('backup.dump_truncated', {
              exitCode,
              stderr: (await stderrText()).slice(0, 2000),
            })
          }
          return
        }
        controller.enqueue(value)
      } catch (err) {
        // stdout errored mid-stream — abort the body; status already sent.
        controller.error(err)
        logger.error('backup.dump_stream_failed', { message: (err as Error).message })
        proc.stderr.cancel().catch(() => {})
      }
    },
    cancel(reason) {
      // Client disconnected — stop pg_dump and release pipes.
      reader.cancel(reason).catch(() => {})
      proc.stderr.cancel().catch(() => {})
      proc.kill()
    },
  })

  return new Response(body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})
