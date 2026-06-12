/**
 * pnl.test.ts — integration tests for computePnl (arch §3.2, FR-37/FR-38).
 *
 * Runs against statok_test (Postgres 5434). BASE_CURRENCY is pinned to USD by the
 * test harness. Covers: realized only for sells inside [from,to] (basis from full
 * history), income by type at the FX rate of the PAYOUT date, fees excluded from
 * total, total = realized + income + unrealized, and valuationIncomplete on a
 * missing FX rate.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test'

import {
  setupTestDatabase,
  truncateAll,
  dropTestDatabase,
  makeUser,
  makeAccount,
  makeStock,
  makeBond,
  makeCash,
  makeTx,
  makeQuote,
  makeFxRate,
} from './helpers/testDb.ts'
import { computePnl } from '../src/services/pnl.ts'

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

describe('pnl — realized trading', () => {
  it('realized counts only sells within [from,to]; basis from full history', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const stock = await makeStock(u.id, { symbol: 'AAPL', currency: 'USD' })

    // Full-history basis: buy 10 @ 100 = 100000 (qty 10, basis 100000).
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'buy',
      executedAt: '2026-01-10T10:00:00Z', quantity: '10', price: '100',
      amountMinor: 100000, currency: 'USD',
    })
    // Sell 5 @ 120 BEFORE the period — excluded from realized, but moves basis.
    // costPart = roundHalfUp(100000 × 5 / 10) = 50000; realized 10000 (excluded).
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'sell',
      executedAt: '2026-02-01T10:00:00Z', quantity: '5', price: '120',
      amountMinor: 60000, currency: 'USD',
    })
    // Sell 5 @ 130 INSIDE the period. Basis now 50000 over qty 5 →
    // costPart = roundHalfUp(50000 × 5 / 5) = 50000; realized = 65000 − 50000 = 15000.
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'sell',
      executedAt: '2026-04-01T10:00:00Z', quantity: '5', price: '130',
      amountMinor: 65000, currency: 'USD',
    })

    const pnl = await computePnl(u.id, { from: '2026-03-01', to: '2026-05-01', atDate: AT })
    // USD→USD identity (base = USD): realized base = 15000 only.
    expect(pnl.realizedTradingBaseMinor).toBe(15000)
  })
})

describe('pnl — income by type at payout-date rate', () => {
  it('dividend/coupon/interest summed by type, each at its own date rate', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    // EUR stock so income needs an FX conversion to USD base.
    const stock = await makeStock(u.id, { symbol: 'SAP.DE', currency: 'EUR' })
    const bond = await makeBond(u.id, {
      symbol: 'UA0001', currency: 'EUR', faceValueMinor: 100000,
      couponRatePercent: '5.0000', couponFrequency: 2, maturityDate: '2030-01-01',
    })
    const cash = await makeCash(u.id, 'EUR')

    // Two different EUR→USD rates on two different dates.
    await makeFxRate('2026-03-15', 'EUR', 'USD', '1.10000000', 'frankfurter')
    await makeFxRate('2026-04-20', 'EUR', 'USD', '1.20000000', 'frankfurter')

    // Dividend gross 10000, wht 1000, net 9000 on 2026-03-15 → ×1.1 = 9900.
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'dividend',
      executedAt: '2026-03-15T10:00:00Z', currency: 'EUR',
      grossMinor: 10000, withholdingTaxMinor: 1000, netMinor: 9000,
    })
    // Coupon net 5000 on 2026-04-20 → ×1.2 = 6000.
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: bond.id, type: 'coupon',
      executedAt: '2026-04-20T10:00:00Z', currency: 'EUR',
      grossMinor: 5000, withholdingTaxMinor: 0, netMinor: 5000,
    })
    // Interest net 2000 on 2026-03-15 → ×1.1 = 2200.
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: cash.id, type: 'interest',
      executedAt: '2026-03-15T10:00:00Z', currency: 'EUR',
      grossMinor: 2000, withholdingTaxMinor: 0, netMinor: 2000,
    })

    const pnl = await computePnl(u.id, { from: '2026-01-01', to: '2026-05-01', atDate: AT })
    expect(pnl.income.dividendsBaseMinor).toBe(9900)
    expect(pnl.income.couponsBaseMinor).toBe(6000)
    expect(pnl.income.interestBaseMinor).toBe(2200)
  })
})

describe('pnl — fees, total composition', () => {
  it('fees are reported but NOT part of total; total = realized + income + unrealized', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    const stock = await makeStock(u.id, { symbol: 'AAPL', currency: 'USD' })

    // Buy 10 @ 100 fee 200 → basis 100200.
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'buy',
      executedAt: '2026-01-10T10:00:00Z', quantity: '10', price: '100',
      amountMinor: 100000, currency: 'USD', feeMinor: 200,
    })
    // Sell 5 @ 130 fee 300 inside period.
    // costPart = roundHalfUp(100200 × 5 / 10) = 50100.
    // realized = (65000 − 300) − 50100 = 14600.
    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'sell',
      executedAt: '2026-04-01T10:00:00Z', quantity: '5', price: '130',
      amountMinor: 65000, currency: 'USD', feeMinor: 300,
    })
    // Quote so the remaining 5 has a value → unrealized leg present.
    // remaining basis = 100200 − 50100 = 50100 over qty 5.
    // value = 5 × 140 = 70000 → unrealized = 70000 − 50100 = 19900.
    await makeQuote(stock.id, '2026-06-01', '140', 'USD', 'yahoo')

    const pnl = await computePnl(u.id, { from: '2026-03-01', to: '2026-05-01', atDate: AT })

    expect(pnl.realizedTradingBaseMinor).toBe(14600)
    expect(pnl.unrealizedBaseMinor).toBe(19900)
    // fees in period: only the sell fee 300 (buy is outside [from,to]).
    expect(pnl.feesBaseMinor).toBe(300)
    // total excludes fees.
    expect(pnl.totalBaseMinor).toBe(14600 + 0 + 19900)
    // And explicitly: fees not folded into total.
    expect(pnl.totalBaseMinor).not.toBe(14600 + 19900 - 300)
  })
})

describe('pnl — valuationIncomplete on missing FX', () => {
  it('flags valuationIncomplete when an unrealized leg has no FX rate', async () => {
    const u = await makeUser()
    const acc = await makeAccount(u.id)
    // EUR stock, priced, but NO EUR→USD rate exists → unrealized cannot convert.
    const stock = await makeStock(u.id, { symbol: 'SAP.DE', currency: 'EUR' })

    await makeTx({
      userId: u.id, accountId: acc.id, assetId: stock.id, type: 'buy',
      executedAt: '2026-01-10T10:00:00Z', quantity: '5', price: '100',
      amountMinor: 50000, currency: 'EUR',
    })
    await makeQuote(stock.id, '2026-06-01', '120', 'EUR', 'yahoo')

    const pnl = await computePnl(u.id, { from: '2026-01-01', to: '2026-06-12', atDate: AT })
    expect(pnl.valuationIncomplete).toBe(true)
  })
})
