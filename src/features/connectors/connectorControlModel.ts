import type {
  ConnectorCursorDto,
  ConnectorHealthDto,
  ConnectorSummaryDto,
  ConnectorSummaryPageDto,
} from '../../platform/types'

export type ConnectorControlFilter = 'ALL' | 'STALE' | 'NEEDS_ACTION'
export type ConnectorPrimaryState = ConnectorHealthDto | 'DISCONNECTED'

export interface ConnectorControlTotals {
  readonly connected: number
  readonly stale: number
  readonly running: number
  readonly needsAction: number
}

type FetchConnectorPage = (cursor: ConnectorCursorDto | undefined) => Promise<ConnectorSummaryPageDto>

export function aggregateConnectorSummaries(summaries: readonly ConnectorSummaryDto[]): ConnectorControlTotals {
  return summaries.reduce<ConnectorControlTotals>((totals, summary) => ({
    connected: totals.connected + Number(summary.lifecycle === 'CONNECTED'),
    stale: totals.stale + Number(summary.health === 'STALE'),
    running: totals.running + Number(summary.health === 'RUNNING'),
    needsAction: totals.needsAction + Number(summary.health === 'NEEDS_ACTION'),
  }), { connected: 0, stale: 0, running: 0, needsAction: 0 })
}

export function filterConnectorSummaries(
  summaries: readonly ConnectorSummaryDto[],
  filter: ConnectorControlFilter,
): readonly ConnectorSummaryDto[] {
  if (filter === 'ALL') return summaries
  if (filter === 'STALE') return summaries.filter((summary) => summary.health === 'STALE')
  return summaries.filter((summary) => summary.health === 'NEEDS_ACTION' || summary.health === 'RETRY_BACKOFF')
}

export function primaryConnectorState(summary: ConnectorSummaryDto): ConnectorPrimaryState {
  return summary.lifecycle === 'DISCONNECTED' ? 'DISCONNECTED' : summary.health
}

export async function loadAllConnectorSummaries(fetchPage: FetchConnectorPage): Promise<readonly ConnectorSummaryDto[]> {
  const summaries: ConnectorSummaryDto[] = []
  const seenCursors = new Set<string>()
  let cursor: ConnectorCursorDto | undefined

  for (;;) {
    const page = await fetchPage(cursor)
    summaries.push(...page.items)
    if (page.nextCursor === null) return summaries

    const cursorKey = `${page.nextCursor.connectorKind}\u0000${page.nextCursor.connectionKey}`
    if (seenCursors.has(cursorKey)) throw new Error('repeated connector cursor')
    seenCursors.add(cursorKey)
    cursor = page.nextCursor
  }
}
