/**
 * bond.test.ts — pure unit tests for the bond domain logic (arch §3.3, FR-23..27).
 *
 * Covers the deterministic, money-exact pieces: couponSchedule, the per-period
 * coupon amount (verified through schedule rows — couponAmountMinor is private),
 * currentYield and ytm. No live DB: the db module only needs DATABASE_URL present
 * at import time (the postgres connection is lazy and never opened here), so we
 * seed it from the dev value before dynamically importing the service.
 *
 * Tolerances follow the spec: yields are float display metrics, so par bonds are
 * asserted to the coupon rate within ±0.01 and discount/premium relationally.
 */

import { describe, expect, it } from 'bun:test'

// db/index.ts throws if DATABASE_URL is unset; the connection itself stays lazy.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5434/statok'

const { couponSchedule, currentYield, ytm } = await import('../src/services/bond.ts')
import type { BondInput, ScheduleRow } from '../src/services/bond.ts'

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

function bond(overrides: Partial<BondInput> = {}): BondInput {
  return {
    faceValueMinor: 100_000, // 1000.00
    couponRatePercent: '15.7500',
    couponFrequency: 2,
    issueDate: '2024-01-15',
    maturityDate: '2026-01-15',
    ...overrides,
  }
}

const couponRows = (rows: ScheduleRow[]): ScheduleRow[] => rows.filter((r) => r.kind === 'coupon')
const lastRow = (rows: ScheduleRow[]): ScheduleRow => rows[rows.length - 1]!

// ---------------------------------------------------------------------------
// couponSchedule
// ---------------------------------------------------------------------------

describe('couponSchedule', () => {
  it('builds frequency-2 schedule backwards from maturity with a final redemption', () => {
    const rows = couponSchedule(bond(), { today: '2025-06-12' })
    const last = lastRow(rows)
    expect(last.kind).toBe('redemption')
    expect(last.date).toBe('2026-01-15')
    expect(last.amountMinor).toBe(100_000) // = faceValueMinor
    // Semi-annual coupons on the 15th of Jan/Jul between issue and maturity.
    expect(couponRows(rows).map((r) => r.date)).toEqual([
      '2024-01-15',
      '2024-07-15',
      '2025-01-15',
      '2025-07-15',
    ])
  })

  it('supports frequencies 1, 4 and 12', () => {
    const annual = couponSchedule(
      bond({ couponFrequency: 1, couponRatePercent: '10.0000', issueDate: '2024-01-15' }),
      { today: '2025-06-12' },
    )
    expect(couponRows(annual).map((r) => r.date)).toEqual(['2024-01-15', '2025-01-15'])

    const quarterly = couponSchedule(
      bond({ couponFrequency: 4, couponRatePercent: '8.0000', issueDate: '2025-01-15' }),
      { today: '2025-06-01' },
    )
    expect(couponRows(quarterly).map((r) => r.date)).toEqual([
      '2025-01-15',
      '2025-04-15',
      '2025-07-15',
      '2025-10-15',
    ])

    const monthly = couponSchedule(
      bond({ couponFrequency: 12, couponRatePercent: '12.0000', issueDate: '2025-07-15' }),
      { today: '2025-06-01' },
    )
    // 6 monthly coupons from 2025-07-15 .. 2025-12-15 (the 2026-01-15 coupon folds into redemption).
    expect(couponRows(monthly).map((r) => r.date)).toEqual([
      '2025-07-15',
      '2025-08-15',
      '2025-09-15',
      '2025-10-15',
      '2025-11-15',
      '2025-12-15',
    ])
  })

  it('zero-coupon → only the redemption row', () => {
    const rows = couponSchedule(
      bond({ couponFrequency: 0, couponRatePercent: '0', issueDate: null, maturityDate: '2030-01-15' }),
      { today: '2025-01-01' },
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ date: '2030-01-15', amountMinor: 100_000, kind: 'redemption' })
  })

  it('trims the left bound at issueDate', () => {
    const rows = couponSchedule(
      bond({ couponFrequency: 1, couponRatePercent: '10.0000', issueDate: '2025-01-15', maturityDate: '2027-01-15' }),
      { today: '2025-06-01' },
    )
    // No coupon before the issue date.
    expect(rows.every((r) => r.date >= '2025-01-15')).toBe(true)
    expect(couponRows(rows).map((r) => r.date)).toEqual(['2025-01-15', '2026-01-15'])
  })

  it('uses earliestTxDate as the bound when issueDate is null', () => {
    const rows = couponSchedule(
      bond({ couponFrequency: 1, couponRatePercent: '10.0000', issueDate: null, maturityDate: '2030-01-15' }),
      { today: '2025-06-01', earliestTxDate: '2028-01-15' },
    )
    expect(couponRows(rows).map((r) => r.date)).toEqual(['2028-01-15', '2029-01-15'])
  })

  it('applies the 50-year cap when neither issueDate nor earliestTxDate is given', () => {
    const rows = couponSchedule(
      bond({ couponFrequency: 1, couponRatePercent: '10.0000', issueDate: null, maturityDate: '2080-01-15' }),
      { today: '2025-01-01' },
    )
    // 50 yearly coupons (2030..2079) + 1 redemption (2080). First coupon = maturity − 50y.
    expect(rows).toHaveLength(51)
    expect(rows[0]!.date).toBe('2030-01-15')
    expect(lastRow(rows).date).toBe('2080-01-15')
  })

  it('clamps month-end days when stepping over short months (31st)', () => {
    const rows = couponSchedule(
      bond({ couponFrequency: 2, couponRatePercent: '10.0000', issueDate: '2025-01-31', maturityDate: '2026-01-31' }),
      { today: '2025-06-01' },
    )
    expect(couponRows(rows).map((r) => r.date)).toEqual(['2025-01-31', '2025-07-31'])
    expect(lastRow(rows).date).toBe('2026-01-31')
  })

  it('flags isFuture relative to today (Kyiv)', () => {
    const rows = couponSchedule(
      bond({ couponFrequency: 1, couponRatePercent: '10.0000', issueDate: '2024-01-15', maturityDate: '2027-01-15' }),
      { today: '2025-06-01' },
    )
    const byDate = Object.fromEntries(rows.map((r) => [r.date, r.isFuture]))
    expect(byDate['2024-01-15']).toBe(false)
    expect(byDate['2025-01-15']).toBe(false)
    expect(byDate['2026-01-15']).toBe(true)
    expect(byDate['2027-01-15']).toBe(true) // redemption in the future
  })

  it('throws on a malformed maturity date', () => {
    expect(() => couponSchedule(bond({ maturityDate: 'not-a-date' }), { today: '2025-01-01' })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// couponAmountMinor (verified through schedule coupon rows — function is private)
// ---------------------------------------------------------------------------

describe('couponAmountMinor (via couponSchedule rows)', () => {
  it('100000 face / 15.75% / freq 2 → 7875 per coupon', () => {
    const rows = couponSchedule(bond({ couponFrequency: 2, couponRatePercent: '15.7500' }), {
      today: '2025-06-12',
    })
    for (const r of couponRows(rows)) expect(r.amountMinor).toBe(7875)
  })

  it('100000 face / 15.75% / freq 1 → 15750 per coupon', () => {
    const rows = couponSchedule(
      bond({ couponFrequency: 1, couponRatePercent: '15.7500', issueDate: '2025-01-15', maturityDate: '2026-01-15' }),
      { today: '2025-06-12' },
    )
    expect(couponRows(rows).map((r) => r.amountMinor)).toEqual([15_750])
  })

  it('rounds half-up: 60 face / 10% / freq 12 → 1', () => {
    // 60 × 10 / 100 / 12 = 0.5 → 1 (half-up at the numeric→minor boundary).
    const rows = couponSchedule(
      bond({ faceValueMinor: 60, couponFrequency: 12, couponRatePercent: '10.0000', issueDate: '2025-07-15', maturityDate: '2026-01-15' }),
      { today: '2025-06-01' },
    )
    for (const r of couponRows(rows)) expect(r.amountMinor).toBe(1)
  })

  it('freq 4 at 8% on 100000 face → 2000 per coupon', () => {
    const rows = couponSchedule(
      bond({ couponFrequency: 4, couponRatePercent: '8.0000', issueDate: '2025-01-15', maturityDate: '2026-01-15' }),
      { today: '2025-06-01' },
    )
    for (const r of couponRows(rows)) expect(r.amountMinor).toBe(2000)
  })
})

// ---------------------------------------------------------------------------
// currentYield
// ---------------------------------------------------------------------------

describe('currentYield', () => {
  it('matches the spec example (§3.3): 1000 face, 15.75%, clean 950 → ≈16.58%', () => {
    const cy = currentYield(bond({ couponRatePercent: '15.7500', couponFrequency: 2 }), 95_000)
    // Returns a fraction (annual coupon / clean price).
    expect(cy * 100).toBeCloseTo(16.58, 1)
    expect(cy).toBeCloseTo(0.165789, 5)
  })

  it('uses the annual coupon regardless of payment frequency', () => {
    const semi = currentYield(bond({ couponRatePercent: '10.0000', couponFrequency: 2 }), 100_000)
    const annual = currentYield(bond({ couponRatePercent: '10.0000', couponFrequency: 1 }), 100_000)
    expect(semi).toBeCloseTo(annual, 10)
    expect(semi).toBeCloseTo(0.1, 10) // 10000 / 100000
  })

  it('zero-coupon → 0', () => {
    expect(currentYield(bond({ couponFrequency: 0, couponRatePercent: '0' }), 95_000)).toBe(0)
  })

  it('non-positive clean price → 0 (guard)', () => {
    expect(currentYield(bond(), 0)).toBe(0)
    expect(currentYield(bond(), -5)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// ytm
// ---------------------------------------------------------------------------

describe('ytm', () => {
  const tenYr = (over: Partial<BondInput> = {}): BondInput =>
    bond({ couponRatePercent: '10.0000', couponFrequency: 2, issueDate: '2020-01-15', maturityDate: '2030-01-15', ...over })

  it('par bond → YTM ≈ coupon rate (±0.01)', () => {
    const y = ytm(tenYr(), 100_000, '2025-01-15')
    expect(y).toBeCloseTo(10, 1)
    expect(Math.abs(y - 10)).toBeLessThan(0.01)
  })

  it('discount bond → YTM above the coupon rate', () => {
    const y = ytm(tenYr(), 90_000, '2025-01-15')
    expect(y).toBeGreaterThan(10)
  })

  it('premium bond → YTM below the coupon rate', () => {
    const y = ytm(tenYr(), 110_000, '2025-01-15')
    expect(y).toBeLessThan(10)
    expect(y).toBeGreaterThan(0)
  })

  it('zero-coupon → positive YTM from pure discount to par', () => {
    const y = ytm(
      bond({ couponFrequency: 0, couponRatePercent: '0', issueDate: null, maturityDate: '2030-01-15' }),
      60_000,
      '2025-01-15',
    )
    expect(y).toBeGreaterThan(0)
    // 100000 / 60000 over ~5y ≈ 10.7% annual.
    expect(y).toBeCloseTo(10.75, 0)
  })

  it('non-positive price or no future flows → 0', () => {
    expect(ytm(tenYr(), 0, '2025-01-15')).toBe(0)
    // Settlement at/after maturity → no future cash flows.
    expect(ytm(tenYr(), 100_000, '2030-01-15')).toBe(0)
  })

  it('regression (wave 1): the maturity flow is coupon + face, not face alone', () => {
    // Single remaining flow exactly one year before maturity, priced at par.
    // P = (C + F) / (1 + y) → 100000 = 110000 / (1 + y) → y = 10%.
    // The pre-fix bug discounted only F at maturity, which would yield ≈ 0%.
    const b = bond({ couponFrequency: 1, couponRatePercent: '10.0000', issueDate: '2025-01-15', maturityDate: '2026-01-15' })
    expect(ytm(b, 100_000, '2025-01-15')).toBeCloseTo(10, 5)
    // And at a discount: 95000 = 110000 / (1 + y) → y ≈ 15.79%.
    expect(ytm(b, 95_000, '2025-01-15')).toBeCloseTo(15.79, 1)
  })

  it('semi-annual par bond converges to the coupon rate', () => {
    const y = ytm(
      bond({ couponFrequency: 2, couponRatePercent: '8.0000', issueDate: '2020-01-15', maturityDate: '2035-01-15' }),
      100_000,
      '2025-01-15',
    )
    expect(y).toBeCloseTo(8, 1)
    expect(Math.abs(y - 8)).toBeLessThan(0.01)
  })
})
