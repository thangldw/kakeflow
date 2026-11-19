import { beforeEach, describe, expect, it } from 'vitest'
import { BACKUP_REMINDER_DAYS, backupReminderDue, lastBackupExport, recordBackupExport } from './backupReminder'

const DAY = 24 * 60 * 60 * 1000
const start = Date.UTC(2026, 10, 1)

describe('backup reminder', () => {
  beforeEach(() => localStorage.clear())

  it('does not nag a brand-new vault, then reminds after a week without a backup', () => {
    expect(backupReminderDue('v', start)).toBe(false)
    expect(backupReminderDue('v', start + (BACKUP_REMINDER_DAYS - 1) * DAY)).toBe(false)
    expect(backupReminderDue('v', start + BACKUP_REMINDER_DAYS * DAY)).toBe(true)
  })

  it('restarts the clock when an archive is downloaded', () => {
    backupReminderDue('v', start)
    recordBackupExport('v', start + 10 * DAY)
    expect(lastBackupExport('v')).toBe(start + 10 * DAY)
    expect(backupReminderDue('v', start + 12 * DAY)).toBe(false)
    expect(backupReminderDue('v', start + 17 * DAY)).toBe(true)
  })

  it('keeps vaults on one device apart', () => {
    backupReminderDue('a', start)
    recordBackupExport('b', start + 8 * DAY)
    expect(backupReminderDue('a', start + 8 * DAY)).toBe(true)
    expect(backupReminderDue('b', start + 9 * DAY)).toBe(false)
  })

  it('ignores corrupt values and blocked storage', () => {
    localStorage.setItem('v:backup-exported-at', 'nope')
    expect(lastBackupExport('v')).toBeNull()
    const original = Storage.prototype.getItem
    Storage.prototype.getItem = () => { throw new Error('blocked') }
    try {
      expect(backupReminderDue('v', start)).toBe(false)
      expect(() => recordBackupExport('v', start)).not.toThrow()
    } finally {
      Storage.prototype.getItem = original
    }
  })
})
