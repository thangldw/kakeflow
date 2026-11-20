import { describe, expect, it } from 'vitest'
import type { CategoryHistoryDto } from '../../platform/types'
import { historicalWhatIf } from './historicalWhatIf'

const history: CategoryHistoryDto = {
  months: ['2026-08', '2026-09', '2026-10', '2026-11'],
  categories: [
    { accountId: 'fun', name: '娯楽', monthlyJpy: [10_000, 20_000, 0, 30_000], totalJpy: 60_000 },
    { accountId: 'food', name: '食費', monthlyJpy: [1_001, 2_000, -500, 3_000], totalJpy: 5_501 },
  ],
}

describe('historicalWhatIf', () => {
  it('applies the percentage to each month of the chosen window and totals it', () => {
    const result = historicalWhatIf(history, { fun: 20 }, 4)
    expect(result.categories[0]).toMatchObject({ spentJpy: 60_000, savedJpy: 12_000, reductionPercent: 20 })
    expect(result.categories[1]).toMatchObject({ savedJpy: 0 })
    expect(result.totalSavedJpy).toBe(12_000)
    expect(result.averageSavedPerMonthJpy).toBe(3_000)
    expect(result.cumulativeSavedJpy).toEqual([2_000, 6_000, 6_000, 12_000])
  })

  it('uses only the most recent months of the window', () => {
    const result = historicalWhatIf(history, { fun: 50 }, 2)
    expect(result.months).toEqual(['2026-10', '2026-11'])
    expect(result.totalSavedJpy).toBe(15_000)
    expect(result.cumulativeSavedJpy).toEqual([0, 15_000])
  })

  it('floors to whole yen and treats a net-refund month as no spending', () => {
    const result = historicalWhatIf(history, { food: 10 }, 4)
    // 1001*10% = 100.1 -> 100, 2000 -> 200, -500 -> 0, 3000 -> 300
    expect(result.categories[1]).toMatchObject({ spentJpy: 6_001, savedJpy: 600 })
  })

  it('saves nothing when no reductions are chosen', () => {
    const result = historicalWhatIf(history, {}, 3)
    expect(result.totalSavedJpy).toBe(0)
    expect(result.cumulativeSavedJpy).toEqual([0, 0, 0])
  })

  it('rejects an invalid window or a non-whole / out-of-range percentage', () => {
    expect(() => historicalWhatIf(history, {}, 0)).toThrow(RangeError)
    expect(() => historicalWhatIf(history, {}, 5)).toThrow(RangeError)
    expect(() => historicalWhatIf(history, { fun: 101 }, 2)).toThrow(RangeError)
    expect(() => historicalWhatIf(history, { fun: 12.5 }, 2)).toThrow(RangeError)
    expect(() => historicalWhatIf(history, { fun: -1 }, 2)).toThrow(RangeError)
  })
})
