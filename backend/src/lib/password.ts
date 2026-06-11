/**
 * Password hashing — bcryptjs, cost 10 (tardis convention, ТЗ §9).
 *
 * Used by seedAdmin (ST-009) and the auth login route (ST-011).
 */

import bcrypt from 'bcryptjs'

const COST = 10

/** Hash a plaintext password with bcrypt (cost 10). */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST)
}

/** Verify a plaintext password against a stored bcrypt hash. */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
