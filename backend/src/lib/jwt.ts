/**
 * JWT signing / verification — jose, HS256, TTL 7 days (ТЗ §9, FR-02).
 *
 * Claims: `sub` (userId), `username`, `exp`. No server-side revocation —
 * logout is client-side; refresh re-issues a fresh token (sliding, §9).
 * The secret comes from JWT_SECRET (validated >= 32 bytes on boot, index.ts).
 */

import { SignJWT, jwtVerify } from 'jose'

/** TTL: 7 days, expressed in seconds for the `exp` claim. */
export const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60

/** Payload carried in / extracted from a Statok JWT. */
export interface TokenPayload {
  /** User id (JWT `sub`). */
  userId: string
  /** Username (convenience claim). */
  username: string
}

let cachedSecret: Uint8Array | undefined

/** Encode JWT_SECRET once; throws if unset (boot validation guarantees it). */
function getSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET is not set')
  }
  cachedSecret = new TextEncoder().encode(secret)
  return cachedSecret
}

/**
 * Sign a token for the given user. HS256, `exp` = now + 7 days.
 * Returns the compact JWS string.
 */
export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ username: payload.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(getSecret())
}

/**
 * Verify a token (signature + `exp`). Returns the payload, or `null` when the
 * token is missing/invalid/expired/malformed (caller maps null → 401).
 */
export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
    const userId = payload.sub
    const username = payload.username
    if (typeof userId !== 'string' || typeof username !== 'string') {
      return null
    }
    return { userId, username }
  } catch {
    return null
  }
}
