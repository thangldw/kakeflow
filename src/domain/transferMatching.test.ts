import { describe, expect, it } from 'vitest'
import { proposeTransferPairs, rejectionKey, type TransferMatchCandidate } from './transferMatching'

const leg = (id: string, accountId: string, occurredOn: string, direction: 'IN' | 'OUT', amountJpy: number, extra: Partial<TransferMatchCandidate> = {}): TransferMatchCandidate =>
  ({ id, accountId, occurredOn, direction, amountJpy, ...extra })

describe('own-account transfer matching', () => {
  it('pairs an outgoing and incoming leg with equal amount across different accounts', () => {
    const result = proposeTransferPairs([
      leg('o1', 'bank-a', '2026-07-01', 'OUT', 50_000, { description: '振込 ミツイ' }),
      leg('i1', 'bank-b', '2026-07-02', 'IN', 50_000),
      leg('x', 'bank-b', '2026-07-02', 'IN', 12_000),
    ])
    expect(result.ambiguousIds).toEqual([])
    expect(result.proposals).toEqual([{ outId: 'o1', inId: 'i1', amountJpy: 50_000, dayGap: 1, score: 0.775, reasons: ['Equal amount 50000', '1 day gap', 'Transfer wording in description'] }])
  })

  it('never pairs within one account, across amounts, beyond the gap, or with linked legs', () => {
    const result = proposeTransferPairs([
      leg('o1', 'bank-a', '2026-07-01', 'OUT', 1000), leg('i-same', 'bank-a', '2026-07-01', 'IN', 1000),
      leg('o2', 'bank-a', '2026-07-01', 'OUT', 2000), leg('i-amt', 'bank-b', '2026-07-01', 'IN', 2001),
      leg('o3', 'bank-a', '2026-07-01', 'OUT', 3000), leg('i-far', 'bank-b', '2026-07-09', 'IN', 3000),
      leg('o4', 'bank-a', '2026-07-01', 'OUT', 4000, { linked: true }), leg('i-linked', 'bank-b', '2026-07-01', 'IN', 4000),
    ])
    expect(result.proposals).toEqual([])
  })

  it('leaves tied partners to the user instead of guessing', () => {
    const result = proposeTransferPairs([
      leg('o1', 'bank-a', '2026-07-01', 'OUT', 9000),
      leg('i1', 'bank-b', '2026-07-01', 'IN', 9000), leg('i2', 'bank-c', '2026-07-01', 'IN', 9000),
    ])
    expect(result.proposals).toEqual([])
    expect(result.ambiguousIds).toEqual(['o1'])
  })

  it('prefers the closer date and breaks only otherwise-equal pairs by transfer wording', () => {
    const closer = proposeTransferPairs([
      leg('o1', 'bank-a', '2026-07-01', 'OUT', 9000),
      leg('i-near', 'bank-b', '2026-07-01', 'IN', 9000), leg('i-far', 'bank-c', '2026-07-03', 'IN', 9000),
    ])
    expect(closer.proposals.map((proposal) => proposal.inId)).toEqual(['i-near'])
  })

  it('honours dismissed pairs regardless of argument order and is deterministic', () => {
    const candidates = [leg('o1', 'bank-a', '2026-07-01', 'OUT', 500), leg('i1', 'bank-b', '2026-07-01', 'IN', 500)]
    expect(rejectionKey('o1', 'i1')).toBe(rejectionKey('i1', 'o1'))
    expect(proposeTransferPairs(candidates).proposals).toHaveLength(1)
    expect(proposeTransferPairs(candidates, { rejectedKeys: new Set([rejectionKey('i1', 'o1')]) }).proposals).toEqual([])
    expect(proposeTransferPairs([...candidates].reverse())).toEqual(proposeTransferPairs(candidates))
  })

  it('ignores non-positive or fractional amounts', () => {
    expect(proposeTransferPairs([leg('o1', 'a', '2026-07-01', 'OUT', 0), leg('i1', 'b', '2026-07-01', 'IN', 0), leg('o2', 'a', '2026-07-01', 'OUT', 1.5), leg('i2', 'b', '2026-07-01', 'IN', 1.5)]).proposals).toEqual([])
  })
})
