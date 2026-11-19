import { describe, expect, it } from 'vitest'
import { annualMilestones, upcomingMilestones } from './annualMilestones'

describe('annualMilestones', () => {
  it('lists the year in date order with the statutory filing window', () => {
    const list = annualMilestones(2026)
    expect([...list].map((item) => item.date)).toEqual([...list].map((item) => item.date).sort())
    expect(list.find((item) => item.id === 'tax-return-start')?.date).toBe('2026-02-16')
    expect(list.find((item) => item.id === 'tax-return-deadline')?.date).toBe('2026-03-15')
    expect(list.find((item) => item.id === 'furusato-deadline')?.date).toBe('2026-12-31')
  })

  it('marks municipality- or employer-dependent dates as approximate', () => {
    expect(annualMilestones(2026).filter((item) => item.approximate).map((item) => item.id)).toEqual([
      'resident-tax-june', 'resident-tax-august', 'resident-tax-october', 'year-end-adjustment',
    ])
  })
})

describe('upcomingMilestones', () => {
  it('counts days to the next milestones, including today', () => {
    const next = upcomingMilestones('2026-03-15', 2)
    expect(next.map((item) => [item.id, item.daysUntil])).toEqual([['tax-return-deadline', 0], ['resident-tax-june', 107]])
  })

  it('rolls into next year after the last milestone', () => {
    const next = upcomingMilestones('2026-12-31', 2)
    expect(next.map((item) => item.date)).toEqual(['2026-12-31', '2027-02-16'])
  })
})
