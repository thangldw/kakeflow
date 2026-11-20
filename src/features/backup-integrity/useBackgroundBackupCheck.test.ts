import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKGROUND_BACKUP_CHECK_INTERVAL_MS, useBackgroundBackupCheck } from './useBackgroundBackupCheck'
import type { BackupFileCheckDto } from '../../platform/types'

const file = (status: BackupFileCheckDto['status']): BackupFileCheckDto => ({ path: '/b/a.kakeflow-backup', fileName: 'a.kakeflow-backup', recordedAt: '2026-11-01T00:00:00.000Z', byteSize: 10, status })

beforeEach(() => localStorage.clear())

describe('useBackgroundBackupCheck', () => {
  it('stays silent when every file is intact and remembers the run', async () => {
    const run = vi.fn(async () => [file('OK')]); const onProblems = vi.fn()
    renderHook(() => useBackgroundBackupCheck(true, { run, onProblems, now: () => 1_000 }))
    await waitFor(() => expect(localStorage.getItem('kakeflow:backup-integrity:last-run')).toBe('1000'))
    expect(onProblems).not.toHaveBeenCalled()
  })

  it('reports only the files that are not OK', async () => {
    const run = vi.fn(async () => [file('OK'), file('MISSING'), file('CHANGED')]); const onProblems = vi.fn()
    renderHook(() => useBackgroundBackupCheck(true, { run, onProblems, now: () => 5 }))
    await waitFor(() => expect(onProblems).toHaveBeenCalled())
    expect(onProblems.mock.calls[0]?.[0]).toHaveLength(2)
  })

  it('skips within the interval, runs after it, and does nothing when disabled or failing', async () => {
    localStorage.setItem('kakeflow:backup-integrity:last-run', '1000')
    const run = vi.fn(async () => [file('OK')])
    renderHook(() => useBackgroundBackupCheck(true, { run, onProblems: vi.fn(), now: () => 1_000 + BACKGROUND_BACKUP_CHECK_INTERVAL_MS - 1 }))
    renderHook(() => useBackgroundBackupCheck(false, { run, onProblems: vi.fn(), now: () => 9e15 }))
    expect(run).not.toHaveBeenCalled()
    renderHook(() => useBackgroundBackupCheck(true, { run, onProblems: vi.fn(), now: () => 1_000 + BACKGROUND_BACKUP_CHECK_INTERVAL_MS }))
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    const failing = vi.fn(async () => { throw new Error('x') }); localStorage.clear()
    const onProblems = vi.fn()
    renderHook(() => useBackgroundBackupCheck(true, { run: failing, onProblems, now: () => 1 }))
    await waitFor(() => expect(failing).toHaveBeenCalled())
    expect(onProblems).not.toHaveBeenCalled()
  })
})
