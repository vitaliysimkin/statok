/**
 * App version — read once from STATOK_VERSION env (set by deploy pipeline),
 * fallback to root package.json version at build time.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function readRootVersion(): string {
  try {
    // Walk up two levels: backend/src/lib -> backend -> root
    const pkg = require('../../package.json') as { version: string }
    return pkg.version
  } catch {
    return '0.0.0'
  }
}

export const APP_VERSION: string = process.env.STATOK_VERSION ?? readRootVersion()
