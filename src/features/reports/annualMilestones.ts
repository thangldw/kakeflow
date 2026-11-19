/**
 * Fixed yearly dates a Japanese household cares about (確定申告, ふるさと納税, 予定納税, 住民税 ...).
 * Dates that depend on the municipality, employer or filing type are marked `approximate` and shown as a guide only;
 * the national statutory dates below are the ones set by the tax authority.
 */

export interface AnnualMilestone {
  readonly id: string
  /** YYYY-MM-DD */
  readonly date: string
  /** Japanese label (also the i18n key). */
  readonly label: string
  readonly approximate: boolean
}

export interface UpcomingMilestone extends AnnualMilestone {
  readonly daysUntil: number
}

const pad = (value: number) => String(value).padStart(2, '0')
const iso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`

/** The milestones of one calendar year, in date order. */
export function annualMilestones(year: number): readonly AnnualMilestone[] {
  return [
    { id: 'tax-return-start', date: iso(year, 2, 16), label: '確定申告の受付開始', approximate: false },
    { id: 'tax-return-deadline', date: iso(year, 3, 15), label: '確定申告・所得税の納付期限', approximate: false },
    { id: 'resident-tax-june', date: iso(year, 6, 30), label: '住民税（第1期）の納付目安', approximate: true },
    { id: 'prepaid-tax-first', date: iso(year, 7, 31), label: '所得税の予定納税（第1期）', approximate: false },
    { id: 'resident-tax-august', date: iso(year, 8, 31), label: '住民税（第2期）の納付目安', approximate: true },
    { id: 'resident-tax-october', date: iso(year, 10, 31), label: '住民税（第3期）の納付目安', approximate: true },
    { id: 'prepaid-tax-second', date: iso(year, 11, 30), label: '所得税の予定納税（第2期）', approximate: false },
    { id: 'year-end-adjustment', date: iso(year, 12, 10), label: '年末調整の書類提出目安（勤務先による）', approximate: true },
    { id: 'furusato-deadline', date: iso(year, 12, 31), label: 'ふるさと納税・寄附・医療費の年内締め', approximate: false },
  ]
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

/**
 * The next `limit` milestones on or after `today` (YYYY-MM-DD), looking into next year when this year is nearly over.
 */
export function upcomingMilestones(today: string, limit = 4): readonly UpcomingMilestone[] {
  const year = Number(today.slice(0, 4))
  const todayNumber = dayNumber(today)
  return [...annualMilestones(year), ...annualMilestones(year + 1)]
    .map((milestone) => ({ ...milestone, daysUntil: dayNumber(milestone.date) - todayNumber }))
    .filter((milestone) => milestone.daysUntil >= 0)
    .slice(0, limit)
}
