import type { SavingsGoalDto } from '../platform/types'

export interface GoalPace {
  readonly remaining: number
  readonly months: number
  readonly monthly: number
  readonly overdue: boolean
}

/** Whole yen still needed per month (rounded up) to hit a savings goal by its target date. */
export function goalPace(goal: Pick<SavingsGoalDto, 'targetJpy' | 'savedJpy' | 'targetDate'>, now: Date = new Date()): GoalPace {
  const remaining = Math.max(0, goal.targetJpy - goal.savedJpy)
  const today = new Date(now.getTime()); today.setHours(0, 0, 0, 0)
  const target = new Date(`${goal.targetDate}T00:00:00`)
  const days = Math.ceil((target.getTime() - today.getTime()) / 86_400_000)
  const months = Math.max(1, Math.ceil(Math.max(0, days) / (365.25 / 12)))
  return { remaining, months, monthly: remaining === 0 ? 0 : Math.ceil(remaining / months), overdue: days < 0 && remaining > 0 }
}
