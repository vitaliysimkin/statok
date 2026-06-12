/**
 * money.test.ts — pure unit tests for the money helpers (@statok/shared, CRR-3 /
 * ТЗ §7.0, §7.3, §7.6). No DB. Locks the minor-unit conversions, half-up rounding
 * and the Intl-based formatting contract.
 *
 * Note on formatMoney: Intl.NumberFormat emits non-breaking / narrow spaces as
 * grouping separators (uk uses U+00A0). Assertions normalize whitespace and check
 * symbol + digits rather than exact byte sequences.
 */

import { describe, expect, it } from 'bun:test'

import {
  DEFAULT_MINOR_DIGITS,
  displayToMinor,
  formatMoney,
  minorDigitsOf,
  minorToDisplay,
  roundHalfUp,
} from '../src/money'

/** Collapse every kind of unicode space (incl. NBSP U+00A0, NNBSP U+202F) to nothing. */
function stripSpaces(s: string): string {
  return s.replace(/[\s  ]/g, '')
}

describe('minorDigitsOf', () => {
  it('returns 2 for the v1 currencies and the default', () => {
    expect(minorDigitsOf('USD')).toBe(2)
    expect(minorDigitsOf('UAH')).toBe(2)
    expect(minorDigitsOf('EUR')).toBe(2)
    expect(minorDigitsOf('GBP')).toBe(DEFAULT_MINOR_DIGITS)
  })

  it('normalizes case and rejects invalid ISO codes', () => {
    expect(minorDigitsOf('usd')).toBe(2)
    expect(() => minorDigitsOf('US')).toThrow(TypeError)
    expect(() => minorDigitsOf('US1')).toThrow(TypeError)
    expect(() => minorDigitsOf('')).toThrow(TypeError)
  })
})

describe('roundHalfUp', () => {
  it('rounds .5 ties away from zero', () => {
    expect(roundHalfUp(2.5)).toBe(3)
    expect(roundHalfUp(-2.5)).toBe(-3)
    expect(roundHalfUp(0.5)).toBe(1)
    expect(roundHalfUp(1.5)).toBe(2)
  })

  it('rounds toward nearest below/above the half', () => {
    expect(roundHalfUp(2.4)).toBe(2)
    expect(roundHalfUp(-2.4)).toBe(-2)
    expect(roundHalfUp(2.6)).toBe(3)
    expect(roundHalfUp(0)).toBe(0)
  })

  it('throws on non-finite input', () => {
    expect(() => roundHalfUp(Infinity)).toThrow(RangeError)
    expect(() => roundHalfUp(-Infinity)).toThrow(RangeError)
    expect(() => roundHalfUp(NaN)).toThrow(RangeError)
  })
})

describe('minorToDisplay', () => {
  it('formats positive amounts with the currency minor digits', () => {
    expect(minorToDisplay(123456, 'USD')).toBe('1234.56')
    expect(minorToDisplay(5, 'USD')).toBe('0.05')
    expect(minorToDisplay(100, 'USD')).toBe('1.00')
  })

  it('handles zero and negatives', () => {
    expect(minorToDisplay(0, 'USD')).toBe('0.00')
    expect(minorToDisplay(-5, 'USD')).toBe('-0.05')
    expect(minorToDisplay(-123456, 'USD')).toBe('-1234.56')
  })

  it('handles large amounts without float drift', () => {
    expect(minorToDisplay(900_719_925_474, 'USD')).toBe('9007199254.74')
  })

  it('throws on a non-integer minor amount', () => {
    expect(() => minorToDisplay(1.5, 'USD')).toThrow(TypeError)
  })
})

describe('displayToMinor', () => {
  it('parses a major-unit string to integer minor units', () => {
    expect(displayToMinor('1234.56', 'USD')).toBe(123456)
    expect(displayToMinor('0', 'USD')).toBe(0)
    expect(displayToMinor('1', 'USD')).toBe(100)
  })

  it('rounds half-up beyond the currency minor digits', () => {
    expect(displayToMinor('0.005', 'USD')).toBe(1) // .5 → up
    expect(displayToMinor('0.004', 'USD')).toBe(0) // below .5 → down
    expect(displayToMinor('1.235', 'USD')).toBe(124)
  })

  it('handles negatives and a + sign', () => {
    expect(displayToMinor('-1234.56', 'USD')).toBe(-123456)
    expect(displayToMinor('-0.005', 'USD')).toBe(-1)
    expect(displayToMinor('+12.50', 'USD')).toBe(1250)
  })

  it('accepts comma as the decimal separator', () => {
    expect(displayToMinor('1234,56', 'USD')).toBe(123456)
    expect(displayToMinor('0,5', 'USD')).toBe(50)
  })

  it('throws on invalid input', () => {
    expect(() => displayToMinor('xx', 'USD')).toThrow(TypeError)
    expect(() => displayToMinor('1 234.56', 'USD')).toThrow(TypeError) // grouping not allowed
    expect(() => displayToMinor('', 'USD')).toThrow(TypeError)
  })

  it('throws when the parsed amount exceeds the safe integer range', () => {
    expect(() => displayToMinor('100000000000000000', 'USD')).toThrow(RangeError)
  })

  it('round-trips with minorToDisplay', () => {
    for (const minor of [0, 1, 99, 100, 123456, -5, -123456]) {
      expect(displayToMinor(minorToDisplay(minor, 'USD'), 'USD')).toBe(minor)
    }
  })
})

describe('formatMoney', () => {
  it('formats USD in en locale with $ and grouping', () => {
    expect(formatMoney(123456, 'USD', 'en')).toBe('$1,234.56')
  })

  it('keeps two fraction digits and groups thousands (uk locale)', () => {
    const ukUsd = formatMoney(123456, 'USD', 'uk')
    // uk uses NBSP grouping and a decimal comma; normalize spaces before matching.
    expect(stripSpaces(ukUsd)).toContain('1234,56')
    expect(ukUsd).toContain('USD')
  })

  it('renders the hryvnia symbol for UAH in uk locale', () => {
    const ukUah = formatMoney(123456, 'UAH', 'uk')
    expect(stripSpaces(ukUah)).toContain('1234,56')
    expect(ukUah).toContain('₴') // ₴
  })

  it('base currency is locale-independent (USD stays USD in uk)', () => {
    // The amount content is the same regardless of locale, only the presentation differs.
    expect(stripSpaces(formatMoney(123456, 'USD', 'uk'))).toContain('1234,56')
    expect(stripSpaces(formatMoney(123456, 'USD', 'en'))).toContain('1,234.56')
  })

  it('formats zero and negative amounts', () => {
    expect(formatMoney(0, 'USD', 'en')).toBe('$0.00')
    expect(formatMoney(-123456, 'USD', 'en')).toBe('-$1,234.56')
  })

  it('throws on a non-integer minor amount', () => {
    expect(() => formatMoney(1.5, 'USD', 'en')).toThrow(TypeError)
  })
})
