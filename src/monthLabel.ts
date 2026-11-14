/**
 * A "YYYY-MM" month as the top bar shows it: "November 2026", "tháng 11 năm 2026", "2026年11月".
 * Noon avoids a time-zone shift onto the previous day, and so the previous month.
 */
export function formatMonthLabel(month: string, localeCode: string): string {
  return new Intl.DateTimeFormat(localeCode, { year: 'numeric', month: 'long' }).format(new Date(`${month}-01T12:00:00`))
}

/**
 * A "YYYY-MM-DD" calendar date in the medium style of the app locale: "Jun 30, 2027", "30 thg 6, 2027", "2027/06/30".
 * The date is read and written in UTC, so no local time zone can move it to another day.
 */
export function formatDateLabel(date: string, localeCode: string): string {
  return new Intl.DateTimeFormat(localeCode, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
}
