import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LedgerAuditReportDto } from '../../platform/types'
import { LedgerAuditPanel } from './LedgerAuditPanel'

afterEach(cleanup)

const clean: LedgerAuditReportDto = { postedTransactions: 12, journalEntries: 30, findings: [], truncated: false, ok: true }
const dirty: LedgerAuditReportDto = {
  postedTransactions: 12, journalEntries: 30, truncated: true, ok: false,
  findings: [{ kind: 'UNBALANCED_JOURNAL', transactionId: 't1', occurredOn: '2026-11-01', debitTotalJpy: 1000, creditTotalJpy: 900 }],
}

describe('LedgerAuditPanel', () => {
  it('runs on demand and reports a clean ledger', async () => {
    const run = vi.fn(async () => clean)
    render(<LedgerAuditPanel run={run} />)
    expect(run).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'チェックを実行' }))
    expect(await screen.findByText('問題は見つかりませんでした。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '取引を開く' })).toBeNull()
  })

  it('lists findings with totals, notes truncation and offers to open transactions', async () => {
    const onOpenTransactions = vi.fn()
    render(<LedgerAuditPanel run={async () => dirty} onOpenTransactions={onOpenTransactions} />)
    fireEvent.click(screen.getByRole('button', { name: 'チェックを実行' }))
    expect(await screen.findByText('借方と貸方が一致しません')).toBeTruthy()
    expect(screen.getByText('¥1,000 / ¥900')).toBeTruthy()
    expect(screen.getByText('見つかった問題が多いため、一部のみ表示しています。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取引を開く' }))
    expect(onOpenTransactions).toHaveBeenCalled()
  })

  it('shows an error when the audit cannot run', async () => {
    render(<LedgerAuditPanel run={async () => { throw new Error('x') }} />)
    fireEvent.click(screen.getByRole('button', { name: 'チェックを実行' }))
    expect(await screen.findByText('チェックを実行できませんでした。')).toBeTruthy()
  })
})
