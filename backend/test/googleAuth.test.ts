/**
 * googleAuth.test.ts — Google sign-in verification + /auth/google route
 * (tasks/google-auth-task.md §7.1). NO network to Google.
 *
 * Two layers, both offline:
 *
 *  A) SEAM layer — exercises the network-free core `verifyGoogleIdTokenWith`
 *     directly. We generate a LOCAL RS256 keypair (jose `generateKeyPair`),
 *     publish its public key as a `createLocalJWKSet`, and sign our own
 *     attack ID-tokens. This drives every signature / iss / aud / exp /
 *     email_verified path with zero outbound HTTP — exactly the testability
 *     seam the backend author exposed (`verifyGoogleIdTokenWith(jwks, cred,
 *     {clientId})`).
 *
 *  B) ROUTE layer — mounts the real `authRouter` on a throwaway Hono app and
 *     hits `POST /auth/google` end-to-end. To keep it offline we `mock.module`
 *     the googleAuth module so the route's `verifyGoogleIdToken(credential)`
 *     delegates to the SAME seam with our local JWKS (instead of Google's
 *     remote JWKS). This verifies the route's status mapping (200/400/401/403/
 *     429/503) and that the issued statok-JWT passes the real `verifyToken` /
 *     `authMiddleware` (via GET /auth/me).
 *
 * Runs against statok_test (Postgres 5434) for the success path (needs the
 * seeded admin user that carries `userId`).
 *
 *   $env:DATABASE_URL="postgresql://postgres:postgres@localhost:5434/statok_test"
 *   bun test backend/test/googleAuth.test.ts
 */

// IMPORTANT: importing the testDb helper FIRST pins DATABASE_URL → statok_test
// (module-eval side effect) before any db/route module is transitively imported.
import { setupTestDatabase, dropTestDatabase, truncateAll, getSql } from './helpers/testDb.ts'

// JWT_SECRET must exist before lib/jwt.ts caches it (signToken/verifyToken).
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-test-secret-test-secret-0123456789'
// Google config the route reads. The allowlist is the single owner email.
const CLIENT_ID = 'statok-test-client-id.apps.googleusercontent.com'
const ALLOWED_EMAIL = 'vitaliy.simkin@gmail.com'
process.env.GOOGLE_CLIENT_ID = CLIENT_ID
process.env.ALLOWED_GOOGLE_EMAIL = ALLOWED_EMAIL

import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { Hono } from 'hono'
import {
  generateKeyPair,
  exportJWK,
  createLocalJWKSet,
  SignJWT,
  type JWTVerifyGetKey,
} from 'jose'

// jose v6 signs with WebCrypto keys; generateKeyPair yields CryptoKey.
type SignKey = CryptoKey

import {
  verifyGoogleIdTokenWith,
  GoogleVerifyError,
} from '../src/lib/googleAuth.ts'
import { verifyToken } from '../src/lib/jwt.ts'
import { resetRateLimit } from '../src/lib/rateLimit.ts'

const GOOD_ISS = 'https://accounts.google.com'

// ---------------------------------------------------------------------------
// Local keys + JWKS (built once; no network)
// ---------------------------------------------------------------------------

let goodPriv: SignKey
let foreignPriv: SignKey
let localJwks: JWTVerifyGetKey

/** Build an ID-token signed by `key` with overridable claims. */
async function makeIdToken(opts: {
  key?: SignKey
  iss?: string
  aud?: string
  email?: string
  email_verified?: unknown
  // expiration as a jose time string ('1h') or absolute seconds; default valid.
  exp?: string | number
  omitEmail?: boolean
}): Promise<string> {
  const claims: Record<string, unknown> = {
    sub: '1234567890',
    name: 'Owner',
  }
  if (!opts.omitEmail) claims.email = opts.email ?? ALLOWED_EMAIL
  if (opts.email_verified !== undefined) claims.email_verified = opts.email_verified
  else claims.email_verified = true

  const builder = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(opts.iss ?? GOOD_ISS)
    .setAudience(opts.aud ?? CLIENT_ID)
    .setIssuedAt()

  // exp: string => relative (jose), number => absolute seconds, default '1h'.
  if (typeof opts.exp === 'number') builder.setExpirationTime(opts.exp)
  else builder.setExpirationTime(opts.exp ?? '1h')

  return builder.sign(opts.key ?? goodPriv)
}

beforeAll(async () => {
  const good = await generateKeyPair('RS256')
  const foreign = await generateKeyPair('RS256')
  goodPriv = good.privateKey
  foreignPriv = foreign.privateKey

  // Publish ONLY the good public key in the local JWKS — a token signed by the
  // foreign key has no matching kid/key and must fail signature verification.
  const goodJwk = await exportJWK(good.publicKey)
  goodJwk.alg = 'RS256'
  goodJwk.use = 'sig'
  localJwks = createLocalJWKSet({ keys: [goodJwk] })

  await setupTestDatabase()
})

afterAll(async () => {
  await dropTestDatabase()
})

// ===========================================================================
// A) SEAM — verifyGoogleIdTokenWith (network-free core)
// ===========================================================================

describe('verifyGoogleIdTokenWith — valid token', () => {
  it('returns the verified email for right iss/aud/exp + email_verified=true', async () => {
    const tok = await makeIdToken({ email: ALLOWED_EMAIL })
    const identity = await verifyGoogleIdTokenWith(localJwks, tok, { clientId: CLIENT_ID })
    expect(identity.email).toBe(ALLOWED_EMAIL)
  })

  it("accepts the bare-host issuer form 'accounts.google.com'", async () => {
    const tok = await makeIdToken({ iss: 'accounts.google.com' })
    const identity = await verifyGoogleIdTokenWith(localJwks, tok, { clientId: CLIENT_ID })
    expect(identity.email).toBe(ALLOWED_EMAIL)
  })

  it('accepts email_verified as the string "true" (Google sometimes sends a string)', async () => {
    const tok = await makeIdToken({ email_verified: 'true' })
    const identity = await verifyGoogleIdTokenWith(localJwks, tok, { clientId: CLIENT_ID })
    expect(identity.email).toBe(ALLOWED_EMAIL)
  })
})

describe('verifyGoogleIdTokenWith — email_verified handling', () => {
  it('email_verified=false → email_unverified (route maps to 403)', async () => {
    const tok = await makeIdToken({ email_verified: false })
    let err: unknown
    try {
      await verifyGoogleIdTokenWith(localJwks, tok, { clientId: CLIENT_ID })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(GoogleVerifyError)
    expect((err as GoogleVerifyError).reason).toBe('email_unverified')
  })

  it('email_verified missing → email_unverified', async () => {
    // Build a token without the email_verified claim at all.
    const tok = await new SignJWT({ email: ALLOWED_EMAIL })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(GOOD_ISS)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(goodPriv)
    let err: unknown
    try {
      await verifyGoogleIdTokenWith(localJwks, tok, { clientId: CLIENT_ID })
    } catch (e) {
      err = e
    }
    expect((err as GoogleVerifyError).reason).toBe('email_unverified')
  })
})

describe('verifyGoogleIdTokenWith — invalid_token (route maps to 401)', () => {
  it('aud != clientId → invalid_token', async () => {
    const tok = await makeIdToken({ aud: 'some-other-app.apps.googleusercontent.com' })
    let err: unknown
    try {
      await verifyGoogleIdTokenWith(localJwks, tok, { clientId: CLIENT_ID })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(GoogleVerifyError)
    expect((err as GoogleVerifyError).reason).toBe('invalid_token')
  })

  it('foreign issuer → invalid_token', async () => {
    const tok = await makeIdToken({ iss: 'https://evil.example.com' })
    let err: unknown
    try {
      await verifyGoogleIdTokenWith(localJwks, tok, { clientId: CLIENT_ID })
    } catch (e) {
      err = e
    }
    expect((err as GoogleVerifyError).reason).toBe('invalid_token')
  })

  it('expired exp → invalid_token', async () => {
    // exp 1 hour in the past (absolute seconds).
    const past = Math.floor(Date.now() / 1000) - 3600
    const tok = await makeIdToken({ exp: past })
    let err: unknown
    try {
      await verifyGoogleIdTokenWith(localJwks, tok, { clientId: CLIENT_ID })
    } catch (e) {
      err = e
    }
    expect((err as GoogleVerifyError).reason).toBe('invalid_token')
  })

  it('signed by a foreign key (not in JWKS) → invalid_token', async () => {
    const tok = await makeIdToken({ key: foreignPriv })
    let err: unknown
    try {
      await verifyGoogleIdTokenWith(localJwks, tok, { clientId: CLIENT_ID })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(GoogleVerifyError)
    expect((err as GoogleVerifyError).reason).toBe('invalid_token')
  })

  it('garbage / non-JWT credential → invalid_token (never leaks the credential)', async () => {
    let err: unknown
    try {
      await verifyGoogleIdTokenWith(localJwks, 'not-a-jwt', { clientId: CLIENT_ID })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(GoogleVerifyError)
    expect((err as GoogleVerifyError).reason).toBe('invalid_token')
    // The error message must not echo the raw credential.
    expect((err as Error).message).not.toContain('not-a-jwt')
  })
})

// ===========================================================================
// B) ROUTE — POST /auth/google (offline via mock.module of the verifier)
// ===========================================================================

describe('POST /auth/google — route status mapping (offline)', () => {
  let app: Hono
  let seededUserId: string
  let seededUsername: string

  beforeAll(async () => {
    // Swap the production verifier (remote Google JWKS) for one backed by our
    // LOCAL JWKS via the seam — same claim logic, zero network. We re-export
    // everything else from the real module so the route's other imports work.
    const real = await import('../src/lib/googleAuth.ts')
    mock.module('../src/lib/googleAuth.ts', () => ({
      ...real,
      verifyGoogleIdToken: async (credential: string) => {
        const clientId = process.env.GOOGLE_CLIENT_ID
        if (!clientId) {
          throw new real.GoogleVerifyError('not_configured', 'GOOGLE_CLIENT_ID is not configured')
        }
        return real.verifyGoogleIdTokenWith(localJwks, credential, { clientId })
      },
    }))

    // Import the router AFTER the mock so it binds the patched verifier.
    const { authRouter } = await import('../src/routes/auth.ts')
    app = new Hono()
    app.route('/auth', authRouter)
  })

  beforeEach(async () => {
    await truncateAll()
    resetRateLimit()
    // Seed the single admin user that carries userId (mirrors lib/seed.ts).
    const sql = await getSql()
    const rows = await sql<{ id: string; username: string }[]>`
      INSERT INTO users (username, password_hash)
      VALUES (${'admin'}, ${'x'})
      RETURNING id, username
    `
    const row = rows[0]
    if (!row) throw new Error('seed: insert returned no row')
    seededUserId = row.id
    seededUsername = row.username
  })

  /** POST a JSON body to /auth/google with a fixed test IP. */
  async function postGoogle(body: unknown, ip = '203.0.113.7'): Promise<Response> {
    return app.request('/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    })
  }

  it('valid owner token → 200 with a statok-JWT that passes verifyToken', async () => {
    const tok = await makeIdToken({ email: ALLOWED_EMAIL })
    const res = await postGoogle({ credential: tok })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { token: string; username: string }
    expect(json.username).toBe(seededUsername)
    expect(typeof json.token).toBe('string')

    // The issued token must be a valid Statok JWT carrying the seeded user.
    const payload = await verifyToken(json.token)
    expect(payload).not.toBeNull()
    expect(payload!.userId).toBe(seededUserId)
    expect(payload!.username).toBe(seededUsername)
  })

  it('issued token is accepted by authMiddleware (GET /auth/me)', async () => {
    const tok = await makeIdToken({ email: ALLOWED_EMAIL })
    const loginRes = await postGoogle({ credential: tok })
    const { token } = (await loginRes.json()) as { token: string }

    const meRes = await app.request('/auth/me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(meRes.status).toBe(200)
    const me = (await meRes.json()) as { userId: string; username: string }
    expect(me.userId).toBe(seededUserId)
    expect(me.username).toBe(seededUsername)
  })

  it('email != allowed → 403 FORBIDDEN (canonical {error,message})', async () => {
    const tok = await makeIdToken({ email: 'intruder@gmail.com' })
    const res = await postGoogle({ credential: tok })
    expect(res.status).toBe(403)
    const json = (await res.json()) as { error: string; message: string }
    expect(json.error).toBe('FORBIDDEN')
    expect(typeof json.message).toBe('string')
  })

  it('email_verified=false → 403 FORBIDDEN', async () => {
    const tok = await makeIdToken({ email: ALLOWED_EMAIL, email_verified: false })
    const res = await postGoogle({ credential: tok })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toBe('FORBIDDEN')
  })

  it('aud != GOOGLE_CLIENT_ID → 401 UNAUTHORIZED', async () => {
    const tok = await makeIdToken({ aud: 'other-app.apps.googleusercontent.com' })
    const res = await postGoogle({ credential: tok })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error: string }).error).toBe('UNAUTHORIZED')
  })

  it('foreign iss → 401 UNAUTHORIZED', async () => {
    const tok = await makeIdToken({ iss: 'https://evil.example.com' })
    const res = await postGoogle({ credential: tok })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error: string }).error).toBe('UNAUTHORIZED')
  })

  it('expired exp → 401 UNAUTHORIZED', async () => {
    const tok = await makeIdToken({ exp: Math.floor(Date.now() / 1000) - 3600 })
    const res = await postGoogle({ credential: tok })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error: string }).error).toBe('UNAUTHORIZED')
  })

  it('signed by foreign key (not in JWKS) → 401 UNAUTHORIZED', async () => {
    const tok = await makeIdToken({ key: foreignPriv })
    const res = await postGoogle({ credential: tok })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { error: string }).error).toBe('UNAUTHORIZED')
  })

  it('missing credential → 400 VALIDATION_ERROR', async () => {
    const res = await postGoogle({})
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('VALIDATION_ERROR')
  })

  it('non-string credential → 400 VALIDATION_ERROR', async () => {
    const res = await postGoogle({ credential: 12345 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('VALIDATION_ERROR')
  })

  it('6th attempt within window from one IP → 429 RATE_LIMITED', async () => {
    const ip = '198.51.100.42'
    // Five failing attempts (foreign iss → 401 + recordFailure each) reach the cap.
    const badTok = await makeIdToken({ iss: 'https://evil.example.com' })
    for (let i = 0; i < 5; i++) {
      const r = await postGoogle({ credential: badTok }, ip)
      expect(r.status).toBe(401)
    }
    // 6th attempt — even a VALID owner token is blocked by the rate-limit gate.
    const goodTok = await makeIdToken({ email: ALLOWED_EMAIL })
    const res = await postGoogle({ credential: goodTok }, ip)
    expect(res.status).toBe(429)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('RATE_LIMITED')
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })

  it('successful login clears the IP failure counter', async () => {
    const ip = '198.51.100.99'
    const badTok = await makeIdToken({ iss: 'https://evil.example.com' })
    // Four failures (below the cap of 5).
    for (let i = 0; i < 4; i++) {
      const r = await postGoogle({ credential: badTok }, ip)
      expect(r.status).toBe(401)
    }
    // A success clears the counter…
    const goodTok = await makeIdToken({ email: ALLOWED_EMAIL })
    const okRes = await postGoogle({ credential: goodTok }, ip)
    expect(okRes.status).toBe(200)
    // …so a fresh round of failures starts from zero (not immediately limited).
    const again = await postGoogle({ credential: badTok }, ip)
    expect(again.status).toBe(401)
  })

  it('GOOGLE_CLIENT_ID unset → 503 AUTH_NOT_CONFIGURED', async () => {
    const saved = process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_ID
    try {
      const tok = await makeIdToken({ email: ALLOWED_EMAIL })
      const res = await postGoogle({ credential: tok })
      expect(res.status).toBe(503)
      expect(((await res.json()) as { error: string }).error).toBe('AUTH_NOT_CONFIGURED')
    } finally {
      process.env.GOOGLE_CLIENT_ID = saved
    }
  })
})
