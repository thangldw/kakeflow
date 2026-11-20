import { describe, expect, it } from 'vitest'
import { estimateFurusatoLimit, incomeTaxRate } from './furusatoLimit'

describe('incomeTaxRate', () => {
  it('follows the national brackets at their edges', () => {
    expect([0, 1_950_000, 1_950_001, 3_300_000, 3_300_001, 6_950_000, 6_950_001, 9_000_000, 9_000_001, 18_000_000, 18_000_001, 40_000_000, 40_000_001].map(incomeTaxRate))
      .toEqual([0.05, 0.05, 0.10, 0.10, 0.20, 0.20, 0.23, 0.23, 0.33, 0.33, 0.40, 0.40, 0.45])
  })
})

describe('estimateFurusatoLimit', () => {
  it('applies the published approximation', () => {
    // taxable ¥3,000,000 -> 10%; resident portion ¥200,000 -> 200000*0.2/(0.9-0.1021)+2000 = 52,137...
    const estimate = estimateFurusatoLimit(3_000_000, 200_000, null)
    expect(estimate?.rate).toBe(0.10)
    expect(estimate?.limitJpy).toBe(Math.floor(40_000 / 0.7979 + 2000))
    expect(estimate?.remainingJpy).toBeNull()
  })

  it('subtracts what was already donated and never goes below zero', () => {
    const base = estimateFurusatoLimit(3_000_000, 200_000, null)!.limitJpy
    expect(estimateFurusatoLimit(3_000_000, 200_000, 20_000)?.remainingJpy).toBe(base - 20_000)
    expect(estimateFurusatoLimit(3_000_000, 200_000, base + 5_000)?.remainingJpy).toBe(0)
  })

  it('rejects unusable inputs', () => {
    expect(estimateFurusatoLimit(-1, 200_000, null)).toBeNull()
    expect(estimateFurusatoLimit(3_000_000, 0, null)).toBeNull()
    expect(estimateFurusatoLimit(Number.NaN, 200_000, null)).toBeNull()
    expect(estimateFurusatoLimit(3_000_000, 200_000, -5)).toBeNull()
  })
})
