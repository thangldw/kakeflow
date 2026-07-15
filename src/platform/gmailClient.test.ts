import { describe, expect, it, vi } from 'vitest'
import { createPlatformClient, PlatformIpcError } from './client'
import type { AppCommand, Invoke } from './types'

const timestamp = '2026-07-15T00:00:00Z'
const connection = { id: 'gmail-1', status: 'CONNECTED', accountEmail: 'home@example.com', labelId: 'Label_1', labelName: 'KakeFlow', gmailQuery: 'has:attachment', labelBound: true, lastFullScanAt: timestamp, lastChangeAt: null, createdAt: timestamp, updatedAt: timestamp } as const
const schedule = { connectionId: 'gmail-1', enabled: true, intervalMinutes: 30, nextDueAt: timestamp, running: false, lastResult: 'NEVER', lastDiscoveredCount: 0, consecutiveFailures: 0, suspendedUntil: null, suspensionReason: null, lastErrorCode: null, updatedAt: timestamp } as const
const inbox = { id: 'a'.repeat(64), householdId: 'family', connectionId: 'gmail-1', fileName: 'statement.eml', mediaType: 'message/rfc822', internalDateMs: 1_752_537_600_000, estimatedByteSize: 42, contentReady: true, state: 'READY', attemptCount: 1, importRunId: null, lastErrorCode: null, discoveredAt: timestamp, updatedAt: timestamp } as const

describe('Gmail platform client contract', () => {
  it('keeps web builds unavailable and side-effect free', async () => {
    const invoke = vi.fn(); const client = createPlatformClient({ tauri: false, invoke })
    await expect(client.getGmailAvailability()).resolves.toMatchObject({ available: false, scopeProfile: 'GMAIL_READONLY' })
    await expect(client.listGmailConnections('family')).resolves.toEqual([]); await expect(client.listGmailInbox('family')).resolves.toEqual([])
    await expect(client.connectGmail('family')).rejects.toMatchObject({ command: 'gmail_connect' }); expect(invoke).not.toHaveBeenCalled()
  })

  it('routes lifecycle, labels, schedule and inbox commands', async () => {
    const responses: Partial<Record<AppCommand, unknown>> = {
      gmail_availability: { available: true, authorizationMode: 'SYSTEM_BROWSER_LOOPBACK', scopeProfile: 'GMAIL_READONLY', unavailableReason: null }, gmail_connections_list: [connection],
      gmail_connect: { ...connection, status: 'SELECTING_LABEL', labelId: null, labelName: null, labelBound: false }, gmail_labels_list: [{ id: 'Label_1', name: 'KakeFlow', kind: 'USER' }], gmail_label_bind: connection,
      gmail_disconnect: { ...connection, status: 'DISCONNECTED' }, gmail_schedule_get: schedule, gmail_schedule_update: schedule, gmail_sync_now: schedule, gmail_inbox_list: [inbox],
      gmail_inbox_ignore: { ...inbox, state: 'IGNORED' }, gmail_inbox_retry: { ...inbox, state: 'DISCOVERED', contentReady: false }, gmail_inbox_file_read: { item: inbox, fileBytes: [1, 2, 3] },
      gmail_inbox_claim: { leaseToken: 'f'.repeat(64), leaseExpiresAt: timestamp, items: [{ ...inbox, state: 'PROCESSING' }] }, gmail_inbox_mark_staged: { ...inbox, state: 'STAGED', importRunId: 'run-1' },
      gmail_inbox_mark_failed: { ...inbox, state: 'FAILED', lastErrorCode: 'IMPORT_START_FAILED' }, gmail_inbox_reopen: inbox,
    }
    const spy = vi.fn()
    const invoke: Invoke = async <T>(command: AppCommand, args?: Record<string, unknown>) => { spy(command, args); return responses[command] as T }
    const client = createPlatformClient({ tauri: true, invoke })
    await expect(client.getGmailAvailability()).resolves.toMatchObject({ available: true }); await expect(client.listGmailConnections('family')).resolves.toEqual([connection])
    await expect(client.listGmailLabels('family', 'gmail-1')).resolves.toHaveLength(1)
    await expect(client.bindGmailLabel({ householdId: 'family', connectionId: 'gmail-1', labelId: 'Label_1', labelName: 'KakeFlow', gmailQuery: 'has:attachment' })).resolves.toEqual(connection)
    await expect(client.getGmailSchedule('family', 'gmail-1')).resolves.toEqual(schedule); await expect(client.listGmailInbox('family', 'gmail-1', 'READY', 20)).resolves.toEqual([inbox])
    await expect(client.readGmailInboxFile('family', inbox.id)).resolves.toMatchObject({ item: inbox }); await expect(client.claimGmailInboxItems('family', [inbox.id])).resolves.toMatchObject({ items: [expect.objectContaining({ state: 'PROCESSING' })] })
    await expect(client.markGmailInboxStaged('family', inbox.id, 'f'.repeat(64), 'run-1')).resolves.toMatchObject({ state: 'STAGED' }); await expect(client.reopenGmailInboxItem('family', inbox.id, 'run-1')).resolves.toMatchObject({ state: 'READY' })
    expect(spy).toHaveBeenCalledWith('gmail_inbox_file_read', { householdId: 'family', itemId: inbox.id })
  })

  it('rejects malformed DTOs', async () => {
    const client = createPlatformClient({ tauri: true, invoke: async <T>() => ({ ...inbox, state: 'STAGED', importRunId: null }) as T })
    await expect(client.ignoreGmailInboxItem('family', inbox.id)).rejects.toEqual(new PlatformIpcError('INVALID_RESPONSE', 'gmail_inbox_ignore'))
  })
})
