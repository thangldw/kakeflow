/**
 * Weekly reminder to keep an encrypted archive outside browser storage, which the browser may evict.
 * Everything is per-vault (`key` names the vault on this device) and best effort: storage can be blocked or empty.
 */

export const BACKUP_REMINDER_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

const exportedKey = (key: string) => `${key}:backup-exported-at`
const seenKey = (key: string) => `${key}:backup-first-seen-at`

function read(name: string): number | null {
  try {
    const raw = localStorage.getItem(name)
    if (raw === null) return null
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function write(name: string, value: number) {
  try {
    localStorage.setItem(name, String(value))
  } catch {
    // Without storage the reminder simply never shows.
  }
}

/** Remembers that an encrypted archive was just downloaded. */
export function recordBackupExport(key: string, now: number = Date.now()) {
  write(exportedKey(key), now)
}

/** When the last archive was downloaded from this browser, or null. */
export function lastBackupExport(key: string): number | null {
  return read(exportedKey(key))
}

/**
 * True when no archive was downloaded for {@link BACKUP_REMINDER_DAYS} days. A vault that has never been
 * backed up counts from the first time it was seen, so a brand-new vault is not nagged on day one.
 */
export function backupReminderDue(key: string, now: number = Date.now()): boolean {
  const exported = read(exportedKey(key))
  let anchor = exported
  if (anchor === null) {
    anchor = read(seenKey(key))
    if (anchor === null) {
      write(seenKey(key), now)
      return false
    }
  }
  return now - anchor >= BACKUP_REMINDER_DAYS * DAY_MS
}
