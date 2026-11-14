import { describe, expect, it } from 'vitest'
import { rollCardEnvelopes, type CardEnvelopeCategory } from './cardEnvelopes'

const category = (categoryId: string, carryInJpy: number, assignedJpy: number, activityJpy: number, cardActivityJpy: Record<string, number>): CardEnvelopeCategory =>
  ({ categoryId, carryInJpy, assignedJpy, activityJpy, cardActivityJpy })
const card = (cardId: string, paymentsJpy: number, owedJpy: number) => ({ cardId, cardName: cardId.toUpperCase(), paymentsJpy, owedJpy })

describe('card payment envelopes', () => {
  it('reserves card spending that the category had money for and shows the unfunded rest as the gap', () => {
    const [july] = rollCardEnvelopes([{
      month: '2026-07',
      categories: [
        category('food', 0, 50_000, 30_000, { visa: 30_000 }),   // fully funded
        category('fun', 0, 10_000, 25_000, { visa: 25_000 }),    // only 10k funded
      ],
      cards: [card('visa', 0, 55_000)],
    }])
    expect(july.cards).toEqual([{ cardId: 'visa', cardName: 'VISA', reservedJpy: 40_000, fundedJpy: 40_000, paymentsJpy: 0, owedJpy: 55_000, gapJpy: 15_000 }])
  })

  it('lets cash spending use the envelope first and counts carry-in as available money', () => {
    const [month] = rollCardEnvelopes([{
      month: '2026-07',
      categories: [
        category('a', 0, 20_000, 30_000, { visa: 20_000 }),        // cash 10k eats half; 10k left funds 10k of 20k
        category('b', 15_000, 0, 15_000, { visa: 15_000 }),        // carry-in 15k funds all
      ],
      cards: [card('visa', 0, 35_000)],
    }])
    expect(month.cards[0].fundedJpy).toBe(25_000)
    expect(month.cards[0].gapJpy).toBe(10_000)
  })

  it('subtracts payments, keeps the balance across months and lets a refund reduce it', () => {
    const [july, august, september] = rollCardEnvelopes([
      { month: '2026-07', categories: [category('food', 0, 40_000, 40_000, { visa: 40_000 })], cards: [card('visa', 0, 40_000)] },
      { month: '2026-08', categories: [], cards: [card('visa', 40_000, 0)] },
      { month: '2026-09', categories: [category('food', 0, 10_000, -3_000, { visa: -3_000 })], cards: [card('visa', 0, -3_000)] },
    ])
    expect(july.cards[0].reservedJpy).toBe(40_000)
    expect(august.cards[0]).toMatchObject({ reservedJpy: 0, paymentsJpy: 40_000, gapJpy: 0 })
    expect(september.cards[0]).toMatchObject({ reservedJpy: -3_000, fundedJpy: -3_000, owedJpy: -3_000, gapJpy: 0 })
  })

  it('splits a category across cards pro rata with the remainder on the last card and keeps the total exact', () => {
    const [month] = rollCardEnvelopes([{
      month: '2026-07',
      categories: [category('food', 0, 100, 300, { amex: 100, visa: 200 })],
      cards: [card('amex', 0, 100), card('visa', 0, 200)],
    }])
    const funded = Object.fromEntries(month.cards.map((state) => [state.cardId, state.fundedJpy]))
    expect(funded).toEqual({ amex: 33, visa: 67 })
    expect(month.cards.reduce((sum, state) => sum + state.fundedJpy, 0)).toBe(100)
  })

  it('stays exact for very large amounts and rejects bad input', () => {
    const big = 9_000_000_000_000
    const [month] = rollCardEnvelopes([{ month: '2026-07', categories: [category('x', 0, big / 3, big, { a: big / 2, b: big / 2 })], cards: [] }])
    expect(month.cards.reduce((sum, state) => sum + state.fundedJpy, 0)).toBe(big / 3)
    expect(() => rollCardEnvelopes([{ month: '2026-08', categories: [], cards: [] }, { month: '2026-07', categories: [], cards: [] }])).toThrow(/ascending/)
    expect(() => rollCardEnvelopes([{ month: '2026-07', categories: [], cards: [card('v', 1.5, 0)] }])).toThrow(RangeError)
    expect(rollCardEnvelopes([])).toEqual([])
  })
})
