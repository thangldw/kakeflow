/**
 * A "YYYY-MM" month as the top bar shows it: "November 2026", "tháng 11 năm 2026", "2026年11月".
 * Noon avoids a time-zone shift onto the previous day, and so the previous month.
 */
export function formatMonthLabel(month: string, localeCode: string): string {
  return new Intl.DateTimeFormat(localeCode, { year: 'numeric', month: 'long' }).format(new Date(`${month}-01T12:00:00`))
}
