/**
 * bondRedemption.test.ts — integration tests for processMaturedBonds (FR-26, arch §3.3).
 *
 * Runs against statok_test (Postgres 5434). Covers: auto-sell of a matured bond at
 * par with meta.autoRedemption, cash credited & position driven to 0, idempotency
 * (a second run creates no duplicate), multiple accounts/papers handled, and
 * not-yet-matured bonds left untouched.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { and, eq } from 'drizzle-orm'

import {
  setupTestDatabase,
  truncateAll,
  dropTestDatabase,
  makeUser,
  makeAccount,
  makeBond,
  makeTx,
  getDb,
} from './helpers/testDb.ts'
import { processMaturedBonds } from '../src/services/bond.ts'
import { computePortfolioState } from '../src/services/valuation.ts'
import { transactions } from '../src/db/schema.ts'

const TODAY = '2026-06-12'

beforeAll(async () => {
  await setupTestDatabase()
})

afterAll(async () => {
  await dropTestDatabase()
})

beforeEach(async () => {
  await truncateAll()
})

/** Count sell rows carrying meta.autoRedemption for an asset. */
async function autoRedemptionSells(userId: string, assetId: string): Promise<number> {
  const db = await getDb()
  const rows = await db
    .select({ id: transactions.id, meta: transactions.meta })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.assetId, assetId), eq(transactions.type, 'sell')))
  return rows.filter((r) => (r.meta as { autoRedemption?: boolean } | null)?.autoRedemption === true).length
}

describe('processMaturedBonds — matured bond auto-redeems at par', () => {
  it('creates a sell at face value with meta.autoRedemption; position → 0, cash up', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    // Matured (maturityDate ≤ today), face 1000.00 UAH, qty 10 held.
    const bond = await makeBond(u.id, {
      symbol: 'UA0001', currency: 'UAH', faceValueMinor: 100000,
      couponRatePercent: '15.7500', couponFrequency: 2, maturityDate: '2026-06-01',
    })
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: bond.id, type: 'buy',
      executedAt: '2025-01-10T10:00:00Z', quantity: '10', price: '1000',
      amountMinor: 1000000, currency: 'UAH',
    })

    const results = await processMaturedBonds(TODAY)
    expect(results).toHaveLength(1)
    const r = results[0]!
    expect(r.assetId).toBe(bond.id)
    expect(r.quantity).toBe('10')
    expect(r.amountMinor).toBe(1000000) // 10 × 100000 face

    // Exactly one auto-redemption sell row exists, with the flag.
    expect(await autoRedemptionSells(u.id, bond.id)).toBe(1)

    // Position folded to 0 (dropped); cash credited by the redemption amount.
    const state = await computePortfolioState(u.id, { atDate: TODAY })
    expect(state.positions.find((p) => p.asset.id === bond.id)).toBeUndefined()
    const cashUah = state.cash.find((c) => c.currency === 'UAH')!
    // bought: cash −1000000; redeemed: cash +1000000 → net 0.
    expect(cashUah.balanceMinor).toBe(0)
  })
})

describe('processMaturedBonds — idempotency', () => {
  it('a second run creates no duplicate redemption', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const bond = await makeBond(u.id, {
      symbol: 'UA0001', currency: 'UAH', faceValueMinor: 100000,
      couponRatePercent: '0', couponFrequency: 0, maturityDate: '2026-06-01',
    })
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: bond.id, type: 'buy',
      executedAt: '2025-01-10T10:00:00Z', quantity: '5', price: '1000',
      amountMinor: 500000, currency: 'UAH',
    })

    const first = await processMaturedBonds(TODAY)
    expect(first).toHaveLength(1)

    const second = await processMaturedBonds(TODAY)
    expect(second).toHaveLength(0) // already redeemed → no-op

    expect(await autoRedemptionSells(u.id, bond.id)).toBe(1)
  })
})

describe('processMaturedBonds — multiple accounts / papers', () => {
  it('redeems each held lot across accounts and distinct bonds', async () => {
    const u = await makeUser()
    const accA = await makeAccount(u.id, { name: 'broker-A' })
    const accB = await makeAccount(u.id, { name: 'broker-B' })

    const bond1 = await makeBond(u.id, {
      symbol: 'UA0001', currency: 'UAH', faceValueMinor: 100000,
      couponRatePercent: '10.0000', couponFrequency: 1, maturityDate: '2026-06-01',
    })
    const bond2 = await makeBond(u.id, {
      symbol: 'UA0002', currency: 'UAH', faceValueMinor: 200000,
      couponRatePercent: '12.0000', couponFrequency: 2, maturityDate: '2026-05-15',
    })

    // bond1 held in both accounts; bond2 held only in account B.
    await makeTx({
      userId: u.id, accountId: accA.id, assetId: bond1.id, type: 'buy',
      executedAt: '2025-01-10T10:00:00Z', quantity: '3', price: '1000',
      amountMinor: 300000, currency: 'UAH',
    })
    await makeTx({
      userId: u.id, accountId: accB.id, assetId: bond1.id, type: 'buy',
      executedAt: '2025-01-10T10:00:00Z', quantity: '7', price: '1000',
      amountMinor: 700000, currency: 'UAH',
    })
    await makeTx({
      userId: u.id, accountId: accB.id, assetId: bond2.id, type: 'buy',
      executedAt: '2025-01-10T10:00:00Z', quantity: '4', price: '2000',
      amountMinor: 800000, currency: 'UAH',
    })

    const results = await processMaturedBonds(TODAY)
    // bond1 in 2 accounts + bond2 in 1 account = 3 redemptions.
    expect(results).toHaveLength(3)

    expect(await autoRedemptionSells(u.id, bond1.id)).toBe(2)
    expect(await autoRedemptionSells(u.id, bond2.id)).toBe(1)

    const state = await computePortfolioState(u.id, { atDate: TODAY })
    expect(state.positions.filter((p) => p.asset.type === 'bond')).toHaveLength(0)

    // amounts: bond1 lots → 3×100000 and 7×100000; bond2 → 4×200000.
    const amts = results.map((r) => r.amountMinor).sort((a, b) => a - b)
    expect(amts).toEqual([300000, 700000, 800000])
  })
})

describe('processMaturedBonds — not-yet-matured untouched', () => {
  it('leaves a bond whose maturityDate > today alone', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const bond = await makeBond(u.id, {
      symbol: 'UA9999', currency: 'UAH', faceValueMinor: 100000,
      couponRatePercent: '10.0000', couponFrequency: 1, maturityDate: '2030-01-01',
    })
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: bond.id, type: 'buy',
      executedAt: '2025-01-10T10:00:00Z', quantity: '5', price: '1000',
      amountMinor: 500000, currency: 'UAH',
    })

    const results = await processMaturedBonds(TODAY)
    expect(results).toHaveLength(0)
    expect(await autoRedemptionSells(u.id, bond.id)).toBe(0)

    // Position still held.
    const state = await computePortfolioState(u.id, { atDate: TODAY })
    expect(state.positions.find((p) => p.asset.id === bond.id)?.quantity).toBe('5')
  })
})
