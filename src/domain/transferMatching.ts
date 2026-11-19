import { dateToEpochDay } from './reconciliation'
import type { EntityId, IsoDate } from './types'

export interface TransferMatchCandidate {
  id: EntityId
  accountId: EntityId
  occurredOn: IsoDate
  /** Positive whole-yen amount; direction carries the sign. */
  amountJpy: number
  direction: 'IN' | 'OUT'
  description?: string
  /** Already linked to a transfer or card payment; never re-proposed. */
  linked?: boolean
}

export interface TransferPairProposal {
  outId: EntityId
  inId: EntityId
  amountJpy: number
  dayGap: number
  score: number
  reasons: readonly string[]
}

export interface TransferMatchResult {
  proposals: readonly TransferPairProposal[]
  /** Candidates with more than one equally good partner; left for the user, never guessed. */
  ambiguousIds: readonly EntityId[]
}

export interface TransferMatchOptions {
  /** Maximum calendar days between the outgoing and incoming leg. Default 3. */
  maxDayGap?: number
  /** Pair keys from rejectionKey() that the user already dismissed. */
  rejectedKeys?: ReadonlySet<string>
}

const TRANSFER_HINT = /振替|振込|送金|移動|入金|transfer/i

/** Order-independent identity of a dismissed pair, stable across restarts and runtimes. */
export function rejectionKey(firstId: EntityId, secondId: EntityId): string {
  return firstId < secondId ? `${firstId}|${secondId}` : `${secondId}|${firstId}`
}

interface Edge { out: TransferMatchCandidate; in: TransferMatchCandidate; dayGap: number; score: number; hinted: boolean }

/**
 * Proposes own-account transfer pairs. A proposal needs equal amounts, opposite
 * directions, different accounts, a bounded date gap and mutual uniqueness:
 * if either leg has two equally good partners nothing is proposed for it.
 * Proposals are candidates for review; this function never links anything.
 */
export function proposeTransferPairs(candidates: readonly TransferMatchCandidate[], options: TransferMatchOptions = {}): TransferMatchResult {
  const maxDayGap = options.maxDayGap ?? 3
  const rejected = options.rejectedKeys ?? new Set<string>()
  const open = candidates.filter((candidate) => !candidate.linked && Number.isSafeInteger(candidate.amountJpy) && candidate.amountJpy > 0)
  const outgoing = open.filter((candidate) => candidate.direction === 'OUT')
  const incoming = open.filter((candidate) => candidate.direction === 'IN')

  const edges: Edge[] = []
  for (const out of outgoing) {
    for (const inn of incoming) {
      if (out.accountId === inn.accountId || out.amountJpy !== inn.amountJpy) continue
      if (rejected.has(rejectionKey(out.id, inn.id))) continue
      const dayGap = Math.abs(dateToEpochDay(inn.occurredOn) - dateToEpochDay(out.occurredOn))
      if (dayGap > maxDayGap) continue
      const hinted = TRANSFER_HINT.test(`${out.description ?? ''} ${inn.description ?? ''}`)
      // Same day is the strongest evidence; a transfer wording only breaks otherwise equal pairs.
      const score = Math.round(((1 - dayGap / (maxDayGap + 1)) * 0.9 + (hinted ? 0.1 : 0)) * 1000) / 1000
      edges.push({ out, in: inn, dayGap, score, hinted })
    }
  }

  const best = new Map<EntityId, { score: number; edges: Edge[] }>()
  const note = (id: EntityId, edge: Edge) => {
    const current = best.get(id)
    if (!current || edge.score > current.score) best.set(id, { score: edge.score, edges: [edge] })
    else if (edge.score === current.score) current.edges.push(edge)
  }
  for (const edge of edges) { note(edge.out.id, edge); note(edge.in.id, edge) }

  const proposals: TransferPairProposal[] = []
  const ambiguous = new Set<EntityId>()
  for (const edge of edges) {
    const outBest = best.get(edge.out.id)!
    const inBest = best.get(edge.in.id)!
    if (outBest.edges.length > 1) ambiguous.add(edge.out.id)
    if (inBest.edges.length > 1) ambiguous.add(edge.in.id)
    if (outBest.edges.length === 1 && inBest.edges.length === 1 && outBest.edges[0] === edge && inBest.edges[0] === edge) {
      proposals.push({
        outId: edge.out.id, inId: edge.in.id, amountJpy: edge.out.amountJpy, dayGap: edge.dayGap, score: edge.score,
        reasons: [
          `Equal amount ${edge.out.amountJpy}`,
          edge.dayGap === 0 ? 'Same day' : `${edge.dayGap} day gap`,
          ...(edge.hinted ? ['Transfer wording in description'] : []),
        ],
      })
    }
  }
  proposals.sort((left, right) => right.score - left.score || left.outId.localeCompare(right.outId))
  return { proposals, ambiguousIds: [...ambiguous].sort() }
}
