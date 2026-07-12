import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const desktop = vi.hoisted(() => ({
  listHouseholds: vi.fn(),
  listAccounts: vi.fn(),
  queryDashboard: vi.fn(),
  queryTransactions: vi.fn(),
  listCardSettlements: vi.fn(),
  confirmCardMatch: vi.fn(),
  stageBackupRestore: vi.fn(),
  restartForRestore: vi.fn(),
  listBudgets: vi.fn(),
  upsertBudget: vi.fn(),
  listSavingsGoals: vi.fn(),
  createSavingsGoal: vi.fn(),
  updateSavingsGoal: vi.fn(),
  deleteSavingsGoal: vi.fn(),
  startImport: vi.fn(),
  previewImport: vi.fn(),
  commitImport: vi.fn(),
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
      listHouseholds: desktop.listHouseholds,
      createHousehold: vi.fn(),
      listAccounts: desktop.listAccounts,
      queryDashboard: desktop.queryDashboard,
      listBudgets: desktop.listBudgets,
      upsertBudget: desktop.upsertBudget,
      listSavingsGoals: desktop.listSavingsGoals,
      createSavingsGoal: desktop.createSavingsGoal,
      updateSavingsGoal: desktop.updateSavingsGoal,
      deleteSavingsGoal: desktop.deleteSavingsGoal,
      queryTransactions: desktop.queryTransactions,
      importSummary: vi.fn(),
      startImport: desktop.startImport,
      previewImport: desktop.previewImport,
      commitImport: desktop.commitImport,
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
    localStorage.clear()
    desktop.listHouseholds.mockReset().mockResolvedValue([{ id: 'family', name: '田中家', baseCurrency: 'JPY', createdAt: '2026-07-01T00:00:00Z' }])
    desktop.listAccounts.mockReset().mockResolvedValue([
      { id: 'family-bank', name: '銀行', accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY' },
      { id: 'family-other-expense', name: 'その他', accountKind: 'EXPENSE', accountSubtype: 'OTHER', currency: 'JPY' },
      { id: 'family-income', name: '収入', accountKind: 'INCOME', accountSubtype: 'OTHER', currency: 'JPY' },
      { id: 'family-card', name: 'カード', accountKind: 'LIABILITY', accountSubtype: 'CREDIT_CARD', currency: 'JPY' },
    ])
    desktop.listCardSettlements.mockReset().mockResolvedValue([])
    desktop.confirmCardMatch.mockReset().mockResolvedValue({ statementId: 'statement-1', paymentId: 'payment-1', reconciliationStatus: 'FULLY_RECONCILED' })
    desktop.stageBackupRestore.mockReset().mockResolvedValue({ formatVersion: 2, entryCount: 4, plaintextBytes: 4096 })
    desktop.restartForRestore.mockReset().mockResolvedValue(undefined)
    desktop.listBudgets.mockReset().mockResolvedValue([])
    desktop.upsertBudget.mockReset().mockResolvedValue({ householdId: 'family', month: '2026-07', categoryAccountId: 'family-other-expense', categoryName: 'その他', budgetJpy: 50000, actualJpy: 0, remainingJpy: 50000 })
    desktop.listSavingsGoals.mockReset().mockResolvedValue([])
    desktop.createSavingsGoal.mockReset().mockResolvedValue({ id: 'goal', householdId: 'family', name: '旅行', targetJpy: 100000, savedJpy: 0, targetDate: '2027-07-01', status: 'ACTIVE', createdAt: '2026-07-01', updatedAt: '2026-07-01' })
    desktop.updateSavingsGoal.mockReset()
    desktop.deleteSavingsGoal.mockReset()
    desktop.startImport.mockReset().mockResolvedValue({ runId: 'run-1', documentId: 'document-1', status: 'REVIEW_REQUIRED', recordCount: 1, candidateCount: 1, reusedExisting: false })
    desktop.previewImport.mockReset().mockResolvedValue({
      summary: { runId: 'run-1', documentId: 'document-1', status: 'REVIEW_REQUIRED', recordCount: 1, candidateCount: 1, reusedExisting: false },
      source: { sourceType: 'MANUAL_UPLOAD', originalFilename: 'bank.csv', mediaType: 'text/csv', byteSize: 1, sha256: 'hash' },
      candidates: [{ id: 'candidate-1', accountId: 'family-bank', occurredOn: '2026-07-12', postedOn: null, amountJpy: 1200, direction: 'OUT', descriptionRaw: 'STORE', merchantRaw: 'STORE', externalTransactionId: null, extractionConfidenceBps: 10000, normalizationConfidenceBps: 10000, reviewStatus: 'READY', evidenceCount: 1, evidenceRoles: ['PRIMARY'], issues: [] }],
    })
    desktop.commitImport.mockReset().mockResolvedValue({ runId: 'run-1', postedCount: 1 })
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

  it('switches households and persists the active local selection', async () => {
    desktop.listHouseholds.mockResolvedValue([
      { id: 'family', name: '田中家', baseCurrency: 'JPY', createdAt: '2026-07-01T00:00:00Z' },
      { id: 'parents', name: '両親家', baseCurrency: 'JPY', createdAt: '2026-07-02T00:00:00Z' },
    ])
    render(<App />)
    await screen.findByText('生協')

    fireEvent.change(screen.getByLabelText('世帯を切り替える'), { target: { value: 'parents' } })

    await waitFor(() => expect(desktop.queryDashboard).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'parents' })))
    expect(localStorage.getItem('kakeflow.activeHouseholdId')).toBe('parents')
    expect(await screen.findByRole('heading', { name: '両親家の家計' })).toBeInTheDocument()
  })

  it('uses one persisted month for dashboard and ledger queries', async () => {
    render(<App />)
    await screen.findByText('生協')

    fireEvent.change(screen.getByLabelText('対象月'), { target: { value: '2026-06' } })

    await waitFor(() => expect(desktop.queryDashboard).toHaveBeenCalledWith(expect.objectContaining({ month: '2026-06' })))
    expect(localStorage.getItem('kakeflow.selectedMonth')).toBe('2026-06')
    fireEvent.click(screen.getByRole('button', { name: '取引' }))
    await waitFor(() => expect(desktop.queryTransactions).toHaveBeenCalledWith(expect.objectContaining({ fromDate: '2026-06-01', toDate: '2026-06-30' })))
  })

  it('paginates through more than one ledger page', async () => {
    desktop.queryTransactions.mockImplementation(async ({ page, pageSize }: { page: number; pageSize: number }) => ({
      items: [{ id: `transaction-${page}`, occurredOn: '2026-07-10', postedOn: null, transactionType: 'EXPENSE', payee: `店舗${page}`, description: null, amountJpy: 1000, status: 'POSTED' }],
      page, pageSize, totalItems: 26, totalPages: 2,
    }))
    render(<App />)
    await screen.findByText('店舗1')
    fireEvent.click(screen.getByRole('button', { name: '取引' }))

    fireEvent.click(await screen.findByRole('button', { name: '次へ' }))

    expect(await screen.findByText('店舗2')).toBeInTheDocument()
    await waitFor(() => expect(desktop.queryTransactions).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 25 })))
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
    fireEvent.click(screen.getByRole('button', { name: 'カード照合' }))

    expect(await screen.findByText('照合候補')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /金額と口座を確認して照合/ }))

    await waitFor(() => expect(desktop.confirmCardMatch).toHaveBeenCalledWith('family', 'statement-1', 'payment-1'))
    expect(await screen.findByText('請求と口座引落を照合済みにしました。')).toBeInTheDocument()
  })

  it('delegates restore selection and destructive confirmation to the native backend', async () => {
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: '設定' }))

    fireEvent.change(screen.getByLabelText('復元用パスフレーズ'), { target: { value: 'correct horse battery' } })
    fireEvent.change(screen.getByLabelText('復元用パスフレーズを確認'), { target: { value: 'correct horse battery' } })
    fireEvent.click(screen.getByRole('button', { name: 'バックアップを選択して復元' }))

    await waitFor(() => expect(desktop.stageBackupRestore).toHaveBeenCalledWith('correct horse battery'))
    expect(desktop.restartForRestore).toHaveBeenCalledOnce()
    expect(dialog.open).not.toHaveBeenCalled()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('creates persisted monthly budgets and savings goals', async () => {
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: '予算・目標' }))
    await screen.findByText('カテゴリー予算')

    fireEvent.change(screen.getByLabelText('予算カテゴリー'), { target: { value: 'family-other-expense' } })
    fireEvent.change(screen.getByLabelText('月間予算'), { target: { value: '50000' } })
    fireEvent.click(screen.getByRole('button', { name: '予算を保存' }))
    await waitFor(() => expect(desktop.upsertBudget).toHaveBeenCalledWith({ householdId: 'family', month: '2026-07', categoryAccountId: 'family-other-expense', budgetJpy: 50000 }))

    fireEvent.click(screen.getByRole('button', { name: '目標を追加' }))
    fireEvent.change(screen.getByLabelText('目標名'), { target: { value: '旅行' } })
    fireEvent.change(screen.getByLabelText('目標額'), { target: { value: '100000' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(desktop.createSavingsGoal).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'family', name: '旅行', targetJpy: 100000, status: 'ACTIVE' })))
  })

  it('requires explicit per-candidate approval before posting an import', async () => {
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File(['日付,摘要,支払い金額,預かり金額,差引残高\n2026/07/12,STORE,1200,,10000'], 'bank.csv', { type: 'text/csv' })
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(await screen.findByRole('button', { name: '取込開始' }))

    const commit = await screen.findByRole('button', { name: '承認済みを台帳へ反映' })
    expect(commit).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'STOREを承認' }))
    expect(commit).toBeEnabled()
    fireEvent.click(commit)

    await waitFor(() => expect(desktop.commitImport).toHaveBeenCalledWith('run-1', [expect.objectContaining({ candidateId: 'candidate-1', transactionType: 'EXPENSE' })]))
  })
})
