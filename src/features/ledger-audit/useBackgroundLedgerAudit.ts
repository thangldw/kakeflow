import { useEffect } from 'react'
import type { LedgerAuditReportDto } from '../../platform/types'

/** How long the last clean check stays valid before the ledger is checked again quietly. */
export const BACKGROUND_AUDIT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

const KEY_PREFIX = 'kakeflow:ledger-audit:last-run:'

function readLastRun(householdId: string): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY_PREFIX + householdId)
    const value = raw === null || raw === undefined ? NaN : Number(raw)
    return Number.isFinite(value) ? value : null
  } catch { return null }
}

function writeLastRun(householdId: string, at: number): void {
  try { globalThis.localStorage?.setItem(KEY_PREFIX + householdId, String(at)) } catch { /* the check simply runs again next time */ }
}

export interface BackgroundLedgerAuditDeps {
  readonly run: (householdId: string) => Promise<LedgerAuditReportDto>
  /** Called only when the check found something; a clean ledger stays silent. */
  readonly onFindings: (report: LedgerAuditReportDto) => void
  readonly now?: () => number
}

/**
 * Runs the read-only ledger audit quietly once per interval while the app is open and tells the caller only
 * when it found a problem. It never changes data, and a failed run is silent and retried next time.
 */
export function useBackgroundLedgerAudit(householdId: string | null, enabled: boolean, deps: BackgroundLedgerAuditDeps): void {
  const { run, onFindings, now = Date.now } = deps
  useEffect(() => {
    if (!enabled || !householdId) return
    const last = readLastRun(householdId)
    const startedAt = now()
    if (last !== null && startedAt - last >= 0 && startedAt - last < BACKGROUND_AUDIT_INTERVAL_MS) return
    let cancelled = false
    void (async () => {
      try {
        const report = await run(householdId)
        if (cancelled) return
        writeLastRun(householdId, startedAt)
        if (!report.ok || report.findings.length > 0) onFindings(report)
      } catch { /* quiet by design */ }
    })()
    return () => { cancelled = true }
  }, [householdId, enabled, run, onFindings, now])
}
