/**
 * decimal.test.ts — pure unit tests for the bigint fixed-point helpers
 * (@statok/shared, CRR-3 / ТЗ §7.0, §7.6). No DB, no float on the money path.
 *
 * Locks the half-up rounding contract at the numeric→minor boundary and the
 * overflow guards. Imports the real source directly (no build step).
 */

import { describe, expect, it } from 'bun:test'

import {
  divRoundHalfUp,
  mulToMinor,
  parseDec,
  PRICE_SCALE,
  proportionMinor,
  QTY_SCALE,
  RATE_SCALE,
} from '../src/decimal'

describe('canonical scales', () => {
  it('mirror the DB numeric column scales', () => {
    expect(QTY_SCALE).toBe(18)
    expect(PRICE_SCALE).toBe(8)
    expect(RATE_SCALE).toBe(8)
  })
})

describe('divRoundHalfUp', () => {
  it('rounds .5 ties away from zero (positive)', () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n) // 2.5 → 3
    expect(divRoundHalfUp(3n, 2n)).toBe(2n) // 1.5 → 2
    expect(divRoundHalfUp(7n, 2n)).toBe(4n) // 3.5 → 4
  })

  it('rounds .5 ties away from zero (negative)', () => {
    expect(divRoundHalfUp(-5n, 2n)).toBe(-3n) // -2.5 → -3
    expect(divRoundHalfUp(-3n, 2n)).toBe(-2n) // -1.5 → -2
    expect(divRoundHalfUp(5n, -2n)).toBe(-3n) // sign on denominator
  })

  it('rounds below .5 toward zero and at/above .5 away', () => {
    expect(divRoundHalfUp(1n, 3n)).toBe(0n) // 0.333 → 0
    expect(divRoundHalfUp(2n, 3n)).toBe(1n) // 0.666 → 1
    expect(divRoundHalfUp(-2n, 3n)).toBe(-1n)
  })

  it('is exact when evenly divisible', () => {
    expect(divRoundHalfUp(4n, 2n)).toBe(2n)
    expect(divRoundHalfUp(0n, 5n)).toBe(0n)
    expect(divRoundHalfUp(-10n, 5n)).toBe(-2n)
  })

  it('throws on division by zero', () => {
    expect(() => divRoundHalfUp(5n, 0n)).toThrow(RangeError)
    expect(() => divRoundHalfUp(0n, 0n)).toThrow()
  })
})

describe('parseDec', () => {
  it('scales an exact decimal to the requested fixed-point', () => {
    expect(parseDec('1.5', 18)).toBe(1_500_000_000_000_000_000n)
    expect(parseDec('0', 8)).toBe(0n)
    expect(parseDec('12', 2)).toBe(1200n)
  })

  it('rounds half-up when more fractional digits than scale', () => {
    expect(parseDec('0.005', 2)).toBe(1n) // .5 in the third place → up
    expect(parseDec('0.004', 2)).toBe(0n) // below .5 → down
    expect(parseDec('1.235', 2)).toBe(124n) // ...5 tie → up
    expect(parseDec('1.234', 2)).toBe(123n)
  })

  it('handles negatives with the same half-up magnitude', () => {
    expect(parseDec('-0.005', 2)).toBe(-1n)
    expect(parseDec('-1.5', 18)).toBe(-1_500_000_000_000_000_000n)
    expect(parseDec('-1.234', 2)).toBe(-123n)
  })

  it('accepts a leading + sign and trims whitespace', () => {
    expect(parseDec('+2.5', 2)).toBe(250n)
    expect(parseDec('  3.25  ', 2)).toBe(325n)
  })

  it('throws on non-numeric garbage', () => {
    expect(() => parseDec('abc', 2)).toThrow(TypeError)
    expect(() => parseDec('1.2.3', 2)).toThrow(TypeError)
    expect(() => parseDec('1,5', 2)).toThrow(TypeError) // comma not accepted here
    expect(() => parseDec('', 2)).toThrow(TypeError)
  })

  it('throws on an invalid scale', () => {
    expect(() => parseDec('1', -1)).toThrow(RangeError)
    expect(() => parseDec('1', 1.5)).toThrow(RangeError)
  })
})

describe('mulToMinor', () => {
  it('multiplies qty × price down to minor units', () => {
    expect(mulToMinor('10', '99.5', 'USD')).toBe(99500) // 995.00
    expect(mulToMinor('1', '1', 'USD')).toBe(100)
    expect(mulToMinor('0', '123.45', 'USD')).toBe(0)
  })

  it('rounds half-up at the numeric→minor boundary', () => {
    // 3 × 0.335 = 1.005 → 101 (half-up on the third decimal)
    expect(mulToMinor('3', '0.335', 'USD')).toBe(101)
    // 1 × 0.014 = 0.014 → 1 (below .5 stays, .4 rounds to nearest cent = 1)
    expect(mulToMinor('1', '0.015', 'USD')).toBe(2) // 0.015 → 0.02
    expect(mulToMinor('1', '0.014', 'USD')).toBe(1) // 0.014 → 0.01
  })

  it('keeps high-precision quantities exact via bigint', () => {
    // qty with 18 fractional digits, price scale 8 — no float drift.
    expect(mulToMinor('2.5', '4', 'USD')).toBe(1000) // 10.00
  })

  it('throws when the result exceeds the JS safe integer range', () => {
    expect(() => mulToMinor('100000000000000', '100000000', 'USD')).toThrow(RangeError)
  })
})

describe('proportionMinor', () => {
  it('splits a total proportionally with half-up rounding', () => {
    expect(proportionMinor(100, '1', '3')).toBe(33) // 33.33 → 33
    expect(proportionMinor(100, '2', '3')).toBe(67) // 66.66 → 67
    expect(proportionMinor(5, '1', '2')).toBe(3) // 2.5 → 3 (away from zero)
  })

  it('handles unequal shares and a whole that exceeds the part', () => {
    expect(proportionMinor(1000, '7', '13')).toBe(538) // 538.46 → 538
    expect(proportionMinor(1000, '13', '13')).toBe(1000) // full part = whole
  })

  it('handles negative totals symmetrically', () => {
    expect(proportionMinor(-100, '1', '3')).toBe(-33)
    expect(proportionMinor(-5, '1', '2')).toBe(-3)
  })

  it('throws when whole is zero', () => {
    expect(() => proportionMinor(100, '1', '0')).toThrow(RangeError)
    expect(() => proportionMinor(100, '5', '0.0')).toThrow(RangeError)
  })

  it('throws on an unsafe total minor amount', () => {
    expect(() => proportionMinor(Number.MAX_SAFE_INTEGER + 10, '1', '2')).toThrow(RangeError)
    expect(() => proportionMinor(1.5, '1', '2')).toThrow(RangeError)
  })
})
