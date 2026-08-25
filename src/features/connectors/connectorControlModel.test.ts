import { describe, expect, it, vi } from 'vitest'
import type { ConnectorSummaryDto } from '../../platform/types'
import {
  aggregateConnectorSummaries,
  filterConnectorSummaries,
  loadAllConnectorSummaries,
  primaryConnectorState,
} from './connectorControlModel'

const summary = (overrides: Partial<ConnectorSummaryDto> = {}): ConnectorSummaryDto => ({
  schemaVersion: 1,
  connectorKind: 'GOOGLE_DRIVE',
  connectionKey: 'drive-primary',
  displayLabel: 'Household statements',
  availability: 'AVAILABLE',
  lifecycle: 'CONNECTED',
  health: 'FRESH',
  capabilities: ['CONFIGURE'],
  lastAttemptAt: '2026-08-25T00:00:00Z',
  lastSuccessAt: '2026-08-25T00:00:00Z',
  freshnessDeadlineAt: '2026-08-26T00:00:00Z',
  nextDueAt: '2026-08-25T00:30:00Z',
  pendingReviewCount: 0,
  consecutiveFailures: 0,
  lastErrorCode: null,
  bindingSummary: null,
  configurationDestination: 'GOOGLE_DRIVE_SETTINGS',
  ...overrides,
})

describe('connector control model', () => {
  it('counts lifecycle and health totals independently', () => {
    const items = [
      summary(),
      summary({ connectionKey: 'stale', health: 'STALE' }),
      summary({ connectionKey: 'running', health: 'RUNNING' }),
      summary({ connectionKey: 'action', health: 'NEEDS_ACTION' }),
      summary({ connectionKey: 'disconnected', lifecycle: 'DISCONNECTED', health: 'NEVER_REFRESHED' }),
    ]

    expect(aggregateConnectorSummaries(items)).toEqual({ connected: 4, stale: 1, running: 1, needsAction: 1 })
  })

  it('filters all, stale, and needs-action connectors without mutating input', () => {
    const items = [
      summary({ connectionKey: 'fresh' }),
      summary({ connectionKey: 'stale', health: 'STALE' }),
      summary({ connectionKey: 'backoff', health: 'RETRY_BACKOFF' }),
      summary({ connectionKey: 'action', health: 'NEEDS_ACTION' }),
    ]

    expect(filterConnectorSummaries(items, 'ALL')).toEqual(items)
    expect(filterConnectorSummaries(items, 'STALE').map((item) => item.connectionKey)).toEqual(['stale'])
    expect(filterConnectorSummaries(items, 'NEEDS_ACTION').map((item) => item.connectionKey)).toEqual(['backoff', 'action'])
    expect(items.map((item) => item.connectionKey)).toEqual(['fresh', 'stale', 'backoff', 'action'])
  })

  it('uses the native primary-state precedence and lets disconnected override health', () => {
    expect(primaryConnectorState(summary({ health: 'NEEDS_ACTION' }))).toBe('NEEDS_ACTION')
    expect(primaryConnectorState(summary({ health: 'RUNNING' }))).toBe('RUNNING')
    expect(primaryConnectorState(summary({ health: 'RETRY_BACKOFF' }))).toBe('RETRY_BACKOFF')
    expect(primaryConnectorState(summary({ health: 'STALE' }))).toBe('STALE')
    expect(primaryConnectorState(summary({ health: 'FRESH' }))).toBe('FRESH')
    expect(primaryConnectorState(summary({ connectorKind: 'MANUAL_IMPORT', health: 'MANUAL' }))).toBe('MANUAL')
    expect(primaryConnectorState(summary({ health: 'NEVER_REFRESHED' }))).toBe('NEVER_REFRESHED')
    expect(primaryConnectorState(summary({ lifecycle: 'DISCONNECTED', health: 'NEVER_REFRESHED' }))).toBe('DISCONNECTED')
  })

  it('loads every page and passes each opaque cursor back unchanged', async () => {
    const secondCursor = { connectorKind: 'GMAIL' as const, connectionKey: 'gmail-primary' }
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ schemaVersion: 1, items: [summary()], nextCursor: secondCursor })
      .mockResolvedValueOnce({ schemaVersion: 1, items: [summary({ connectorKind: 'GMAIL', connectionKey: 'gmail-primary', configurationDestination: 'GMAIL_SETTINGS' })], nextCursor: null })

    await expect(loadAllConnectorSummaries(fetchPage)).resolves.toHaveLength(2)
    expect(fetchPage.mock.calls).toEqual([[undefined], [secondCursor]])
  })

  it('rejects a repeated cursor before requesting the same page again', async () => {
    const repeated = { connectorKind: 'GMAIL' as const, connectionKey: 'gmail-primary' }
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ schemaVersion: 1, items: [summary()], nextCursor: repeated })
      .mockResolvedValueOnce({ schemaVersion: 1, items: [], nextCursor: repeated })

    await expect(loadAllConnectorSummaries(fetchPage)).rejects.toThrow('repeated connector cursor')
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })
})
