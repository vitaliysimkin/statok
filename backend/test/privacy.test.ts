/**
 * privacy.test.ts — ST-034 outbound-call audit (NFR-01, NFR-02, arch §9).
 *
 * Statically scans backend/src for:
 *  1. Outbound fetch URLs — only yahoo, frankfurter, bank.gov.ua allowed.
 *  2. CORS config — must have strict allowlist and credentials:false.
 *  3. secureHeaders() middleware present.
 *  4. Backup endpoint under authMiddleware.
 *  5. docker-compose.dev.yml has no docker.sock mount.
 *
 * No network calls are made; no DB is needed.
 */

import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, extname } from 'path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SRC_DIR = join(import.meta.dir, '..', 'src')
const ROOT_DIR = join(import.meta.dir, '..', '..')

/** Recursively collect all .ts files under a directory. */
function collectTs(dir: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      result.push(...collectTs(full))
    } else if (extname(entry) === '.ts') {
      result.push(full)
    }
  }
  return result
}

/** Read a file as string; return empty string if missing. */
function readFile(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Allowed external hosts (NFR-01)
// ---------------------------------------------------------------------------

const ALLOWED_HOSTS = [
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'api.frankfurter.dev',
  'api.frankfurter.app',
  'bank.gov.ua',
]

// Hosts that are the server itself (listen address in log messages) — not external calls.
const INTERNAL_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0']

/**
 * Extracts string literals that look like URLs (http/https) from TypeScript
 * source text. Returns only those containing an identifiable hostname.
 */
function extractUrlLiterals(src: string): string[] {
  const found: string[] = []
  // Match https?://... inside single or double quotes or template literals
  const re = /https?:\/\/([a-zA-Z0-9.\-]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    found.push(m[0])
  }
  return found
}

function hostnameOf(url: string): string {
  return url.replace(/^https?:\/\//, '').split('/')[0] ?? ''
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('NFR-01 — outbound host allowlist', () => {
  const tsFiles = collectTs(SRC_DIR)
  const allUrls: Array<{ file: string; url: string; host: string }> = []

  for (const file of tsFiles) {
    const src = readFile(file)
    for (const url of extractUrlLiterals(src)) {
      const host = hostnameOf(url)
      allUrls.push({ file: file.replace(SRC_DIR, 'src'), url, host })
    }
  }

  it('should find at least one outbound URL (sanity check)', () => {
    expect(allUrls.length).toBeGreaterThan(0)
  })

  it('all outbound URLs must point to allowed hosts only', () => {
    const violations = allUrls.filter(
      ({ host }) => !ALLOWED_HOSTS.includes(host) && !INTERNAL_HOSTS.includes(host),
    )
    if (violations.length > 0) {
      const detail = violations.map((v) => `  ${v.file}: ${v.url}`).join('\n')
      throw new Error(`Found ${violations.length} unauthorized outbound host(s):\n${detail}`)
    }
    expect(violations).toHaveLength(0)
  })

  it('Yahoo hosts are query1/query2 only', () => {
    const yahooUrls = allUrls.filter(({ host }) => host.includes('yahoo'))
    const unauthorized = yahooUrls.filter(
      ({ host }) => host !== 'query1.finance.yahoo.com' && host !== 'query2.finance.yahoo.com',
    )
    expect(unauthorized).toHaveLength(0)
  })

  it('Frankfurter hosts are api.frankfurter.dev/.app only', () => {
    const frankUrls = allUrls.filter(({ host }) => host.includes('frankfurter'))
    const unauthorized = frankUrls.filter(
      ({ host }) => host !== 'api.frankfurter.dev' && host !== 'api.frankfurter.app',
    )
    expect(unauthorized).toHaveLength(0)
  })

  it('NBU host is bank.gov.ua only', () => {
    const nbuUrls = allUrls.filter(({ host }) => host.includes('gov.ua'))
    const unauthorized = nbuUrls.filter(({ host }) => host !== 'bank.gov.ua')
    expect(unauthorized).toHaveLength(0)
  })
})

describe('NFR-02 — CORS strict allowlist + credentials:false', () => {
  const indexSrc = readFile(join(SRC_DIR, 'index.ts'))

  it('CORS origins are built from CORS_ORIGINS env (not hardcoded)', () => {
    expect(indexSrc).toContain('CORS_ORIGINS')
  })

  it('CORS credentials must be false', () => {
    expect(indexSrc).toContain('credentials: false')
  })

  it('CORS allowlist is applied to the app', () => {
    // The app uses cors() middleware with the origin allowlist
    expect(indexSrc).toContain("use('*', cors(")
  })
})

describe('NFR-02 — security headers', () => {
  const indexSrc = readFile(join(SRC_DIR, 'index.ts'))

  it('secureHeaders middleware is applied globally', () => {
    expect(indexSrc).toContain('secureHeaders()')
  })

  it('secureHeaders import is present', () => {
    expect(indexSrc).toContain('secure-headers')
  })
})

describe('NFR-02 — pg_dump under auth', () => {
  const backupSrc = readFile(join(SRC_DIR, 'routes', 'backup.ts'))

  it('backup route file exists', () => {
    expect(backupSrc.length).toBeGreaterThan(0)
  })

  it('authMiddleware is applied to backup router', () => {
    expect(backupSrc).toContain('authMiddleware')
  })

  it('pg_dump is called via Bun.spawn (not via fetch)', () => {
    expect(backupSrc).toContain('pg_dump')
    expect(backupSrc).not.toContain("fetch('")
  })
})

describe('NFR-01 — docker.sock not mounted in dev compose', () => {
  const composeSrc = readFile(join(ROOT_DIR, 'docker-compose.dev.yml'))

  it('docker-compose.dev.yml exists', () => {
    expect(composeSrc.length).toBeGreaterThan(0)
  })

  it('docker.sock is NOT mounted', () => {
    expect(composeSrc).not.toContain('docker.sock')
  })
})

describe('Audit summary — found external hosts', () => {
  it('lists all discovered outbound hosts for review', () => {
    const tsFiles = collectTs(SRC_DIR)
    const discoveredHosts = new Set<string>()
    for (const file of tsFiles) {
      const src = readFile(file)
      for (const url of extractUrlLiterals(src)) {
        discoveredHosts.add(hostnameOf(url))
      }
    }
    // This test always passes — it just logs the hosts found.
    console.log('Discovered outbound hosts:', [...discoveredHosts].sort())
    expect(discoveredHosts.size).toBeGreaterThan(0)
  })
})
