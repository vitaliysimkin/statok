/**
 * Google OIDC ID-token verification — Google sign-in (tasks/google-auth-task.md §1.2, §6).
 *
 * Verifies a Google Identity Services (GIS) ID token using `jose` (already an
 * allowed runtime dep — NO new dependency, CLAUDE.md / ТЗ §0). We verify the
 * SIGNATURE against Google's published JWKS and every required claim:
 *   - signature (RS256, key from JWKS)
 *   - iss ∈ {accounts.google.com, https://accounts.google.com}
 *   - aud === GOOGLE_CLIENT_ID   (CRITICAL — without it, a validly-signed Google
 *                                 token issued for ANOTHER app would pass)
 *   - exp                         (jose enforces automatically)
 *   - email_verified === true
 * Returns only the verified `email`. The allowlist check (email === owner) lives
 * in the route, since this helper is about Google-trust, not Statok authorization.
 *
 * SECURITY: the `credential` is NEVER logged here or by the caller. The Google
 * token lives only in memory for the duration of one /auth/google request and is
 * never stored (no DB, no localStorage, no logs) — ТЗ §6 / NFR-02.
 *
 * The only outbound HTTP this introduces is to Google's JWKS endpoint
 * (`www.googleapis.com`) — allowed per the updated NFR-01 host list.
 */

import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose'
import type { JWTVerifyGetKey } from 'jose'

/** Google's OIDC issuer values (both forms appear in real tokens). */
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'] as const

/** Google's published JWKS endpoint (RS256 signing keys). */
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'

/**
 * Remote JWKS — created ONCE per module (ТЗ §1.2). `jose` caches keys honoring
 * the endpoint's HTTP cache-control and rotates them transparently; we must NOT
 * re-create this per request, nor pin keys by hand (ТЗ §6).
 *
 * Typed as `JWTVerifyGetKey` so the testable seam (`verifyGoogleIdTokenWith`)
 * accepts either this remote set OR a local key resolver in unit tests
 * (jose `createLocalJWKSet` / a `generateKeyPair('RS256')`-backed function),
 * exercising the verifier WITHOUT any network call.
 */
const JWKS: JWTVerifyGetKey = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL))

/** Distinguishes "config missing" from "token rejected" so the route can map codes. */
export type GoogleVerifyErrorReason =
  /** GOOGLE_CLIENT_ID not configured — route returns 503 AUTH_NOT_CONFIGURED. */
  | 'not_configured'
  /** Signature / iss / aud / exp / shape invalid — route returns 401 UNAUTHORIZED. */
  | 'invalid_token'
  /** Token valid but email not verified by Google — route returns 403 FORBIDDEN. */
  | 'email_unverified'

/** Typed signal a route maps to a canonical {error, message} response. Carries NO credential. */
export class GoogleVerifyError extends Error {
  constructor(public readonly reason: GoogleVerifyErrorReason, message: string) {
    super(message)
    this.name = 'GoogleVerifyError'
  }
}

export interface GoogleIdentity {
  /** Verified, Google-canonical email address (compared case-insensitively by the caller). */
  email: string
}

/**
 * Verify a Google ID token (`credential`) and return the verified identity.
 *
 * Thin production wrapper: reads `GOOGLE_CLIENT_ID` from env and delegates to the
 * network-free, dependency-injected core `verifyGoogleIdTokenWith`, passing the
 * module-level remote JWKS. Unit tests should call the core directly with a local
 * key resolver instead (see `verifyGoogleIdTokenWith`).
 *
 * @throws {GoogleVerifyError} `not_configured` if GOOGLE_CLIENT_ID is unset,
 *   `invalid_token` on any signature/claim failure, `email_unverified` when
 *   Google has not verified the email. Never throws with the credential in the message.
 */
export async function verifyGoogleIdToken(credential: string): Promise<GoogleIdentity> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    throw new GoogleVerifyError('not_configured', 'GOOGLE_CLIENT_ID is not configured')
  }
  return verifyGoogleIdTokenWith(JWKS, credential, { clientId })
}

/**
 * TESTABLE SEAM — network-free core of Google ID-token verification.
 *
 * Identical security checks as {@link verifyGoogleIdToken}, but the JWKS key
 * resolver (`jwks`) and the expected `clientId` (audience) are INJECTED rather
 * than read from the module/env. This lets unit tests supply a local resolver
 * (e.g. jose `createLocalJWKSet(publicJwk)` or a function backed by
 * `generateKeyPair('RS256')`) and sign their own ID tokens, exercising every
 * signature/iss/aud/exp/email_verified path with NO outbound HTTP.
 *
 * Signature pinning: only `RS256` is accepted (`algorithms: ['RS256']`) — this
 * blocks alg-confusion / `alg:none` downgrade attacks (task §2). Production passes
 * the module-level remote JWKS; only `not_configured` (missing clientId) is handled
 * by the env wrapper above.
 *
 * @param jwks      Key resolver: remote (prod) or local (tests). `JWTVerifyGetKey`.
 * @param credential The Google ID token JWT to verify. Never logged.
 * @param opts.clientId Expected `aud` — the Google OAuth Web Client ID.
 * @throws {GoogleVerifyError} `invalid_token` on any signature/claim failure;
 *   `email_unverified` when Google has not verified the email.
 */
export async function verifyGoogleIdTokenWith(
  jwks: JWTVerifyGetKey,
  credential: string,
  opts: { clientId: string },
): Promise<GoogleIdentity> {
  let payload: Awaited<ReturnType<typeof jwtVerify>>['payload']
  try {
    // Verifies signature against JWKS + enforces iss, aud and exp (NotBefore/Expiry).
    // algorithms: ['RS256'] PINS the signature alg — defends against alg-confusion
    // and `alg:none` (task §2). Google always signs ID tokens with RS256.
    ;({ payload } = await jwtVerify(credential, jwks, {
      issuer: [...GOOGLE_ISSUERS],
      audience: opts.clientId,
      algorithms: ['RS256'],
    }))
  } catch (err) {
    // Any verification failure (bad signature, wrong iss/aud, expired, malformed,
    // JWKS lookup miss) collapses to a single opaque reason. We surface a short,
    // credential-free hint for logs only via err.code where available.
    const code = err instanceof joseErrors.JOSEError ? err.code : 'ERR_JWT_INVALID'
    throw new GoogleVerifyError('invalid_token', `Google ID token rejected (${code})`)
  }

  // email_verified must be a real boolean true — Google may send it as the
  // boolean true or the string "true"; accept both, reject everything else.
  const emailVerified = payload.email_verified
  if (emailVerified !== true && emailVerified !== 'true') {
    throw new GoogleVerifyError('email_unverified', 'Google email is not verified')
  }

  const email = payload.email
  if (typeof email !== 'string' || email.length === 0) {
    // A verified Google token without an email is malformed for our purposes.
    throw new GoogleVerifyError('invalid_token', 'Google ID token has no email claim')
  }

  return { email }
}
