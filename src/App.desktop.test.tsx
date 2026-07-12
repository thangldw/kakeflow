import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const desktop = vi.hoisted(() => ({
  queryDashboard: vi.fn(),
  queryTransactions: vi.fn(),
  listCardSettlements: vi.fn(),
  confirmCardMatch: vi.fn(),
  stageBackupRestore: vi.fn(),
  restartForRestore: vi.fn(),
}))

const dialog = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }))

vi.mock('@tauri-apps/plugin-dialog', () => dialog)

vi.mock('./platform', async () => {
  const actual = await vi.importActual<typeof import('./platform')>('./platform')
  return {
    ...actual,
    platformClient: {
      runtime: 'tauri' as const,
      bootstrap: vi.fn().mockResolvedValue({ application: 'KakeFlow', database: { healthy: true, schemaVersion: 5 } }),
      listHouseholds: vi.fn().mockResolvedValue([{ id: 'family', name: '田中家', baseCurrency: 'JPY', createdAt: '2026-07-01T00:00:00Z' }]),
      createHousehold: vi.fn(),
      listAccounts: vi.fn().mockResolvedValue([]),
      queryDashboard: desktop.queryDashboard,
      queryTransactions: desktop.queryTransactions,
      importSummary: vi.fn(),
      startImport: vi.fn(),
      previewImport: vi.fn(),
      commitImport: vi.fn(),
      rollbackImport: vi.fn(),
      listCardSettlements: desktop.listCardSettlements,
      confirmCardMatch: desktop.confirmCardMatch,
      createBackup: vi.fn(),
      stageBackupRestore: desktop.stageBackupRestore,
      restartForRestore: desktop.restartForRestore,
      extractDocument: vi.fn(),
      ocrDocument: vi.fn(),
    },
  }
})

import App from './App'

describe('KakeFlow desktop read models', () => {
  beforeEach(() => {
    desktop.listCardSettlements.mockReset().mockResolvedValue([])
    desktop.confirmCardMatch.mockReset().mockResolvedValue({ statementId: 'statement-1', paymentId: 'payment-1', reconciliationStatus: 'FULLY_RECONCILED' })
    desktop.stageBackupRestore.mockReset().mockResolvedValue({ formatVersion: 2, entryCount: 4, plaintextBytes: 4096 })
    desktop.restartForRestore.mockReset().mockResolvedValue(undefined)
    dialog.open.mockReset().mockResolvedValue('/tmp/family.kakeflow-backup')
    dialog.save.mockReset().mockResolvedValue(null)
    desktop.queryDashboard.mockReset().mockImplementation(async ({ accountingBasis }: { accountingBasis: 'ACCRUAL' | 'CASH' }) => ({
      month: '2026-07', accountingBasis,
      incomeJpy: accountingBasis === 'ACCRUAL' ? 500_000 : 480_000,
      expenseJpy: accountingBasis === 'ACCRUAL' ? 120_000 : 204_987,
      savingsJpy: accountingBasis === 'ACCRUAL' ? 380_000 : 275_013,
      postedTransactionCount: 1,
      netWorthAsOf: '2026-07-31', assetsJpy: 620_000, liabilitiesJpy: 120_000, netWorthJpy: 500_000,
      accrualTrend: [{ month: '2026-07', incomeJpy: 500_000, expenseJpy: 120_000 }],
      expenseCategories: [{ accountId: 'family-other-expense', name: 'その他', amountJpy: 120_000 }],
    }))
    desktop.queryTransactions.mockReset().mockImplementation(async ({ accountingBasis, pageSize }: { accountingBasis: 'ACCRUAL' | 'CASH'; pageSize: number }) => ({
      items: accountingBasis === 'ACCRUAL'
        ? [{ id: 'purchase', occurredOn: '2026-07-10', postedOn: null, transactionType: 'CARD_PURCHASE', payee: '生協', description: '食料品', amountJpy: 120_000, status: 'POSTED' }]
        : [{ id: 'payment', occurredOn: '2026-07-27', postedOn: null, transactionType: 'CARD_PAYMENT', payee: 'Rakuten Card', description: '口座引落', amountJpy: 204_987, status: 'POSTED' }],
      page: 1, pageSize, totalItems: 1, totalPages: 1,
    }))
  })

  it('renders SQLite-backed monthly totals and recent transactions', async () => {
    render(<App />)

    expect(await screen.findByText('生協')).toBeInTheDocument()
    expect(screen.getAllByText('¥500,000').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('−¥120,000')).toBeInTheDocument()
    expect(screen.queryByText('¥8,246,320')).not.toBeInTheDocument()
    expect(desktop.queryDashboard).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'family', accountingBasis: 'ACCRUAL' }))
  })

  it('re-queries the ledger when switching to cash basis', async () => {
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: '取引' }))
    expect(await screen.findByText('生協')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '資金移動' }))

    expect(await screen.findByText('Rakuten Card')).toBeInTheDocument()
    await waitFor(() => expect(desktop.queryTransactions).toHaveBeenCalledWith(expect.objectContaining({ accountingBasis: 'CASH', householdId: 'family' })))
    expect(screen.getByText('現金流出 ¥204,987')).toBeInTheDocument()
  })

  it('renders and confirms a persisted card-payment match', async () => {
    desktop.listCardSettlements.mockResolvedValue([{
      id: 'statement-1', cardAccountId: 'family-rakuten-card', cardName: 'Rakuten Card', maskedIdentifier: '•••• 8106',
      periodStart: '2026-06-01', periodEnd: '2026-06-30', paymentDueOn: null,
      statementAmountJpy: 204_987, detailAmountJpy: 204_987, lineCount: 15,
      paymentId: 'payment-1', bankTransactionId: 'bank-payment', paymentAmountJpy: 204_987,
      paymentOn: '2026-07-27', matchScoreBps: 8000, reconciliationStatus: 'POSSIBLE_MATCH',
    }])
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'カード照合 1' }))

    expect(await screen.findByText('照合候補')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /金額と口座を確認して照合/ }))

    await waitFor(() => expect(desktop.confirmCardMatch).toHaveBeenCalledWith('family', 'statement-1', 'payment-1'))
    expect(await screen.findByText('請求と口座引落を照合済みにしました。')).toBeInTheDocument()
  })

  it('stages an authenticated restore only after explicit replacement confirmation', async () => {
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: '設定' }))

    fireEvent.change(screen.getByLabelText('復元用パスフレーズ'), { target: { value: 'correct horse battery' } })
    fireEvent.change(screen.getByLabelText('復元用パスフレーズを確認'), { target: { value: 'correct horse battery' } })
    fireEvent.click(screen.getByRole('button', { name: 'バックアップを選択して復元' }))

    expect(await screen.findByText('現在のデータが置き換わることを確認してください。')).toBeInTheDocument()
    expect(dialog.open).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox', { name: /現在のデータが置き換わり/ }))
    fireEvent.click(screen.getByRole('button', { name: 'バックアップを選択して復元' }))

    await waitFor(() => expect(desktop.stageBackupRestore).toHaveBeenCalledWith('/tmp/family.kakeflow-backup', 'correct horse battery'))
    expect(desktop.restartForRestore).toHaveBeenCalledOnce()
    expect(dialog.open).toHaveBeenCalledWith(expect.objectContaining({ multiple: false, directory: false }))
  })
})
