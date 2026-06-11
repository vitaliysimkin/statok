/**
 * Admin seeding — FR-01, ТЗ §1.2.
 *
 * On boot: if ADMIN_USERNAME is absent from the users table, create it with
 * bcrypt(ADMIN_PASSWORD, 10). An existing user is NEVER overwritten — changing
 * ADMIN_PASSWORD + restart does not change the stored password (v1 password
 * change is manual SQL / re-seed, documented in README).
 */

import { eq } from 'drizzle-orm'

import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { logger } from './logger.js'
import { hashPassword } from './password.js'

export async function seedAdmin(): Promise<void> {
  const username = process.env.ADMIN_USERNAME
  const password = process.env.ADMIN_PASSWORD

  if (!username || !password) {
    logger.warn('seed: ADMIN_USERNAME / ADMIN_PASSWORD not set — skipping admin seed')
    return
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1)

  if (existing.length > 0) {
    // Existing user — do NOT overwrite (FR-01).
    logger.info('seed: admin user already exists, leaving untouched', { username })
    return
  }

  const passwordHash = await hashPassword(password)
  await db.insert(users).values({ username, passwordHash })

  logger.info('seed: created admin user', { username })
}
