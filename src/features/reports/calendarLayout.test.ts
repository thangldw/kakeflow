import { describe, expect, it } from 'vitest'

import { buildMonthCalendar, signedRate } from './calendarLayout'

describe('calendar layout', () => {
  it('builds a stable six-week Sunday-first grid', () => {
    const days = [{ date: '2026-07-01', expense: 1200 }, { date: '2026-07-31', expense: 500 }]
    const cells = buildMonthCalendar('2026-07', days)
    expect(cells).toHaveLength(42)
    expect(cells[3]).toMatchObject({ dayOfMonth: 1, data: days[0] })
    expect(cells[33]).toMatchObject({ dayOfMonth: 31, data: days[1] })
  })

  it('rejects invalid month and formats basis-point comparisons', () => {
    expect(() => buildMonthCalendar('2026-13', [])).toThrow()
    expect(signedRate(1250)).toBe('+12.5%')
    expect(signedRate(-325)).toBe('-3.3%')
    expect(signedRate(null)).toBe('—')
  })
})
