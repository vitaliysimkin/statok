/**
 * valuation.test.ts — integration tests for computePortfolioState (arch §3.1).
 *
 * Runs against a throwaway statok_test DB (Postgres 5434). Covers the fold:
 * buy/sell cost-basis & cash, realized P&L, oversell conflicts (past + future),
 * splits, opening_balance variants, pricing fallbacks and the stable tie-break.
 *
 * These tests fix the SPEC behaviour (arch §3.1). A real code bug → test.todo
 * with an explanatory note, never a test bent to match the bug.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test'

import {
  setupTestDatabase,
  truncateAll,
  dropTestDatabase,
  makeUser,
  makeAccount,
  makeStock,
  makeCash,
  makeBond,
  makeTx,
  makeQuote,
} from './helpers/testDb.ts'
import { computePortfolioState } from '../src/services/valuation.ts'

const AT = '2026-06-12'

beforeAll(async () => {
  await setupTestDatabase()
})

afterAll(async () => {
  await dropTestDatabase()
})

beforeEach(async () => {
  await truncateAll()
})

describe('valuation — buy / cost basis / cash', () => {
  it('buy with fee folds fee into cost basis and cash', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const stock = await makeStock(u.id, { symbol: 'AAPL', currency: 'USD' })

    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'buy',
      executedAt: '2026-01-10T10:00:00Z', quantity: '10', price: '100',
      amountMinor: 100000, currency: 'USD', feeMinor: 500,
    })

    const state = await computePortfolioState(u.id, { atDate: AT })
    expect(state.positions).toHaveLength(1)
    const p = state.positions[0]!
    expect(p.quantity).toBe('10')
    expect(p.costBasisMinor).toBe(100500) // amount + fee
    expect(p.avgCostMinor).toBe(10050)
    // cash dropped by amount + fee
    expect(state.cash.find((c) => c.currency === 'USD')!.balanceMinor).toBe(-100500)
    expect(state.conflicts).toHaveLength(0)
  })
})

describe('valuation — sell / realized (half-up costPart)', () => {
  it('partial sell: costPart half-up and realized correct', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const stock = await makeStock(u.id, { symbol: 'AAPL', currency: 'USD' })

    // Buy 3 @ 100 = 30000, fee 0 → cost basis 30000, qty 3.
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'buy',
      executedAt: '2026-01-10T10:00:00Z', quantity: '3', price: '100',
      amountMinor: 30000, currency: 'USD', feeMinor: 0,
    })
    // Sell 1 @ 120 = 12000. costPart = roundHalfUp(30000 × 1 / 3) = 10000.
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'sell',
      executedAt: '2026-02-10T10:00:00Z', quantity: '1', price: '120',
      amountMinor: 12000, currency: 'USD', feeMinor: 0,
    })

    const state = await computePortfolioState(u.id, { atDate: AT })
    const p = state.positions[0]!
    expect(p.quantity).toBe('2')
    expect(p.costBasisMinor).toBe(20000) // 30000 − 10000
    const realized = state.realized.find((r) => r.assetId === stock.id)!
    expect(realized.realizedMinor).toBe(2000) // (12000 − 0) − 10000
  })

  it('costPart rounds half-up on a non-exact proportion', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const stock = await makeStock(u.id, { symbol: 'XYZ', currency: 'USD' })

    // Buy 3 @ 33.34 ... use cost basis 10001 so 10001 × 1/3 = 3333.66… → 3334.
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'buy',
      executedAt: '2026-01-10T10:00:00Z', quantity: '3', price: '33.336667',
      amountMinor: 10001, currency: 'USD', feeMinor: 0,
    })
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'sell',
      executedAt: '2026-02-10T10:00:00Z', quantity: '1', price: '40',
      amountMinor: 4000, currency: 'USD', feeMinor: 0,
    })

    const state = await computePortfolioState(u.id, { atDate: AT })
    const p = state.positions[0]!
    // costPart = roundHalfUp(10001 / 3) = roundHalfUp(3333.6667) = 3334.
    expect(p.costBasisMinor).toBe(10001 - 3334)
    const realized = state.realized.find((r) => r.assetId === stock.id)!
    expect(realized.realizedMinor).toBe(4000 - 3334)
  })

  it('full sell removes the position but keeps realized', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const stock = await makeStock(u.id, { symbol: 'AAPL', currency: 'USD' })

    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'buy',
      executedAt: '2026-01-10T10:00:00Z', quantity: '5', price: '100',
      amountMinor: 50000, currency: 'USD', feeMinor: 0,
    })
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'sell',
      executedAt: '2026-02-10T10:00:00Z', quantity: '5', price: '130',
      amountMinor: 65000, currency: 'USD', feeMinor: 0,
    })

    const state = await computePortfolioState(u.id, { atDate: AT })
    expect(state.positions).toHaveLength(0) // qty 0 dropped
    const realized = state.realized.find((r) => r.assetId === stock.id)!
    expect(realized.realizedMinor).toBe(15000) // 65000 − 50000
  })

  it('fee on sell reduces proceeds and realized', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const stock = await makeStock(u.id, { symbol: 'AAPL', currency: 'USD' })

    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'buy',
      executedAt: '2026-01-10T10:00:00Z', quantity: '5', price: '100',
      amountMinor: 50000, currency: 'USD', feeMinor: 0,
    })
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'sell',
      executedAt: '2026-02-10T10:00:00Z', quantity: '5', price: '130',
      amountMinor: 65000, currency: 'USD', feeMinor: 1000,
    })

    const state = await computePortfolioState(u.id, { atDate: AT })
    const realized = state.realized.find((r) => r.assetId === stock.id)!
    expect(realized.realizedMinor).toBe(14000) // (65000 − 1000) − 50000
    // cash gained proceeds − fee.
    expect(state.cash.find((c) => c.currency === 'USD')!.balanceMinor).toBe(-50000 + 64000)
  })
})

describe('valuation — oversell conflicts (FR-15a)', () => {
  it('past-dated oversell flags a conflict', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const stock = await makeStock(u.id, { symbol: 'AAPL', currency: 'USD' })

    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'buy',
      executedAt: '2026-01-10T10:00:00Z', quantity: '2', price: '100',
      amountMinor: 20000, currency: 'USD',
    })
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'sell',
      executedAt: '2026-02-10T10:00:00Z', quantity: '3', price: '100',
      amountMinor: 30000, currency: 'USD',
    })

    const state = await computePortfolioState(u.id, { atDate: AT })
    expect(state.conflicts.length).toBeGreaterThan(0)
    expect(state.conflicts[0]!.assetId).toBe(stock.id)
  })

  it('future-dated oversell is detected only with fullTimeline (wave-1 regression)', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const stock = await makeStock(u.id, { symbol: 'AAPL', currency: 'USD' })

    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'buy',
      executedAt: '2026-01-10T10:00:00Z', quantity: '2', price: '100',
      amountMinor: 20000, currency: 'USD',
    })
    // Sell dated in the future relative to AT.
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'sell',
      executedAt: '2026-12-31T10:00:00Z', quantity: '3', price: '100',
      amountMinor: 30000, currency: 'USD',
    })

    // Bounded by AT — the future sell is out of scope, no conflict surfaces.
    const bounded = await computePortfolioState(u.id, { atDate: AT })
    expect(bounded.conflicts).toHaveLength(0)

    // fullTimeline replays the whole timeline → the oversell is detected.
    const full = await computePortfolioState(u.id, { atDate: AT, fullTimeline: true })
    expect(full.conflicts.length).toBeGreaterThan(0)
    expect(full.conflicts[0]!.assetId).toBe(stock.id)
  })
})

describe('valuation — split', () => {
  it('4:1 split multiplies qty, cost basis unchanged', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const stock = await makeStock(u.id, { symbol: 'AAPL', currency: 'USD' })

    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'buy',
      executedAt: '2026-01-10T10:00:00Z', quantity: '10', price: '100',
      amountMinor: 100000, currency: 'USD',
    })
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'split',
      executedAt: '2026-02-10T10:00:00Z', quantity: '4', currency: 'USD',
    })

    const state = await computePortfolioState(u.id, { atDate: AT })
    const p = state.positions[0]!
    expect(p.quantity).toBe('40') // 10 × 4
    expect(p.costBasisMinor).toBe(100000) // unchanged
  })

  it('reverse split (0.1) divides qty, cost basis unchanged', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const stock = await makeStock(u.id, { symbol: 'AAPL', currency: 'USD' })

    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'buy',
      executedAt: '2026-01-10T10:00:00Z', quantity: '100', price: '10',
      amountMinor: 100000, currency: 'USD',
    })
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'split',
      executedAt: '2026-02-10T10:00:00Z', quantity: '0.1', currency: 'USD',
    })

    const state = await computePortfolioState(u.id, { atDate: AT })
    const p = state.positions[0]!
    expect(p.quantity).toBe('10') // 100 × 0.1
    expect(p.costBasisMinor).toBe(100000)
  })
})

describe('valuation — opening_balance', () => {
  it('asset variant with explicit amount sets cost basis directly', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const stock = await makeStock(u.id, { symbol: 'AAPL', currency: 'USD' })

    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'opening_balance',
      executedAt: '2026-01-01T10:00:00Z', quantity: '5', amountMinor: 75000, currency: 'USD',
    })

    const state = await computePortfolioState(u.id, { atDate: AT })
    const p = state.positions[0]!
    expect(p.quantity).toBe('5')
    expect(p.costBasisMinor).toBe(75000)
    expect(p.costBasisIncomplete).toBe(false)
  })

  it('asset variant without amount uses last quote ≤ date for cost basis', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const stock = await makeStock(u.id, { symbol: 'AAPL', currency: 'USD' })
    // Quote on/before the opening_balance date.
    await makeQuote(stock.id, '2026-01-01', '100', 'USD', 'manual')

    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'opening_balance',
      executedAt: '2026-01-02T10:00:00Z', quantity: '5', amountMinor: null, currency: 'USD',
    })

    const state = await computePortfolioState(u.id, { atDate: AT })
    const p = state.positions[0]!
    // cost basis = roundHalfUp(5 × 10000) = 50000.
    expect(p.costBasisMinor).toBe(50000)
    expect(p.costBasisIncomplete).toBe(false)
  })

  it('asset variant without amount and no quote → costBasisIncomplete', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const stock = await makeStock(u.id, { symbol: 'AAPL', currency: 'USD' })

    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'opening_balance',
      executedAt: '2026-01-02T10:00:00Z', quantity: '5', amountMinor: null, currency: 'USD',
    })

    const state = await computePortfolioState(u.id, { atDate: AT })
    const p = state.positions[0]!
    expect(p.costBasisMinor).toBe(0)
    expect(p.costBasisIncomplete).toBe(true)
  })

  it('cash variant adds to the cash balance', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const cash = await makeCash(u.id, 'USD')

    await makeTx({
      userId: u.id, accountId: acc.id, assetId: cash.id, type: 'opening_balance',
      executedAt: '2026-01-01T10:00:00Z', amountMinor: 250000, currency: 'USD',
    })

    const state = await computePortfolioState(u.id, { atDate: AT })
    expect(state.positions).toHaveLength(0) // cash is not a position
    expect(state.cash.find((c) => c.currency === 'USD')!.balanceMinor).toBe(250000)
  })
})

describe('valuation — pricing fallbacks & edge cases', () => {
  it('qty == 0 (buy then full sell) is excluded from positions', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const stock = await makeStock(u.id, { symbol: 'AAPL', currency: 'USD' })

    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'buy',
      executedAt: '2026-01-10T10:00:00Z', quantity: '5', price: '100',
      amountMinor: 50000, currency: 'USD',
    })
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'sell',
      executedAt: '2026-02-10T10:00:00Z', quantity: '5', price: '100',
      amountMinor: 50000, currency: 'USD',
    })

    const state = await computePortfolioState(u.id, { atDate: AT })
    expect(state.positions.find((p) => p.asset.id === stock.id)).toBeUndefined()
  })

  it('negative cash balance is allowed (no conflict)', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const stock = await makeStock(u.id, { symbol: 'AAPL', currency: 'USD' })

    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'buy',
      executedAt: '2026-01-10T10:00:00Z', quantity: '5', price: '100',
      amountMinor: 50000, currency: 'USD',
    })

    const state = await computePortfolioState(u.id, { atDate: AT })
    expect(state.cash.find((c) => c.currency === 'USD')!.balanceMinor).toBe(-50000)
    expect(state.conflicts).toHaveLength(0)
  })

  it('bond without a quote falls back to face value', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const bond = await makeBond(u.id, {
      symbol: 'UA0001', currency: 'UAH', faceValueMinor: 100000,
      couponRatePercent: '15.7500', couponFrequency: 2, maturityDate: '2028-01-01',
    })

    await makeTx({
      userId: u.id, accountId: acc.id, assetId: bond.id, type: 'buy',
      executedAt: '2026-01-10T10:00:00Z', quantity: '10', price: '1000',
      amountMinor: 1000000, currency: 'UAH',
    })

    const state = await computePortfolioState(u.id, { atDate: AT })
    const p = state.positions[0]!
    expect(p.lastPrice).toBe('1000.00') // face value 100000 minor → 1000.00
    expect(p.valueMinor).toBe(1000000) // 10 × 100000
  })

  it('stock without a quote → valueMinor null', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const stock = await makeStock(u.id, { symbol: 'AAPL', currency: 'USD' })

    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'buy',
      executedAt: '2026-01-10T10:00:00Z', quantity: '5', price: '100',
      amountMinor: 50000, currency: 'USD',
    })

    const state = await computePortfolioState(u.id, { atDate: AT })
    const p = state.positions[0]!
    expect(p.valueMinor).toBeNull()
    expect(p.unrealizedMinor).toBeNull()
  })

  it('quote in a FOREIGN currency is treated as no quote (wave-1 regression)', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const stock = await makeStock(u.id, { symbol: 'AAPL', currency: 'USD' })
    // Quote stored in EUR while the asset trades in USD → must be ignored.
    await makeQuote(stock.id, '2026-06-01', '90', 'EUR', 'manual')

    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'buy',
      executedAt: '2026-01-10T10:00:00Z', quantity: '5', price: '100',
      amountMinor: 50000, currency: 'USD',
    })

    const state = await computePortfolioState(u.id, { atDate: AT })
    const p = state.positions[0]!
    expect(p.lastPrice).toBeNull()
    expect(p.valueMinor).toBeNull()
  })
})

describe('valuation — stable tie-break (equal executedAt → createdAt, id)', () => {
  it('buy-before-sell at the same executedAt is ordered by createdAt', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const stock = await makeStock(u.id, { symbol: 'AAPL', currency: 'USD' })

    const sameInstant = '2026-01-10T10:00:00Z'
    // Insert buy with an EARLIER createdAt than the sell so the tie-break orders
    // buy first — otherwise the sell would oversell and flag a conflict.
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'buy',
      executedAt: sameInstant, createdAt: '2026-01-10T09:00:00Z',
      quantity: '5', price: '100', amountMinor: 50000, currency: 'USD',
    })
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'sell',
      executedAt: sameInstant, createdAt: '2026-01-10T09:00:01Z',
      quantity: '5', price: '110', amountMinor: 55000, currency: 'USD',
    })

    const state = await computePortfolioState(u.id, { atDate: AT })
    // No conflict: buy folded before sell despite identical executedAt.
    expect(state.conflicts).toHaveLength(0)
    expect(state.positions).toHaveLength(0)
    const realized = state.realized.find((r) => r.assetId === stock.id)!
    expect(realized.realizedMinor).toBe(5000)
  })
})
