/**
 * fx.test.ts — integration tests for the fx `convert` service (arch §3.4, FR-33).
 *
 * Runs against statok_test (Postgres 5434). Tests ONLY the service-level `convert`
 * (identity / direct / inverse / USD-pivot / last-previous fallback / not-found /
 * manual-vs-sync parity).
 *
 * Expected values for inverse and pivot are computed BY HAND (bigint fixed-point,
 * single final half-up) and hardcoded below — see the per-test comments.
 *
 * A final `describe` block re-runs EVERY case through the in-memory resolver
 * (`createFxResolver` from the same fixture rows AND `loadFxResolver` after the
 * same seed) and asserts the resolver's `{amountMinor, rateUsed, rateDate}` is
 * byte-for-byte identical to the service `convert` (NFR-03 — the resolver must
 * be a drop-in replacement, not an approximation).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test'

import {
  setupTestDatabase,
  truncateAll,
  dropTestDatabase,
  makeFxRate,
} from './helpers/testDb.ts'
import {
  convert,
  createFxResolver,
  loadFxResolver,
  FxRateNotFoundError,
  type ConvertResult,
  type FxRateRow,
} from '../src/services/fx.ts'

beforeAll(async () => {
  await setupTestDatabase()
})

afterAll(async () => {
  await dropTestDatabase()
})

beforeEach(async () => {
  await truncateAll()
})

describe('fx.convert — identity', () => {
  it('from === to returns the amount unchanged, no rate lookup', async () => {
    const res = await convert(12345, 'USD', 'USD', '2026-06-12')
    expect(res.amountMinor).toBe(12345)
    expect(res.rateUsed).toBe('1.00000000')
  })
})

describe('fx.convert — direct', () => {
  it('uses the direct (from,to) row', async () => {
    // 1 USD = 41.00 UAH.
    await makeFxRate('2026-06-01', 'USD', 'UAH', '41.00000000', 'nbu')
    // 10000 USD minor (100.00 USD) → 41 × 100 = 4100.00 UAH = 410000 minor.
    const res = await convert(10000, 'USD', 'UAH', '2026-06-12')
    expect(res.amountMinor).toBe(410000)
    expect(res.rateUsed).toBe('41.00000000')
    expect(res.rateDate).toBe('2026-06-01')
  })
})

describe('fx.convert — inverse (1/rate, exact)', () => {
  it('inverts a stored (to,from) row', async () => {
    // Only EUR→USD = 1.25 stored; ask USD→EUR (inverse).
    await makeFxRate('2026-06-01', 'EUR', 'USD', '1.25000000', 'frankfurter')
    // inverse rate = 1/1.25 = 0.8 exactly at scale 8.
    // 10000 USD minor (100.00 USD) → 100 / 1.25 = 80.00 EUR = 8000 minor.
    const res = await convert(10000, 'USD', 'EUR', '2026-06-12')
    expect(res.amountMinor).toBe(8000)
    expect(res.rateUsed).toBe('0.80000000')
  })
})

describe('fx.convert — USD pivot (single final rounding)', () => {
  it('pivots UAH→EUR through USD with one final round', async () => {
    // Stored: 1 USD = 41 UAH (nbu); 1 USD = 0.90 EUR (frankfurter).
    // No direct/inverse (UAH,EUR) → pivot UAH→USD (inverse of USD→UAH) × USD→EUR.
    //   UAH→USD num (scale8) = roundHalfUp(1e16 / 41e8) = 2439024.
    //   USD→EUR num (scale8) = 90000000.
    //   pivotNum (scale16) = 2439024 × 90000000 = 219512160000000.
    //   convert 410000 UAH minor (4100.00 UAH):
    //     roundHalfUp(410000 × 219512160000000 / 1e16) = 9000.
    //   Sanity: 4100 UAH / 41 = 100 USD × 0.90 = 90 EUR = 9000 minor. ✓
    await makeFxRate('2026-06-01', 'USD', 'UAH', '41.00000000', 'nbu')
    await makeFxRate('2026-06-01', 'USD', 'EUR', '0.90000000', 'frankfurter')

    const res = await convert(410000, 'UAH', 'EUR', '2026-06-12')
    expect(res.amountMinor).toBe(9000)
    // rateUsed = pivotNum folded to scale 8 = roundHalfUp(219512160000000 / 1e8) = 2195122 → 0.02195122.
    expect(res.rateUsed).toBe('0.02195122')
  })
})

describe('fx.convert — last-previous fallback', () => {
  it('uses the greatest rate_date ≤ requested date', async () => {
    await makeFxRate('2026-06-01', 'USD', 'UAH', '40.00000000', 'nbu')
    await makeFxRate('2026-06-10', 'USD', 'UAH', '42.00000000', 'nbu')
    // Ask for 2026-06-08 → newest ≤ date is 2026-06-01 (40.00), NOT 06-10.
    const res = await convert(10000, 'USD', 'UAH', '2026-06-08')
    expect(res.amountMinor).toBe(400000) // 100 × 40
    expect(res.rateUsed).toBe('40.00000000')
    expect(res.rateDate).toBe('2026-06-01')
  })

  it('ignores rows dated AFTER the requested date entirely', async () => {
    await makeFxRate('2026-06-20', 'USD', 'UAH', '42.00000000', 'nbu')
    // Only a future row exists relative to the query → not found.
    let thrown: unknown
    try {
      await convert(10000, 'USD', 'UAH', '2026-06-10')
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(FxRateNotFoundError)
  })
})

describe('fx.convert — FX_RATE_NOT_FOUND', () => {
  it('throws when no path (direct/inverse/pivot) exists', async () => {
    // Nothing stored at all.
    let thrown: unknown
    try {
      await convert(10000, 'GBP', 'JPY', '2026-06-12')
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(FxRateNotFoundError)
    expect((thrown as FxRateNotFoundError).code).toBe('FX_RATE_NOT_FOUND')
  })
})

describe('fx.convert — manual on equal footing with sync', () => {
  it('a manual row resolves exactly like a sync row', async () => {
    // Manual USD→UAH rate; must participate in resolution like nbu/frankfurter.
    await makeFxRate('2026-06-01', 'USD', 'UAH', '41.00000000', 'manual')
    const res = await convert(10000, 'USD', 'UAH', '2026-06-12')
    expect(res.amountMinor).toBe(410000)
    expect(res.rateUsed).toBe('41.00000000')
  })

  it('manual row with a later date wins the last-previous resolution', async () => {
    await makeFxRate('2026-06-01', 'USD', 'UAH', '40.00000000', 'nbu')
    await makeFxRate('2026-06-05', 'USD', 'UAH', '41.50000000', 'manual')
    const res = await convert(10000, 'USD', 'UAH', '2026-06-12')
    expect(res.rateDate).toBe('2026-06-05')
    expect(res.amountMinor).toBe(415000) // 100 × 41.50
  })
})

// ---------------------------------------------------------------------------
// Resolver ↔ service equivalence (NFR-03).
//
// The same fixtures and the same convert calls used above are replayed through
// the in-memory resolver and asserted IDENTICAL to the service `convert` —
// across all three of: service `convert`, `createFxResolver(fixtureRows)`, and
// `loadFxResolver()` (built from the freshly-seeded DB). A single source of
// truth (the `EQUIVALENCE_CASES` table) drives all three so the fixtures cannot
// drift between the service path and the resolver path.
// ---------------------------------------------------------------------------

/** A fixture fx_rates row + the source tag for {@link makeFxRate}. */
interface SeedRow extends FxRateRow {
  source: 'frankfurter' | 'nbu' | 'manual'
}

interface EquivalenceCase {
  name: string
  seed: SeedRow[]
  call: { amountMinor: number; from: string; to: string; date: string }
  /** True when both the service and the resolver must throw FX_RATE_NOT_FOUND. */
  notFound?: boolean
}

/**
 * Every scenario covered by the service-level tests above, expressed as data so
 * the identical seed feeds both the service `convert` and the resolver. The
 * stored semantics of a row are `1 baseCcy = rate quoteCcy` (matches makeFxRate).
 */
const EQUIVALENCE_CASES: EquivalenceCase[] = [
  {
    name: 'identity (no rate lookup)',
    seed: [],
    call: { amountMinor: 12345, from: 'USD', to: 'USD', date: '2026-06-12' },
  },
  {
    name: 'direct (from,to) row',
    seed: [{ rateDate: '2026-06-01', baseCcy: 'USD', quoteCcy: 'UAH', rate: '41.00000000', source: 'nbu' }],
    call: { amountMinor: 10000, from: 'USD', to: 'UAH', date: '2026-06-12' },
  },
  {
    name: 'inverse (1/rate, exact)',
    seed: [{ rateDate: '2026-06-01', baseCcy: 'EUR', quoteCcy: 'USD', rate: '1.25000000', source: 'frankfurter' }],
    call: { amountMinor: 10000, from: 'USD', to: 'EUR', date: '2026-06-12' },
  },
  {
    name: 'USD pivot (single final rounding)',
    seed: [
      { rateDate: '2026-06-01', baseCcy: 'USD', quoteCcy: 'UAH', rate: '41.00000000', source: 'nbu' },
      { rateDate: '2026-06-01', baseCcy: 'USD', quoteCcy: 'EUR', rate: '0.90000000', source: 'frankfurter' },
    ],
    call: { amountMinor: 410000, from: 'UAH', to: 'EUR', date: '2026-06-12' },
  },
  {
    name: 'pivot with split leg dates (rateDate = later leg)',
    // Discriminates the pivot as-of date: legs on different dates → MAX must win
    // in BOTH paths (a MIN would diverge). EUR→USD @06-11, USD→UAH @06-12.
    seed: [
      { rateDate: '2026-06-11', baseCcy: 'EUR', quoteCcy: 'USD', rate: '1.10000000', source: 'frankfurter' },
      { rateDate: '2026-06-12', baseCcy: 'USD', quoteCcy: 'UAH', rate: '41.00000000', source: 'nbu' },
    ],
    call: { amountMinor: 100000, from: 'EUR', to: 'UAH', date: '2026-06-13' },
  },
  {
    name: 'last-previous fallback (greatest rate_date ≤ date)',
    seed: [
      { rateDate: '2026-06-01', baseCcy: 'USD', quoteCcy: 'UAH', rate: '40.00000000', source: 'nbu' },
      { rateDate: '2026-06-10', baseCcy: 'USD', quoteCcy: 'UAH', rate: '42.00000000', source: 'nbu' },
    ],
    call: { amountMinor: 10000, from: 'USD', to: 'UAH', date: '2026-06-08' },
  },
  {
    name: 'manual row wins last-previous',
    seed: [
      { rateDate: '2026-06-01', baseCcy: 'USD', quoteCcy: 'UAH', rate: '40.00000000', source: 'nbu' },
      { rateDate: '2026-06-05', baseCcy: 'USD', quoteCcy: 'UAH', rate: '41.50000000', source: 'manual' },
    ],
    call: { amountMinor: 10000, from: 'USD', to: 'UAH', date: '2026-06-12' },
  },
  {
    name: 'future-only row → not found',
    seed: [{ rateDate: '2026-06-20', baseCcy: 'USD', quoteCcy: 'UAH', rate: '42.00000000', source: 'nbu' }],
    call: { amountMinor: 10000, from: 'USD', to: 'UAH', date: '2026-06-10' },
    notFound: true,
  },
  {
    name: 'no path at all → not found',
    seed: [],
    call: { amountMinor: 10000, from: 'GBP', to: 'JPY', date: '2026-06-12' },
    notFound: true,
  },
]

describe('fx resolver ↔ service convert — full equivalence (NFR-03)', () => {
  for (const tc of EQUIVALENCE_CASES) {
    it(`${tc.name}: createFxResolver and loadFxResolver match service convert`, async () => {
      for (const r of tc.seed) {
        await makeFxRate(r.rateDate, r.baseCcy, r.quoteCcy, r.rate, r.source)
      }

      // The fixture rows, as the resolver consumes them (FxRateRow shape only).
      const fixtureRows: FxRateRow[] = tc.seed.map((r) => ({
        rateDate: r.rateDate,
        baseCcy: r.baseCcy,
        quoteCcy: r.quoteCcy,
        rate: r.rate,
      }))
      const fromFixtures = createFxResolver(fixtureRows)
      const fromDb = await loadFxResolver()

      const { amountMinor, from, to, date } = tc.call

      if (tc.notFound) {
        // Manual try/catch (NOT `await expect(...).rejects` — that matcher
        // deadlocks here with the postgres driver; the service-level not-found
        // tests above use the same idiom). The service rejects asynchronously;
        // both resolvers throw synchronously. All three carry FX_RATE_NOT_FOUND.
        let svcThrown: unknown
        try {
          await convert(amountMinor, from as never, to as never, date)
        } catch (e) {
          svcThrown = e
        }
        expect(svcThrown).toBeInstanceOf(FxRateNotFoundError)
        expect(() => fromFixtures.convert(amountMinor, from as never, to as never, date)).toThrow(
          FxRateNotFoundError,
        )
        expect(() => fromDb.convert(amountMinor, from as never, to as never, date)).toThrow(
          FxRateNotFoundError,
        )
        return
      }

      const svc: ConvertResult = await convert(amountMinor, from as never, to as never, date)
      const res1 = fromFixtures.convert(amountMinor, from as never, to as never, date)
      const res2 = fromDb.convert(amountMinor, from as never, to as never, date)

      // Full result equivalence — every field, not just the number.
      expect(res1).toEqual(svc)
      expect(res2).toEqual(svc)
    })
  }
})
