import type { PageId } from '../../types'
import type { ActionItemDto, ActionKind, ActionPriority } from './forecastActionPlatform'

const priorityRank: Record<ActionPriority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

export function orderActions(actions: readonly ActionItemDto[]): ActionItemDto[] {
  return [...actions].sort((left, right) => {
    const priority = priorityRank[left.priority] - priorityRank[right.priority]
    if (priority !== 0) return priority
    if (left.dueOn && right.dueOn) {
      const due = left.dueOn.localeCompare(right.dueOn)
      if (due !== 0) return due
    } else if (left.dueOn) return -1
    else if (right.dueOn) return 1
    return left.id.localeCompare(right.id)
  })
}

const actionPages: Record<ActionKind, PageId> = {
  IMPORT_REVIEW: 'import', IMPORT_FAILED: 'import',
  CARD_MISMATCH: 'cards', CARD_PAYMENT_DUE: 'cards', CARD_BALANCE_SHORTFALL: 'cards', CARD_MAPPING_REQUIRED: 'cards',
  BUDGET_OVERRUN: 'budgets', GOAL_DUE: 'budgets',
  SPENDING_ANOMALY: 'transactions', RECURRING_PRICE_CHANGE: 'transactions',
}

export function pageForAction(action: Pick<ActionItemDto, 'kind'>): PageId { return actionPages[action.kind] }

export function homeActionSlice(actions: readonly ActionItemDto[], limit = 3) {
  const ordered = orderActions(actions)
  const visible = ordered.slice(0, Math.max(0, limit))
  return { visible, remaining: Math.max(0, ordered.length - visible.length), total: ordered.length }
}
