/**
 * Minimal structured logger (pattern from tardis).
 * Writes JSON lines to stdout; never logs passwords or tokens.
 */

type Level = 'info' | 'warn' | 'error' | 'debug'

function log(level: Level, message: string, meta?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  }
  // Use stderr for error/warn, stdout for info/debug
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout
  out.write(JSON.stringify(entry) + '\n')
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
}
