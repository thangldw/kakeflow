import { describe, expect, it } from 'vitest'
import { estimateMedicalCap } from './medicalCap'

describe('estimateMedicalCap', () => {
  it('uses the flat cap for the lower brackets', () => {
    expect(estimateMedicalCap('LOW', 100_000, false)).toEqual({ totalCostJpy: 333_333, capJpy: 57_600, refundJpy: 42_400 })
    expect(estimateMedicalCap('EXEMPT', 30_000, false)?.refundJpy).toBe(0)
  })
  it('adds 1% of the excess for the middle and upper brackets', () => {
    // total ¥1,000,000: 80,100 + (1,000,000 − 267,000) × 1% = 87,430
    expect(estimateMedicalCap('MIDDLE', 300_000, false)).toEqual({ totalCostJpy: 1_000_000, capJpy: 87_430, refundJpy: 212_570 })
    expect(estimateMedicalCap('HIGH', 300_000, false)?.capJpy).toBe(167_400 + 4_420)
    expect(estimateMedicalCap('TOP', 30_000, false)?.capJpy).toBe(252_600)
  })
  it('uses the lower cap from the fourth month in a year', () => {
    expect(estimateMedicalCap('MIDDLE', 300_000, true)?.capJpy).toBe(44_400)
  })
  it('rejects unusable amounts', () => {
    expect(estimateMedicalCap('MIDDLE', -1, false)).toBeNull()
    expect(estimateMedicalCap('MIDDLE', Number.NaN, false)).toBeNull()
  })
})
