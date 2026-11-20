import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LedgerAuditReportDto } from '../../platform/types'
import { BACKGROUND_AUDIT_INTERVAL_MS, useBackgroundLedgerAudit } from './useBackgroundLedgerAudit'

const clean: LedgerAuditReportDto = { postedTransactions: 3, journalEntries: 6, findings: [], truncated: false, ok: true }
const dirty: LedgerAuditReportDto = { ...clean, ok: false, findings: [{ kind: 'UNBALANCED', transactionId: 't', detail: 'x' } as never] }

beforeEach(() => { localStorage.clear() })

describe('useBackgroundLedgerAudit', () => {
  it('stays silent when the ledger is clean and remembers the run', async () => {
    const run = vi.fn(async () => clean); const onFindings = vi.fn()
    renderHook(() => useBackgroundLedgerAudit('h', true, { run, onFindings, now: () => 1_000 }))
    await waitFor(() => expect(localStorage.getItem('kakeflow:ledger-audit:last-run:h')).toBe('1000'))
    expect(onFindings).not.toHaveBeenCalled()
  })

  it('reports only when there are findings', async () => {
    const onFindings = vi.fn()
    renderHook(() => useBackgroundLedgerAudit('h', true, { run: async () => dirty, onFindings, now: () => 5 }))
    await waitFor(() => expect(onFindings).toHaveBeenCalledWith(dirty))
  })

  it('does not run again inside the interval but does after it', async () => {
    const run = vi.fn(async () => clean)
    localStorage.setItem('kakeflow:ledger-audit:last-run:h', '1000')
    const first = renderHook(() => useBackgroundLedgerAudit('h', true, { run, onFindings: vi.fn(), now: () => 1_000 + BACKGROUND_AUDIT_INTERVAL_MS - 1 }))
    await Promise.resolve()
    expect(run).not.toHaveBeenCalled()
    first.unmount()
    renderHook(() => useBackgroundLedgerAudit('h', true, { run, onFindings: vi.fn(), now: () => 1_000 + BACKGROUND_AUDIT_INTERVAL_MS }))
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
  })

  it('does nothing when disabled or without a household', async () => {
    const run = vi.fn(async () => clean)
    renderHook(() => useBackgroundLedgerAudit('h', false, { run, onFindings: vi.fn() }))
    renderHook(() => useBackgroundLedgerAudit(null, true, { run, onFindings: vi.fn() }))
    await Promise.resolve()
    expect(run).not.toHaveBeenCalled()
  })

  it('swallows a failed run and does not record it, so it retries next time', async () => {
    const onFindings = vi.fn()
    renderHook(() => useBackgroundLedgerAudit('h', true, { run: async () => { throw new Error('x') }, onFindings }))
    await Promise.resolve(); await Promise.resolve()
    expect(localStorage.getItem('kakeflow:ledger-audit:last-run:h')).toBeNull()
    expect(onFindings).not.toHaveBeenCalled()
  })
})
