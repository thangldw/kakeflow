import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { markBackupVerified, RESTORE_TEST_INTERVAL_MS, RESTORE_TEST_NAG_MS, useRestoreTestReminder } from './restoreTestReminder'

const DAY = 24 * 60 * 60 * 1000
beforeEach(() => localStorage.clear())

describe('useRestoreTestReminder', () => {
  it('reminds when backups exist and none was ever verified, then stays quiet for the nag period', async () => {
    const onDue = vi.fn(); const hasBackups = vi.fn(async () => true)
    renderHook(() => useRestoreTestReminder(true, { hasBackups, onDue, now: () => 1_000_000 }))
    await waitFor(() => expect(onDue).toHaveBeenCalledTimes(1))
    renderHook(() => useRestoreTestReminder(true, { hasBackups, onDue, now: () => 1_000_000 + RESTORE_TEST_NAG_MS - 1 }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onDue).toHaveBeenCalledTimes(1)
    renderHook(() => useRestoreTestReminder(true, { hasBackups, onDue, now: () => 1_000_000 + RESTORE_TEST_NAG_MS }))
    await waitFor(() => expect(onDue).toHaveBeenCalledTimes(2))
  })

  it('stays silent after a recent verification and asks again once it is 90 days old', async () => {
    markBackupVerified(10 * DAY)
    const onDue = vi.fn(); const hasBackups = vi.fn(async () => true)
    renderHook(() => useRestoreTestReminder(true, { hasBackups, onDue, now: () => 10 * DAY + RESTORE_TEST_INTERVAL_MS - 1 }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(hasBackups).not.toHaveBeenCalled()
    renderHook(() => useRestoreTestReminder(true, { hasBackups, onDue, now: () => 10 * DAY + RESTORE_TEST_INTERVAL_MS }))
    await waitFor(() => expect(onDue).toHaveBeenCalledTimes(1))
  })

  it('does nothing without backups, when disabled, or when the lookup fails', async () => {
    const onDue = vi.fn()
    renderHook(() => useRestoreTestReminder(true, { hasBackups: async () => false, onDue, now: () => 5 }))
    renderHook(() => useRestoreTestReminder(false, { hasBackups: async () => true, onDue, now: () => 5 }))
    renderHook(() => useRestoreTestReminder(true, { hasBackups: async () => { throw new Error('x') }, onDue, now: () => 5 }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onDue).not.toHaveBeenCalled()
  })
})
