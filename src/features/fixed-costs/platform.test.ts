import { describe, expect, it, vi } from 'vitest'
import { parseFixedCostReview, queryFixedCostReview } from './platform'
import { fixedCostReviewFixture } from './testFixture'

describe('fixed cost review platform', () => {
  it('forwards household, account and attribution scopes and validates the response', async () => {
    const invoke = vi.fn().mockResolvedValue(fixedCostReviewFixture)
    const request = { householdId: 'family', accountGroupId: 'daily', attributionScope: { kind: 'MEMBER' as const, memberId: 'taro' }, asOf: '2026-07-13' }
    await expect(queryFixedCostReview(invoke, request)).resolves.toMatchObject({ totals: { annualizedJpy: 156000 } })
    expect(invoke).toHaveBeenCalledWith('fixed_cost_review_query', { request })
  })

  it('rejects incomplete windows, invalid enums and inconsistent comparison math', () => {
    expect(() => parseFixedCostReview({ ...fixedCostReviewFixture, monthlyPoints: fixedCostReviewFixture.monthlyPoints.slice(1) })).toThrow('monthlyPoints')
    expect(() => parseFixedCostReview({ ...fixedCostReviewFixture, segments: [{ ...fixedCostReviewFixture.segments[0], segment: 'CAR' }] })).toThrow('segment')
    expect(() => parseFixedCostReview({ ...fixedCostReviewFixture, totals: { ...fixedCostReviewFixture.totals, changeJpy: 1 } })).toThrow('comparison')
  })
})
