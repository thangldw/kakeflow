import type { EntityId } from './types'

export interface EnvelopeInput {
  categoryId: EntityId
  /** Whole yen assigned to the envelope this month. */
  assignedJpy: number
  /** Whole yen spent from the envelope this month; negative for a net refund. */
  activityJpy: number
}

export interface EnvelopeMonthInput {
  /** YYYY-MM. Months must be strictly ascending. */
  month: string
  /** Whole yen of income that became available to assign this month. */
  incomeJpy: number
  envelopes: readonly EnvelopeInput[]
}

export interface EnvelopeState {
  categoryId: EntityId
  carryInJpy: number
  assignedJpy: number
  activityJpy: number
  /** carryIn + assigned − activity. Negative means overspent and carries forward as a red balance. */
  availableJpy: number
}

export interface EnvelopeMonthResult {
  month: string
  /** Running pool: previous pool + income − assigned. Negative means over-assigned. */
  readyToAssignJpy: number
  envelopes: readonly EnvelopeState[]
  overspentCategoryIds: readonly EntityId[]
}

const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/

function whole(value: number, name: string): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a whole-yen integer`)
  return value
}

/**
 * Zero-based envelope roll-forward with signed carry. Balances are never reset
 * silently: an overspent envelope stays negative into the next month and an
 * over-assigned pool stays negative, so both remain visible to the user.
 * Envelopes missing from a later month keep their balance.
 */
export function rollEnvelopes(months: readonly EnvelopeMonthInput[]): EnvelopeMonthResult[] {
  const balances = new Map<EntityId, number>()
  let pool = 0
  let previousMonth: string | null = null
  const results: EnvelopeMonthResult[] = []

  for (const input of months) {
    if (!MONTH.test(input.month)) throw new RangeError(`Invalid month ${input.month}`)
    if (previousMonth != null && input.month <= previousMonth) throw new RangeError('Months must be strictly ascending')
    previousMonth = input.month
    const seen = new Set<EntityId>()
    let assignedTotal = 0
    const states: EnvelopeState[] = []

    for (const envelope of input.envelopes) {
      if (seen.has(envelope.categoryId)) throw new RangeError(`Duplicate envelope ${envelope.categoryId} in ${input.month}`)
      seen.add(envelope.categoryId)
      const assigned = whole(envelope.assignedJpy, 'assignedJpy')
      const activity = whole(envelope.activityJpy, 'activityJpy')
      const carryIn = balances.get(envelope.categoryId) ?? 0
      const available = carryIn + assigned - activity
      balances.set(envelope.categoryId, available)
      assignedTotal += assigned
      states.push({ categoryId: envelope.categoryId, carryInJpy: carryIn, assignedJpy: assigned, activityJpy: activity, availableJpy: available })
    }
    for (const [categoryId, balance] of balances) {
      if (!seen.has(categoryId)) states.push({ categoryId, carryInJpy: balance, assignedJpy: 0, activityJpy: 0, availableJpy: balance })
    }

    pool += whole(input.incomeJpy, 'incomeJpy') - assignedTotal
    states.sort((left, right) => left.categoryId.localeCompare(right.categoryId))
    results.push({
      month: input.month, readyToAssignJpy: pool, envelopes: states,
      overspentCategoryIds: states.filter((state) => state.availableJpy < 0).map((state) => state.categoryId),
    })
  }
  return results
}
