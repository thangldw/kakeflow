import { describe, expect, it } from 'vitest'
import { compareBalance, parseAmount } from './balanceDifference'

describe('compareBalance', () => {
  it('reports a match and the direction and size of a difference', () => {
    expect(compareBalance(100, 100)).toEqual({ kind: 'MATCH' })
    expect(compareBalance(150, 100)).toEqual({ kind: 'BANK_HIGHER', differenceJpy: 50 })
    expect(compareBalance(80, 100)).toEqual({ kind: 'BANK_LOWER', differenceJpy: 20 })
    expect(compareBalance(-5, 10)).toEqual({ kind: 'BANK_LOWER', differenceJpy: 15 })
  })
  it('rejects non-integers', () => {
    expect(compareBalance(1.5, 1)).toBeNull()
    expect(compareBalance(Number.NaN, 1)).toBeNull()
  })
})

describe('parseAmount', () => {
  it('accepts commas, yen signs and negatives, and rejects the rest', () => {
    expect(parseAmount('1,234,567')).toBe(1_234_567)
    expect(parseAmount('¥ 12，000')).toBe(12_000)
    expect(parseAmount('-500')).toBe(-500)
    for (const bad of ['', 'abc', '12.5', '1e3', '99999999999999999999']) expect(parseAmount(bad)).toBeNull()
  })
})
