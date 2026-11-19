import type { EntityId } from './types'

export interface CardEnvelopeCategory {
  categoryId: EntityId
  /** Balance carried into the month (signed; see rollEnvelopes). */
  carryInJpy: number
  assignedJpy: number
  /** All activity of the month, any payment method. */
  activityJpy: number
  /** The part of the activity put on each credit card (refunds are negative). */
  cardActivityJpy: Readonly<Record<EntityId, number>>
}

export interface CardEnvelopeCardMonth {
  cardId: EntityId
  cardName: string
  /** Card payments made during the month. */
  paymentsJpy: number
  /** Liability balance at the end of the month. */
  owedJpy: number
}

export interface CardEnvelopeMonthInput {
  /** YYYY-MM, strictly ascending across the input. */
  month: string
  categories: readonly CardEnvelopeCategory[]
  cards: readonly CardEnvelopeCardMonth[]
}

export interface CardEnvelopeState {
  cardId: EntityId
  cardName: string
  /** Cash set aside for this card: funded card spending so far minus payments (signed). */
  reservedJpy: number
  fundedJpy: number
  paymentsJpy: number
  owedJpy: number
  /** owed minus reserved. Positive: card debt that no envelope money stands behind. */
  gapJpy: number
}

export interface CardEnvelopeMonthResult {
  month: string
  cards: readonly CardEnvelopeState[]
}

function whole(value: number, name: string): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a whole-yen integer`)
  return value
}

/** floor(total * part / whole) without losing precision on large yen values. */
function proportion(total: number, part: number, whole_: number): number {
  const result = (BigInt(total) * BigInt(part)) / BigInt(whole_)
  return Number(result)
}

/**
 * Card payment envelopes. Per category and month, card spending counts as funded
 * only as far as the envelope still had money after its cash spending
 * (carry-in + assigned - cash activity, clamped to the card spending). Funded
 * amounts accumulate per card and are reduced by card payments, so the reserved
 * balance is the cash earmarked for paying the card. A net refund on a card
 * reduces it by the refunded amount. This is an estimate for planning: it needs
 * budgeted categories, and spending in unbudgeted categories is never funded.
 */
export function rollCardEnvelopes(months: readonly CardEnvelopeMonthInput[]): CardEnvelopeMonthResult[] {
  const reserved = new Map<EntityId, number>()
  const names = new Map<EntityId, string>()
  const last = new Map<EntityId, { owedJpy: number }>()
  let previousMonth: string | null = null
  const results: CardEnvelopeMonthResult[] = []

  for (const input of months) {
    if (previousMonth != null && input.month <= previousMonth) throw new RangeError('Months must be strictly ascending')
    previousMonth = input.month
    const funded = new Map<EntityId, number>()

    for (const category of input.categories) {
      const cardIds = Object.keys(category.cardActivityJpy).sort()
      const cardTotal = cardIds.reduce((sum, id) => sum + whole(category.cardActivityJpy[id], 'cardActivityJpy'), 0)
      if (cardTotal === 0) continue
      const cash = whole(category.activityJpy, 'activityJpy') - cardTotal
      const available = whole(category.carryInJpy, 'carryInJpy') + whole(category.assignedJpy, 'assignedJpy') - cash
      const fundedTotal = cardTotal > 0 ? Math.min(Math.max(available, 0), cardTotal) : cardTotal
      let allocated = 0
      cardIds.forEach((id, index) => {
        const share = index === cardIds.length - 1 ? fundedTotal - allocated : proportion(fundedTotal, category.cardActivityJpy[id], cardTotal)
        allocated += share
        funded.set(id, (funded.get(id) ?? 0) + share)
      })
    }

    const payments = new Map<EntityId, number>()
    for (const card of input.cards) {
      names.set(card.cardId, card.cardName)
      payments.set(card.cardId, whole(card.paymentsJpy, 'paymentsJpy'))
      last.set(card.cardId, { owedJpy: whole(card.owedJpy, 'owedJpy') })
    }
    const ids = new Set<EntityId>([...reserved.keys(), ...funded.keys(), ...payments.keys()])
    const states: CardEnvelopeState[] = []
    for (const id of [...ids].sort()) {
      const fundedNow = funded.get(id) ?? 0
      const paid = payments.get(id) ?? 0
      const balance = (reserved.get(id) ?? 0) + fundedNow - paid
      reserved.set(id, balance)
      const owed = last.get(id)?.owedJpy ?? 0
      states.push({ cardId: id, cardName: names.get(id) ?? id, reservedJpy: balance, fundedJpy: fundedNow, paymentsJpy: paid, owedJpy: owed, gapJpy: owed - balance })
    }
    results.push({ month: input.month, cards: states })
  }
  return results
}
