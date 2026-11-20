import { useEffect } from 'react'
import type { BackupFileCheckDto } from '../../platform/types'

export const BACKGROUND_BACKUP_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
const KEY = 'kakeflow:backup-integrity:last-run'

function readLastRun(): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    const value = raw === null || raw === undefined ? NaN : Number(raw)
    return Number.isFinite(value) ? value : null
  } catch { return null }
}

function writeLastRun(at: number): void {
  try { globalThis.localStorage?.setItem(KEY, String(at)) } catch { /* it simply runs again next time */ }
}

export interface BackgroundBackupCheckDeps {
  readonly run: () => Promise<readonly BackupFileCheckDto[]>
  /** Called only when a remembered backup is missing, changed or unreadable. */
  readonly onProblems: (problems: readonly BackupFileCheckDto[]) => void
  readonly now?: () => number
}

/** Re-reads remembered backup files once a week, quietly, and speaks up only when one is no longer intact. */
export function useBackgroundBackupCheck(enabled: boolean, deps: BackgroundBackupCheckDeps): void {
  const { run, onProblems, now = Date.now } = deps
  useEffect(() => {
    if (!enabled) return
    const last = readLastRun()
    const startedAt = now()
    if (last !== null && startedAt - last >= 0 && startedAt - last < BACKGROUND_BACKUP_CHECK_INTERVAL_MS) return
    let cancelled = false
    void (async () => {
      try {
        const results = await run()
        if (cancelled) return
        writeLastRun(startedAt)
        const problems = results.filter((item) => item.status !== 'OK')
        if (problems.length > 0) onProblems(problems)
      } catch { /* quiet by design */ }
    })()
    return () => { cancelled = true }
  }, [enabled, run, onProblems, now])
}
