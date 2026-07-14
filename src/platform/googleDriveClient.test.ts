import { describe, expect, it, vi } from 'vitest'

import { createPlatformClient, PlatformIpcError } from './client'
import type { AppCommand, Invoke } from './types'

const timestamp = '2026-07-15T00:00:00Z'
const connection = {
  id: 'drive-1', householdId: 'family', googleAccountId: 'google-1', accountEmail: 'taro@example.com',
  clientIdFingerprint: 'a'.repeat(64), driveId: null, rootFolderId: 'folder-1', rootFolderName: '家計簿', rootResourceKey: null,
  status: 'CONNECTED', startPageToken: '100', changePageToken: '101', lastFullScanAt: timestamp, lastChangeAt: null,
  createdAt: timestamp, updatedAt: timestamp,
} as const
const schedule = {
  connectionId: 'drive-1', enabled: true, intervalMinutes: 30, nextDueAt: timestamp, running: false, leaseExpiresAt: null,
  lastAttemptAt: null, lastSuccessAt: null, lastResult: 'NEVER', lastDiscoveredCount: 0, consecutiveFailures: 0,
  suspendedUntil: null, suspensionReason: null, lastErrorCode: null, updatedAt: timestamp,
} as const
const inbox = {
  id: 'b'.repeat(64), householdId: 'family', connectionId: 'drive-1', fileId: 'remote-1', generationFingerprint: 'c'.repeat(64),
  fileName: 'paypay.csv', mediaType: 'text/csv', remoteByteSize: 42, remoteModifiedAt: timestamp,
  remoteMd5Checksum: 'd'.repeat(32), driveVersion: '7', contentSha256: 'e'.repeat(64), state: 'READY', attemptCount: 1,
  importRunId: null, lastErrorCode: null, discoveredAt: timestamp, updatedAt: timestamp,
} as const

describe('Google Drive platform client contract', () => {
  it('keeps web builds explicitly unavailable and side-effect free', async () => {
    const invoke = vi.fn()
    const client = createPlatformClient({ tauri: false, invoke })

    await expect(client.getGoogleDriveAvailability()).resolves.toEqual({
      available: false, authorizationMode: 'SYSTEM_BROWSER_LOOPBACK', scopeProfile: 'DRIVE_READONLY', unavailableReason: 'UNSUPPORTED_RUNTIME',
    })
    await expect(client.listGoogleDriveConnections('family')).resolves.toEqual([])
    await expect(client.listGoogleDriveInbox('family')).resolves.toEqual([])
    await expect(client.connectGoogleDrive('family')).rejects.toMatchObject({ command: 'google_drive_connect' })
    await expect(client.bindGoogleDriveFolder({ householdId: 'family', connectionId: 'drive-1', folderReference: 'folder-1' })).rejects.toMatchObject({ command: 'google_drive_folder_bind' })
    await expect(client.updateGoogleDriveSchedule({ householdId: 'family', connectionId: 'drive-1', enabled: true, intervalMinutes: 30 })).rejects.toMatchObject({ command: 'google_drive_schedule_update' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('routes lifecycle, folder, schedule, and inbox methods through validated commands', async () => {
    const responses: Partial<Record<AppCommand, unknown>> = {
      google_drive_availability: { available: true, authorizationMode: 'SYSTEM_BROWSER_LOOPBACK', scopeProfile: 'DRIVE_READONLY', unavailableReason: null },
      google_drive_connections_list: [connection], google_drive_connect: connection, google_drive_folder_bind: connection,
      google_drive_disconnect: { ...connection, status: 'DISCONNECTED' }, google_drive_schedule_get: schedule,
      google_drive_schedule_update: schedule, google_drive_sync_now: schedule, google_drive_inbox_list: [inbox],
      google_drive_inbox_ignore: { ...inbox, state: 'IGNORED' }, google_drive_inbox_retry: { ...inbox, state: 'DISCOVERED', contentSha256: null },
    }
    const invokeSpy = vi.fn()
    const invoke: Invoke = async <T>(command: AppCommand, args?: Record<string, unknown>) => {
      invokeSpy(command, args)
      return responses[command] as T
    }
    const client = createPlatformClient({ tauri: true, invoke })

    await expect(client.getGoogleDriveAvailability()).resolves.toMatchObject({ available: true })
    await expect(client.listGoogleDriveConnections('family')).resolves.toEqual([connection])
    await expect(client.connectGoogleDrive('family')).resolves.toEqual(connection)
    await expect(client.bindGoogleDriveFolder({ householdId: 'family', connectionId: 'drive-1', folderReference: 'https://drive.google.com/drive/folders/folder-1' })).resolves.toEqual(connection)
    await expect(client.disconnectGoogleDrive('family', 'drive-1')).resolves.toMatchObject({ status: 'DISCONNECTED' })
    await expect(client.getGoogleDriveSchedule('family', 'drive-1')).resolves.toEqual(schedule)
    await expect(client.updateGoogleDriveSchedule({ householdId: 'family', connectionId: 'drive-1', enabled: true, intervalMinutes: 30 })).resolves.toEqual(schedule)
    await expect(client.syncGoogleDriveNow('family', 'drive-1')).resolves.toEqual(schedule)
    await expect(client.listGoogleDriveInbox('family', 'drive-1', 'READY', 20)).resolves.toEqual([inbox])
    await expect(client.ignoreGoogleDriveInboxItem('family', inbox.id)).resolves.toMatchObject({ state: 'IGNORED' })
    await expect(client.retryGoogleDriveInboxItem('family', inbox.id)).resolves.toMatchObject({ state: 'DISCOVERED' })

    expect(invokeSpy).toHaveBeenCalledWith('google_drive_inbox_list', { householdId: 'family', connectionId: 'drive-1', state: 'READY', limit: 20 })
    expect(invokeSpy).toHaveBeenCalledWith('google_drive_folder_bind', { input: { householdId: 'family', connectionId: 'drive-1', folderReference: 'https://drive.google.com/drive/folders/folder-1' } })
  })

  it.each([
    ['google_drive_availability', { available: true, authorizationMode: 'SYSTEM_BROWSER_LOOPBACK', scopeProfile: 'DRIVE_READONLY', unavailableReason: 'UNSUPPORTED_RUNTIME' }, (client: ReturnType<typeof createPlatformClient>) => client.getGoogleDriveAvailability()],
    ['google_drive_connections_list', [{ ...connection, changePageToken: null }], (client: ReturnType<typeof createPlatformClient>) => client.listGoogleDriveConnections('family')],
    ['google_drive_schedule_get', { ...schedule, intervalMinutes: 10 }, (client: ReturnType<typeof createPlatformClient>) => client.getGoogleDriveSchedule('family', 'drive-1')],
    ['google_drive_inbox_list', [{ ...inbox, state: 'STAGED', importRunId: null }], (client: ReturnType<typeof createPlatformClient>) => client.listGoogleDriveInbox('family')],
  ] as const)('rejects malformed %s DTOs at the IPC boundary', async (command, response, call) => {
    const client = createPlatformClient({ tauri: true, invoke: async <T>() => response as T })
    await expect(call(client)).rejects.toEqual(new PlatformIpcError('INVALID_RESPONSE', command))
  })
})
