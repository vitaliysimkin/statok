/**
 * accounts.ts — CRUD + balances (ST-014, FR-05..FR-09, arch §2 accounts).
 *
 * Balances (withBalances=true) fold all monetary transactions via valuation,
 * then convert position values to BASE_CURRENCY using the fx service.
 */

import { Hono } from 'hono'
import { and, asc, eq, isNull } from 'drizzle-orm'

import { db } from '../db/index.ts'
import { accounts, transactions } from '../db/schema.ts'
import type { AppEnv } from '../middleware/requestContext.ts'
import { getUserId } from '../middleware/requestContext.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { computePortfolioState } from '../services/valuation.ts'
import { convert, FxRateNotFoundError } from '../services/fx.ts'

const BASE_CURRENCY = (process.env['BASE_CURRENCY'] ?? 'USD') as string

export const accountsRouter = new Hono<AppEnv>()

accountsRouter.use('*', authMiddleware)

// ---------------------------------------------------------------------------
// GET /api/accounts
// ---------------------------------------------------------------------------
accountsRouter.get('/', async (c) => {
  const userId = getUserId(c)
  const withBalances = c.req.query('withBalances') === 'true'
  const includeArchived = c.req.query('includeArchived') === 'true'

  const rows = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        includeArchived ? undefined : isNull(accounts.archivedAt),
      ),
    )
    .orderBy(asc(accounts.sortOrder), asc(accounts.name))

  if (!withBalances) {
    return c.json({ items: rows.map(toDto) })
  }

  // Compute balances via fold
  const today = todayInKyiv()
  const state = await computePortfolioState(userId, { atDate: today })

  // Group cash by accountId
  const cashByAccount = new Map<string, { currency: string; cashMinor: number }[]>()
  for (const cash of state.cash) {
    const list = cashByAccount.get(cash.accountId) ?? []
    list.push({ currency: cash.currency, cashMinor: cash.balanceMinor })
    cashByAccount.set(cash.accountId, list)
  }

  // Group positions by accountId
  const posByAccount = new Map<string, typeof state.positions>()
  for (const pos of state.positions) {
    const list = posByAccount.get(pos.accountId) ?? []
    list.push(pos)
    posByAccount.set(pos.accountId, list)
  }

  const items = await Promise.all(rows.map(async (row) => {
    const balances = cashByAccount.get(row.id) ?? []
    const positions = posByAccount.get(row.id) ?? []

    let valueBaseMinor = 0
    let valuationIncomplete = false

    // Sum cash values converted to base currency
    for (const b of balances) {
      try {
        const res = await convert(b.cashMinor, b.currency as string, BASE_CURRENCY, today)
        valueBaseMinor += res.amountMinor
      } catch (e) {
        if (e instanceof FxRateNotFoundError) valuationIncomplete = true
        else throw e
      }
    }

    // Sum position values converted to base currency
    for (const pos of positions) {
      if (pos.valueMinor === null) {
        valuationIncomplete = true
        continue
      }
      try {
        const res = await convert(pos.valueMinor, pos.asset.currency as string, BASE_CURRENCY, today)
        valueBaseMinor += res.amountMinor
      } catch (e) {
        if (e instanceof FxRateNotFoundError) valuationIncomplete = true
        else throw e
      }
    }

    return {
      ...toDto(row),
      balances,
      valueBaseMinor,
      ...(valuationIncomplete ? { valuationIncomplete: true } : {}),
    }
  }))

  return c.json({ items })
})

// ---------------------------------------------------------------------------
// POST /api/accounts
// ---------------------------------------------------------------------------
accountsRouter.post('/', async (c) => {
  const userId = getUserId(c)
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid JSON body' }, 400) }

  const b = body as Record<string, unknown>
  const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
  if (!name) return c.json({ error: 'VALIDATION_ERROR', message: 'name is required' }, 400)

  const KINDS = ['broker', 'exchange', 'bank', 'wallet', 'other'] as const
  type AccountKind = typeof KINDS[number]
  const kind: AccountKind = KINDS.includes(b['kind'] as AccountKind) ? (b['kind'] as AccountKind) : 'broker'
  if (b['kind'] != null && !KINDS.includes(b['kind'] as AccountKind)) {
    return c.json({ error: 'VALIDATION_ERROR', message: `kind must be one of ${KINDS.join(', ')}` }, 400)
  }

  const note = typeof b['note'] === 'string' ? b['note'] : ''
  const interestRatePercent = typeof b['interestRatePercent'] === 'string' || typeof b['interestRatePercent'] === 'number'
    ? String(b['interestRatePercent'])
    : null
  const termEndDate = typeof b['termEndDate'] === 'string' ? b['termEndDate'] : null

  // Check duplicate name
  const existing = await db.select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.name, name)))
    .limit(1)
  if (existing.length > 0) return c.json({ error: 'CONFLICT', message: `Account name "${name}" is already taken` }, 409)

  const [account] = await db.insert(accounts).values({
    userId,
    name,
    kind,
    note,
    ...(interestRatePercent != null ? { interestRatePercent } : {}),
    ...(termEndDate != null ? { termEndDate } : {}),
  }).returning()

  return c.json({ account: toDto(account!) }, 201)
})

// ---------------------------------------------------------------------------
// GET /api/accounts/:id
// ---------------------------------------------------------------------------
accountsRouter.get('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const row = await getAccountOwnedBy(userId, id)
  if (!row) return c.json({ error: 'NOT_FOUND', message: 'Account not found' }, 404)
  return c.json({ account: toDto(row) })
})

// ---------------------------------------------------------------------------
// PUT /api/accounts/:id
// ---------------------------------------------------------------------------
accountsRouter.put('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const row = await getAccountOwnedBy(userId, id)
  if (!row) return c.json({ error: 'NOT_FOUND', message: 'Account not found' }, 404)

  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid JSON body' }, 400) }
  const b = body as Record<string, unknown>

  const updates: Partial<typeof accounts.$inferInsert> & { archivedAt?: Date | null; updatedAt?: Date } = {}

  if ('name' in b) {
    const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
    if (!name) return c.json({ error: 'VALIDATION_ERROR', message: 'name must not be empty' }, 400)
    if (name !== row.name) {
      const dup = await db.select({ id: accounts.id }).from(accounts)
        .where(and(eq(accounts.userId, userId), eq(accounts.name, name))).limit(1)
      if (dup.length > 0) return c.json({ error: 'CONFLICT', message: `Account name "${name}" is already taken` }, 409)
    }
    updates.name = name
  }
  if ('kind' in b) {
    const KINDS = ['broker', 'exchange', 'bank', 'wallet', 'other'] as const
    if (!KINDS.includes(b['kind'] as typeof KINDS[number])) {
      return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid kind' }, 400)
    }
    updates.kind = b['kind'] as typeof KINDS[number]
  }
  if ('note' in b) updates.note = String(b['note'] ?? '')
  if ('sortOrder' in b && typeof b['sortOrder'] === 'number') updates.sortOrder = b['sortOrder']
  if ('interestRatePercent' in b) {
    updates.interestRatePercent = b['interestRatePercent'] != null ? String(b['interestRatePercent']) : null
  }
  if ('termEndDate' in b) {
    updates.termEndDate = typeof b['termEndDate'] === 'string' ? b['termEndDate'] : null
  }
  if ('archived' in b) {
    updates.archivedAt = b['archived'] === true ? new Date() : null
  }

  updates.updatedAt = new Date()

  const [updated] = await db.update(accounts).set(updates).where(eq(accounts.id, id)).returning()
  return c.json({ account: toDto(updated!) })
})

// ---------------------------------------------------------------------------
// DELETE /api/accounts/:id
// ---------------------------------------------------------------------------
accountsRouter.delete('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const row = await getAccountOwnedBy(userId, id)
  if (!row) return c.json({ error: 'NOT_FOUND', message: 'Account not found' }, 404)

  // Check for any transactions
  const txRows = await db.select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.accountId, id))
    .limit(1)
  if (txRows.length > 0) {
    return c.json({ error: 'ACCOUNT_HAS_TRANSACTIONS', message: 'Cannot delete an account with transactions; archive it instead' }, 409)
  }

  await db.delete(accounts).where(eq(accounts.id, id))
  return new Response(null, { status: 204 })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getAccountOwnedBy(userId: string, id: string) {
  const rows = await db.select().from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.id, id))).limit(1)
  return rows[0]
}

function toDto(row: typeof accounts.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    note: row.note,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    interestRatePercent: row.interestRatePercent ?? null,
    termEndDate: row.termEndDate ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function todayInKyiv(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(new Date())
}
