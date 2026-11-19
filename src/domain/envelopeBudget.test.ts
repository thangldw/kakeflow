import { describe, expect, it } from 'vitest'
import { rollEnvelopes } from './envelopeBudget'

describe('envelope roll-forward', () => {
  it('carries positive balances forward and tracks the Ready-to-Assign pool', () => {
    const [july, august] = rollEnvelopes([
      { month: '2026-07', incomeJpy: 300_000, envelopes: [{ categoryId: 'food', assignedJpy: 60_000, activityJpy: 45_000 }, { categoryId: 'rent', assignedJpy: 100_000, activityJpy: 100_000 }] },
      { month: '2026-08', incomeJpy: 300_000, envelopes: [{ categoryId: 'food', assignedJpy: 60_000, activityJpy: 50_000 }, { categoryId: 'rent', assignedJpy: 100_000, activityJpy: 100_000 }] },
    ])
    expect(july.readyToAssignJpy).toBe(140_000)
    expect(july.envelopes.find((item) => item.categoryId === 'food')).toMatchObject({ carryInJpy: 0, availableJpy: 15_000 })
    expect(august.readyToAssignJpy).toBe(280_000)
    expect(august.envelopes.find((item) => item.categoryId === 'food')).toMatchObject({ carryInJpy: 15_000, availableJpy: 25_000 })
  })

  it('keeps overspending visible as a negative carry and flags it', () => {
    const [july, august] = rollEnvelopes([
      { month: '2026-07', incomeJpy: 100_000, envelopes: [{ categoryId: 'fun', assignedJpy: 10_000, activityJpy: 18_000 }] },
      { month: '2026-08', incomeJpy: 100_000, envelopes: [{ categoryId: 'fun', assignedJpy: 10_000, activityJpy: 0 }] },
    ])
    expect(july.overspentCategoryIds).toEqual(['fun'])
    expect(july.envelopes[0].availableJpy).toBe(-8_000)
    expect(august.envelopes[0]).toMatchObject({ carryInJpy: -8_000, availableJpy: 2_000 })
    expect(august.overspentCategoryIds).toEqual([])
  })

  it('shows an over-assigned pool as negative, treats refunds as inflow and keeps unlisted envelopes', () => {
    const [july, august] = rollEnvelopes([
      { month: '2026-07', incomeJpy: 50_000, envelopes: [{ categoryId: 'a', assignedJpy: 70_000, activityJpy: -5_000 }] },
      { month: '2026-08', incomeJpy: 0, envelopes: [] },
    ])
    expect(july.readyToAssignJpy).toBe(-20_000)
    expect(july.envelopes[0].availableJpy).toBe(75_000)
    expect(august.readyToAssignJpy).toBe(-20_000)
    expect(august.envelopes).toEqual([{ categoryId: 'a', carryInJpy: 75_000, assignedJpy: 0, activityJpy: 0, availableJpy: 75_000 }])
  })

  it('rejects out-of-order months, duplicates, fractional yen and malformed months', () => {
    const month = (name: string, extra = {}) => ({ month: name, incomeJpy: 0, envelopes: [], ...extra })
    expect(() => rollEnvelopes([month('2026-08'), month('2026-07')])).toThrow(/ascending/)
    expect(() => rollEnvelopes([month('2026-07'), month('2026-07')])).toThrow(/ascending/)
    expect(() => rollEnvelopes([month('2026-13')])).toThrow(/Invalid month/)
    expect(() => rollEnvelopes([month('2026-07', { incomeJpy: 1.5 })])).toThrow(RangeError)
    expect(() => rollEnvelopes([month('2026-07', { envelopes: [{ categoryId: 'a', assignedJpy: 1, activityJpy: 0 }, { categoryId: 'a', assignedJpy: 1, activityJpy: 0 }] })])).toThrow(/Duplicate/)
    expect(rollEnvelopes([])).toEqual([])
  })
})
