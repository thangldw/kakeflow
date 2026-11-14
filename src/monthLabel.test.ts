import { describe, expect, it } from 'vitest'
import { formatDateLabel } from './monthLabel'

describe('formatDateLabel', () => {
  it('writes a YYYY-MM-DD date in the medium style of each app locale', () => {
    expect(formatDateLabel('2027-06-30', 'ja-JP')).toBe('2027/06/30')
    expect(formatDateLabel('2027-06-30', 'en-US')).toBe('Jun 30, 2027')
    expect(formatDateLabel('2027-06-30', 'vi-VN')).toBe('30 thg 6, 2027')
  })

  it('never shifts the day, whatever the local time zone', () => {
    expect(formatDateLabel('2027-01-01', 'en-US')).toBe('Jan 1, 2027')
    expect(formatDateLabel('2026-12-31', 'en-US')).toBe('Dec 31, 2026')
  })
})
