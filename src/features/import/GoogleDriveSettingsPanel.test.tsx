import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const drive = vi.hoisted(() => ({
  availability: vi.fn(), list: vi.fn(), connect: vi.fn(), bind: vi.fn(), disconnect: vi.fn(),
  schedule: vi.fn(), updateSchedule: vi.fn(), syncNow: vi.fn(),
}))
const syncEvent = vi.hoisted(() => ({
  subscribe: vi.fn(),
  listener: null as null | ((event: { householdId: string; connectionId: string; discoveredCount: number; result: 'DISCOVERED' }) => void),
}))
vi.mock('../../platform', async (original) => ({
  ...await original<typeof import('../../platform')>(),
  platformClient: {
    runtime: 'tauri', getGoogleDriveAvailability: drive.availability, listGoogleDriveConnections: drive.list,
    connectGoogleDrive: drive.connect, bindGoogleDriveFolder: drive.bind, disconnectGoogleDrive: drive.disconnect,
    getGoogleDriveSchedule: drive.schedule, updateGoogleDriveSchedule: drive.updateSchedule, syncGoogleDriveNow: drive.syncNow,
  },
}))
vi.mock('./googleDriveSyncEventPlatform', () => ({
  googleDriveSyncEventPlatform: { subscribe: syncEvent.subscribe },
}))

import { GoogleDriveSettingsPanel } from './GoogleDriveSettingsPanel'

const timestamp = '2026-07-15T00:00:00Z'
const selecting = {
  id: 'drive-1', accountEmail: 'taro@example.com', folderName: null, driveScope: null, folderBound: false,
  status: 'SELECTING_FOLDER' as const, lastFullScanAt: null, lastChangeAt: null,
  createdAt: timestamp, updatedAt: timestamp,
}
const connected = {
  ...selecting, status: 'CONNECTED' as const, folderName: '家計簿', driveScope: 'MY_DRIVE' as const, folderBound: true,
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
    syncEvent.listener = null
    syncEvent.subscribe.mockImplementation(async (listener) => {
      syncEvent.listener = listener
      return () => undefined
    })
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

  it('refreshes connection and schedule only for a completed sync in the active household', async () => {
    drive.list.mockResolvedValue([connected])
    render(<GoogleDriveSettingsPanel householdId="family" />)
    expect(await screen.findByText('家計簿')).toBeInTheDocument()
    await waitFor(() => expect(syncEvent.subscribe).toHaveBeenCalledOnce())
    const initialListCalls = drive.list.mock.calls.length
    const initialScheduleCalls = drive.schedule.mock.calls.length

    syncEvent.listener?.({ householdId: 'other-family', connectionId: 'drive-1', discoveredCount: 4, result: 'DISCOVERED' })
    await Promise.resolve()
    expect(drive.list).toHaveBeenCalledTimes(initialListCalls)

    syncEvent.listener?.({ householdId: 'family', connectionId: 'drive-1', discoveredCount: 4, result: 'DISCOVERED' })
    await waitFor(() => expect(drive.list).toHaveBeenCalledTimes(initialListCalls + 1))
    await waitFor(() => expect(drive.schedule).toHaveBeenCalledTimes(initialScheduleCalls + 1))
    expect(drive.schedule).toHaveBeenLastCalledWith('family', 'drive-1')
  })
})
