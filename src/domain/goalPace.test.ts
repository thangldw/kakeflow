import { describe, expect, it } from 'vitest'
import { goalPace } from './goalPace'

describe('goalPace', () => {
  const now = new Date(2026, 10, 14, 12)

  it('spreads the remaining amount over the months left until the target date', () => {
    expect(goalPace({ targetJpy: 600_000, savedJpy: 342_000, targetDate: '2027-02-12' }, now)).toEqual({ remaining: 258_000, months: 3, monthly: 86_000, overdue: false })
  })

  it('needs nothing more once the goal is reached', () => {
    const pace = goalPace({ targetJpy: 600_000, savedJpy: 650_000, targetDate: '2027-02-12' }, now)
    expect(pace.remaining).toBe(0)
    expect(pace.monthly).toBe(0)
    expect(pace.overdue).toBe(false)
  })

  it('flags a goal that is short past its target date', () => {
    const pace = goalPace({ targetJpy: 600_000, savedJpy: 342_000, targetDate: '2026-10-01' }, now)
    expect(pace.overdue).toBe(true)
    expect(pace.months).toBe(1)
  })
})
