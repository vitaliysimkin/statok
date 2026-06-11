import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set')
}

/**
 * Raw postgres connection (used by drizzle-kit migrations).
 * max:1 for migrations; the app uses the same client via drizzle.
 */
export const sql = postgres(connectionString, { max: 10 })

/**
 * Drizzle ORM instance — import this throughout the app.
 */
export const db = drizzle(sql)
