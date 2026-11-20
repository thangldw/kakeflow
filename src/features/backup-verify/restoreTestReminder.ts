import { useEffect } from 'react'

/** A backup nobody has tried to open is a hope, not a backup: ask for a test restore this often. */
export const RESTORE_TEST_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000
/** After asking, stay quiet this long even if the test is still not done. */
export const RESTORE_TEST_NAG_MS = 14 * 24 * 60 * 60 * 1000

const VERIFIED_KEY = 'kakeflow:backup-verify:last-ok'
const REMINDED_KEY = 'kakeflow:backup-verify:last-reminded'

function read(key: string): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    const value = raw === null || raw === undefined ? NaN : Number(raw)
    return Number.isFinite(value) ? value : null
  } catch { return null }
}

function write(key: string, at: number): void {
  try { globalThis.localStorage?.setItem(key, String(at)) } catch { /* the reminder simply comes again */ }
}

/** Remember that a backup was just proven restorable (called after a successful "verify backup"). */
export function markBackupVerified(at: number = Date.now()): void { write(VERIFIED_KEY, at) }

export interface RestoreTestReminderDeps {
  /** Whether this device has written at least one backup; there is nothing to test otherwise. */
  readonly hasBackups: () => Promise<boolean>
  readonly onDue: () => void
  readonly now?: () => number
}

/** Quietly reminds the user to test-restore a backup when none has been proven restorable for 90 days. */
export function useRestoreTestReminder(enabled: boolean, deps: RestoreTestReminderDeps): void {
  const { hasBackups, onDue, now = Date.now } = deps
  useEffect(() => {
    if (!enabled) return
    const at = now()
    const verified = read(VERIFIED_KEY)
    if (verified !== null && at - verified >= 0 && at - verified < RESTORE_TEST_INTERVAL_MS) return
    const reminded = read(REMINDED_KEY)
    if (reminded !== null && at - reminded >= 0 && at - reminded < RESTORE_TEST_NAG_MS) return
    let cancelled = false
    void (async () => {
      try {
        if (!(await hasBackups()) || cancelled) return
        write(REMINDED_KEY, at)
        onDue()
      } catch { /* quiet by design */ }
    })()
    return () => { cancelled = true }
  }, [enabled, hasBackups, onDue, now])
}
