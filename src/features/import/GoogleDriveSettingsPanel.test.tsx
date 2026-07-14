import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const drive = vi.hoisted(() => ({
  availability: vi.fn(), list: vi.fn(), connect: vi.fn(), bind: vi.fn(), disconnect: vi.fn(),
  schedule: vi.fn(), updateSchedule: vi.fn(), syncNow: vi.fn(),
}))
vi.mock('../../platform', async (original) => ({
  ...await original<typeof import('../../platform')>(),
  platformClient: {
    runtime: 'tauri', getGoogleDriveAvailability: drive.availability, listGoogleDriveConnections: drive.list,
    connectGoogleDrive: drive.connect, bindGoogleDriveFolder: drive.bind, disconnectGoogleDrive: drive.disconnect,
    getGoogleDriveSchedule: drive.schedule, updateGoogleDriveSchedule: drive.updateSchedule, syncGoogleDriveNow: drive.syncNow,
  },
}))

import { GoogleDriveSettingsPanel } from './GoogleDriveSettingsPanel'

const timestamp = '2026-07-15T00:00:00Z'
const selecting = {
  id: 'drive-1', householdId: 'family', googleAccountId: 'google-1', accountEmail: 'taro@example.com',
  clientIdFingerprint: 'a'.repeat(64), driveId: null, rootFolderId: null, rootFolderName: null, rootResourceKey: null,
  status: 'SELECTING_FOLDER' as const, startPageToken: null, changePageToken: null, lastFullScanAt: null, lastChangeAt: null,
  createdAt: timestamp, updatedAt: timestamp,
}
const connected = {
  ...selecting, status: 'CONNECTED' as const, rootFolderId: 'folder-1', rootFolderName: '家計簿',
  startPageToken: '100', changePageToken: '101',
}
const schedule = {
  connectionId: 'drive-1', enabled: true, intervalMinutes: 30 as const, nextDueAt: timestamp, running: false, leaseExpiresAt: null,
  lastAttemptAt: null, lastSuccessAt: timestamp, lastResult: 'NO_CHANGES' as const, lastDiscoveredCount: 0,
  consecutiveFailures: 0, suspendedUntil: null, suspensionReason: null, lastErrorCode: null, updatedAt: timestamp,
}

describe('GoogleDriveSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    drive.availability.mockResolvedValue({ available: true, authorizationMode: 'SYSTEM_BROWSER_LOOPBACK', scopeProfile: 'DRIVE_READONLY', unavailableReason: null })
    drive.list.mockResolvedValue([]); drive.connect.mockResolvedValue(selecting); drive.bind.mockResolvedValue(connected)
    drive.schedule.mockResolvedValue(schedule); drive.updateSchedule.mockResolvedValue(schedule)
    drive.syncNow.mockResolvedValue({ ...schedule, lastResult: 'DISCOVERED', lastDiscoveredCount: 2 })
    drive.disconnect.mockResolvedValue({ ...connected, status: 'DISCONNECTED' })
  })

  it('shows availability and the review gate before starting authorization', async () => {
    render(<GoogleDriveSettingsPanel householdId="family" />)
    expect(await screen.findByRole('button', { name: 'Google Drive を接続' })).toBeEnabled()
    expect(screen.getByText(/Google Drive のファイルは自動で台帳へ記帳されません/)).toBeInTheDocument()
    expect(drive.list).toHaveBeenCalledWith('family')
  })

  it('explains unavailable desktop configuration without offering a dead connect action', async () => {
    drive.availability.mockResolvedValue({ available: false, authorizationMode: 'SYSTEM_BROWSER_LOOPBACK', scopeProfile: 'DRIVE_READONLY', unavailableReason: 'CLIENT_ID_NOT_COMPILED' })
    render(<GoogleDriveSettingsPanel householdId="family" />)
    expect(await screen.findByText(/このビルドには Google Drive の接続設定/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Google Drive を接続' })).not.toBeInTheDocument()
    expect(drive.list).not.toHaveBeenCalled()
  })

  it('completes authorization and binds a folder URL without importing or posting', async () => {
    render(<GoogleDriveSettingsPanel householdId="family" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Google Drive を接続' }))
    await waitFor(() => expect(drive.connect).toHaveBeenCalledWith('family'))
    const input = await screen.findByLabelText('フォルダー URL または ID')
    fireEvent.change(input, { target: { value: ' https://drive.google.com/drive/folders/folder-1 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'フォルダーを選択' }))
    await waitFor(() => expect(drive.bind).toHaveBeenCalledWith({ householdId: 'family', connectionId: 'drive-1', folderReference: 'https://drive.google.com/drive/folders/folder-1' }))
    expect(await screen.findByText(/ファイルは確認待ちとして取り込まれます/)).toBeInTheDocument()
    expect(screen.getByText('家計簿')).toBeInTheDocument()
  })

  it('updates the interval, syncs on demand, and disconnects while preserving review disclosure', async () => {
    drive.list.mockResolvedValue([connected])
    drive.updateSchedule.mockResolvedValue({ ...schedule, intervalMinutes: 60 })
    render(<GoogleDriveSettingsPanel householdId="family" />)
    const interval = await screen.findByLabelText('Google Drive 同期間隔')
    fireEvent.change(interval, { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'スケジュールを保存' }))
    await waitFor(() => expect(drive.updateSchedule).toHaveBeenCalledWith({ householdId: 'family', connectionId: 'drive-1', enabled: true, intervalMinutes: 60 }))
    fireEvent.click(screen.getByRole('button', { name: '今すぐ同期' }))
    expect(await screen.findByText(/2件の新しい候補/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '接続を解除' }))
    await waitFor(() => expect(drive.disconnect).toHaveBeenCalledWith('family', 'drive-1'))
    expect(await screen.findByText(/取り込み済みの原本と台帳は残ります/)).toBeInTheDocument()
    expect(screen.getByText(/Import Inbox で内容・重複・口座・カテゴリーを確認/)).toBeInTheDocument()
  })
})
