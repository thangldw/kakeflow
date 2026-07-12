export interface CalendarDayLike {
  readonly date: string
}

export interface CalendarCell<T extends CalendarDayLike> {
  readonly key: string
  readonly dayOfMonth: number | null
  readonly data: T | null
}

export function buildMonthCalendar<T extends CalendarDayLike>(month: string, days: readonly T[]): readonly CalendarCell<T>[] {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) throw new TypeError('month')
  const year = Number(match[1])
  const monthNumber = Number(match[2])
  if (monthNumber < 1 || monthNumber > 12) throw new TypeError('month')
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const leading = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay()
  const byDate = new Map(days.map((day) => [day.date, day]))
  const cells: CalendarCell<T>[] = []
  for (let index = 0; index < 42; index += 1) {
    const dayOfMonth = index >= leading && index < leading + count ? index - leading + 1 : null
    const date = dayOfMonth == null ? null : `${month}-${String(dayOfMonth).padStart(2, '0')}`
    cells.push({ key: date ?? `${month}-empty-${index}`, dayOfMonth, data: date ? byDate.get(date) ?? null : null })
  }
  return cells
}

export function signedRate(bps: number | null): string {
  if (bps == null) return '—'
  return `${bps > 0 ? '+' : ''}${(bps / 100).toFixed(1)}%`
}
