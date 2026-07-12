import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const desktop = vi.hoisted(() => ({
  listHouseholds: vi.fn(),
  listHouseholdMembers: vi.fn(),
  createHouseholdMember: vi.fn(),
  updateHouseholdMember: vi.fn(),
  archiveHouseholdMember: vi.fn(),
  listAccounts: vi.fn(),
  queryDashboard: vi.fn(),
  queryTransactions: vi.fn(),
  createManualTransaction: vi.fn(),
  getTransactionDetail: vi.fn(),
  updateTransaction: vi.fn(),
  listTransactionSourceRecords: vi.fn(),
  updateSourceDocumentAudience: vi.fn(),
  listWatchedFolders: vi.fn(),
  selectWatchedFolder: vi.fn(),
  removeWatchedFolder: vi.fn(),
  scanWatchedFolder: vi.fn(),
  readWatchedFile: vi.fn(),
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
  createAccount: vi.fn(),
  renameAccount: vi.fn(),
  archiveAccount: vi.fn(),
  updateAccountOwnership: vi.fn(),
  listClassificationRules: vi.fn(),
  createClassificationRule: vi.fn(),
  updateClassificationRule: vi.fn(),
  deleteClassificationRule: vi.fn(),
  previewClassificationRules: vi.fn(),
  applyClassificationRule: vi.fn(),
}))

const dialog = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }))
const nativeInvoke = vi.hoisted(() => vi.fn())
const accountGroupState = vi.hoisted(() => ({ groups: [] as Array<{ id: string; householdId: string; name: string; groupKind: string; sortOrder: number; accountIds: string[]; createdAt: string; updatedAt: string }> }))

vi.mock('@tauri-apps/plugin-dialog', () => dialog)
vi.mock('@tauri-apps/api/core', () => ({ invoke: nativeInvoke }))

vi.mock('./platform', async () => {
  const actual = await vi.importActual<typeof import('./platform')>('./platform')
  return {
    ...actual,
    platformClient: {
      runtime: 'tauri' as const,
      bootstrap: vi.fn().mockResolvedValue({ application: 'KakeFlow', database: { healthy: true, schemaVersion: 5 } }),
      listHouseholds: desktop.listHouseholds,
      createHousehold: vi.fn(),
      listHouseholdMembers: desktop.listHouseholdMembers,
      createHouseholdMember: desktop.createHouseholdMember,
      updateHouseholdMember: desktop.updateHouseholdMember,
      archiveHouseholdMember: desktop.archiveHouseholdMember,
      listAccounts: desktop.listAccounts,
      createAccount: desktop.createAccount,
      renameAccount: desktop.renameAccount,
      archiveAccount: desktop.archiveAccount,
      updateAccountOwnership: desktop.updateAccountOwnership,
      queryDashboard: desktop.queryDashboard,
      listBudgets: desktop.listBudgets,
      upsertBudget: desktop.upsertBudget,
      listSavingsGoals: desktop.listSavingsGoals,
      createSavingsGoal: desktop.createSavingsGoal,
      updateSavingsGoal: desktop.updateSavingsGoal,
      deleteSavingsGoal: desktop.deleteSavingsGoal,
      queryTransactions: desktop.queryTransactions,
      createManualTransaction: desktop.createManualTransaction,
      getTransactionDetail: desktop.getTransactionDetail,
      updateTransaction: desktop.updateTransaction,
      listTransactionSourceRecords: desktop.listTransactionSourceRecords,
      updateSourceDocumentAudience: desktop.updateSourceDocumentAudience,
      listWatchedFolders: desktop.listWatchedFolders,
      selectWatchedFolder: desktop.selectWatchedFolder,
      removeWatchedFolder: desktop.removeWatchedFolder,
      scanWatchedFolder: desktop.scanWatchedFolder,
      readWatchedFile: desktop.readWatchedFile,
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
      listClassificationRules: desktop.listClassificationRules,
      createClassificationRule: desktop.createClassificationRule,
      updateClassificationRule: desktop.updateClassificationRule,
      deleteClassificationRule: desktop.deleteClassificationRule,
      previewClassificationRules: desktop.previewClassificationRules,
      applyClassificationRule: desktop.applyClassificationRule,
    },
  }
})

import App from './App'

describe('KakeFlow desktop read models', () => {
  beforeEach(() => {
    localStorage.clear()
    accountGroupState.groups = []
    desktop.listHouseholds.mockReset().mockResolvedValue([{ id: 'family', name: '田中家', baseCurrency: 'JPY', createdAt: '2026-07-01T00:00:00Z' }])
    desktop.listHouseholdMembers.mockReset().mockResolvedValue([{ id: 'taro', householdId: 'family', displayName: '太郎', relationshipLabel: '父', status: 'ACTIVE', sortOrder: 0, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z' }])
    desktop.createHouseholdMember.mockReset().mockImplementation(async (input) => ({ ...input, status: 'ACTIVE', sortOrder: 1, createdAt: '2026-07-13T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z' }))
    desktop.updateHouseholdMember.mockReset().mockImplementation(async (input) => ({ ...input, id: input.memberId, status: 'ACTIVE', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z' }))
    desktop.archiveHouseholdMember.mockReset().mockResolvedValue(undefined)
    desktop.listAccounts.mockReset().mockResolvedValue([
      { id: 'family-bank', name: '銀行', accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY', ownershipKind: 'MEMBER', ownerMemberId: 'taro', ownerMemberName: '太郎', visibility: 'PERSONAL' },
      { id: 'family-other-expense', name: 'その他', accountKind: 'EXPENSE', accountSubtype: 'OTHER', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
      { id: 'family-income', name: '収入', accountKind: 'INCOME', accountSubtype: 'OTHER', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
      { id: 'family-card', name: 'カード', accountKind: 'LIABILITY', accountSubtype: 'CREDIT_CARD', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
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
      source: { sourceType: 'MANUAL_UPLOAD', originalFilename: 'bank.csv', mediaType: 'text/csv', byteSize: 1, sha256: 'hash', audienceVisibility: 'SHARED', audienceMemberId: null },
      candidates: [{ id: 'candidate-1', accountId: 'family-bank', occurredOn: '2026-07-12', postedOn: null, amountJpy: 1200, direction: 'OUT', descriptionRaw: 'STORE', merchantRaw: 'STORE', externalTransactionId: null, extractionConfidenceBps: 10000, normalizationConfidenceBps: 10000, attributionKind: 'HOUSEHOLD', attributedMemberId: null, audienceVisibility: 'SHARED', audienceMemberId: null, reviewStatus: 'READY', evidenceCount: 1, evidenceRoles: ['PRIMARY'], issues: [] }],
    })
    desktop.commitImport.mockReset().mockResolvedValue({ runId: 'run-1', postedCount: 1 })
    desktop.createAccount.mockReset().mockResolvedValue({ id: 'new-bank', name: 'ゆうちょ銀行', accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' })
    desktop.renameAccount.mockReset()
    desktop.archiveAccount.mockReset()
    desktop.updateAccountOwnership.mockReset()
    desktop.createManualTransaction.mockReset().mockResolvedValue({ id: 'manual', occurredOn: '2026-07-12', postedOn: null, transactionType: 'EXPENSE', payee: '八百屋', description: null, amountJpy: 1500, status: 'POSTED', debitAccountId: 'family-other-expense', debitAccountName: 'その他', creditAccountId: 'family-bank', creditAccountName: '銀行', categoryAccountId: 'family-other-expense', categoryName: 'その他', attributionKind: 'HOUSEHOLD', attributedMemberId: null, attributedMemberName: null, audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null })
    desktop.getTransactionDetail.mockReset().mockResolvedValue({ id: 'purchase', householdId: 'family', occurredOn: '2026-07-10', postedOn: null, transactionType: 'CARD_PURCHASE', payee: '生協', description: '食料品', attributionKind: 'HOUSEHOLD', attributedMemberId: null, attributedMemberName: null, audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null, status: 'POSTED', createdAt: '2026-07-10T00:00:00Z', updatedAt: '2026-07-10T00:00:00Z', editable: true, entries: [{ id: 'debit', accountId: 'family-other-expense', accountName: 'その他', accountKind: 'EXPENSE', side: 'DEBIT', amountJpy: 120000, lineNumber: 1 }, { id: 'credit', accountId: 'family-card', accountName: 'カード', accountKind: 'LIABILITY', side: 'CREDIT', amountJpy: 120000, lineNumber: 2 }], sourceEvidence: [{ sourceRecordId: 'record', sourceDocumentId: 'document', sourceType: 'MANUAL_UPLOAD', originalFilename: 'card.csv', mediaType: 'text/csv', rowNumber: 2, importedAt: '2026-07-12T00:00:00Z', evidenceRole: 'PRIMARY', audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null }] })
    desktop.updateTransaction.mockReset().mockImplementation(async (input) => ({ ...(await desktop.getTransactionDetail()), ...input, id: input.transactionId }))
    desktop.listTransactionSourceRecords.mockReset().mockResolvedValue([{ id: 'record', sourceDocumentId: 'document', rowNumber: 2, recordHash: 'hash', payloadJson: '{"merchant":"生協","amount":120000}', createdAt: '2026-07-12T00:00:00Z', evidenceRole: 'PRIMARY' }])
    desktop.updateSourceDocumentAudience.mockReset().mockImplementation(async (input) => ({ id: input.sourceDocumentId, householdId: input.householdId, importRunId: 'run-1', sourceType: 'MANUAL_UPLOAD', originalFilename: 'card.csv', mediaType: 'text/csv', byteSize: 100, sha256: 'hash', sourceModifiedAt: null, importedAt: '2026-07-12T00:00:00Z', adapterId: 'card', adapterVersion: '1', recordCount: 1, audienceVisibility: input.audienceVisibility, audienceMemberId: input.audienceMemberId, audienceMemberName: input.audienceMemberId ? '太郎' : null }))
    desktop.listClassificationRules.mockReset().mockResolvedValue([])
    desktop.createClassificationRule.mockReset().mockImplementation(async (input) => ({ ...input, categoryName: 'その他', createdAt: '2026-07-13T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z' }))
    desktop.updateClassificationRule.mockReset()
    desktop.deleteClassificationRule.mockReset().mockResolvedValue(undefined)
    desktop.previewClassificationRules.mockReset().mockResolvedValue({ winningRuleId: null, matches: [] })
    desktop.applyClassificationRule.mockReset()
    desktop.listWatchedFolders.mockReset().mockResolvedValue([])
    desktop.selectWatchedFolder.mockReset().mockResolvedValue(null)
    desktop.removeWatchedFolder.mockReset().mockResolvedValue(undefined)
    desktop.scanWatchedFolder.mockReset().mockResolvedValue({ watchedFolderId: 'folder', files: [] })
    desktop.readWatchedFile.mockReset()
    dialog.open.mockReset().mockResolvedValue('/tmp/family.kakeflow-backup')
    dialog.save.mockReset().mockResolvedValue(null)
    nativeInvoke.mockReset().mockImplementation(async (command: string, args?: { groupId?: string }) => {
      const quality = { totalImports: 1, postedImports: 1, reviewRequiredImports: 0, failedImports: 0, inProgressImports: 0, importCompletionBps: 10000, latestImportedAt: '2026-07-12T00:00:00Z', staleDays: 1, hasUnresolvedImports: false }
      const budget = { budgetJpy: 150000, actualJpy: 120000, remainingJpy: 30000, utilizationBps: 8000, categoryCount: 4, overBudgetCount: 0 }
      const goals = { activeCount: 1, targetJpy: 1000000, savedJpy: 400000, remainingJpy: 600000, dueWithinPeriodCount: 0 }
      const metrics = { incomeJpy: 500000, expenseJpy: 120000, savingsJpy: 380000, savingsRateBps: 7600, postedTransactionCount: 1 }
      const deltas = { income: { amountJpy: 10000, rateBps: 204 }, expense: { amountJpy: -5000, rateBps: -400 }, savings: { amountJpy: 15000, rateBps: 411 } }
      if (command === 'financial_calendar_query') return { month: '2026-07', asOf: '2026-07-31', days: [{ date: '2026-07-10', accrualIncomeJpy: 0, accrualExpenseJpy: 120000, cashInflowJpy: 0, cashOutflowJpy: 0, postedTransactionCount: 1, noSpendDay: false, events: [] }], budget, goals, dataQuality: quality }
      if (command === 'financial_report_monthly_query') return { period: '2026-07', current: metrics, priorMonth: { ...metrics, expenseJpy: 125000 }, priorYear: { ...metrics, incomeJpy: 490000 }, vsPriorMonth: deltas, vsPriorYear: deltas, topCategoryDrivers: [{ id: 'food', name: '食費', currentJpy: 70000, previousJpy: 60000, deltaJpy: 10000 }], topMerchantDrivers: [{ merchant: '生協', currentJpy: 50000, previousJpy: 40000, deltaJpy: 10000 }], budget, goals, dataQuality: quality, reconciliation: { totalStatements: 1, fullyReconciled: 1, possibleMatches: 0, partiallyReconciled: 0, unmatched: 0, mismatchCount: 0, paymentTotalJpy: 204987 } }
      if (command === 'forecast_action_query') return { asOf: '2026-07-31', forecastFrom: '2026-08', forecastThrough: '2026-10', openingCashJpy: 620000, assumptions: { historyFrom: '2026-04', historyThrough: '2026-06', historyMonths: 3, averageMonthlyIncomeJpy: 500000, averageMonthlyExpenseJpy: 120000, averageMonthlyNonRecurringExpenseJpy: 100000, averageMonthlyCashChangeBeforeCardPaymentsJpy: 300000, recurringMonthlyExpenseJpy: 20000, recurringItemCount: 2, reasons: ['確定台帳の直近3か月平均'] }, months: ['2026-08', '2026-09', '2026-10'].map((month, index) => ({ month, openingCashJpy: 620000 + index * 250000, projectedIncomeJpy: 500000, projectedNonRecurringExpenseJpy: 100000, projectedRecurringExpenseJpy: 20000, projectedSavingsJpy: 380000, projectedCashChangeBeforeCardPaymentsJpy: 300000, knownCardPaymentsJpy: 50000, projectedCashChangeJpy: 250000, closingCashJpy: 870000 + index * 250000 })), actions: [{ id: 'budget-food', kind: 'BUDGET_OVERRUN', priority: 'HIGH', title: '食費予算を超過', detail: '予算を確認してください', dueOn: null, amountJpy: 12000, entityId: 'food', reasons: ['確定支出が予算を超えました'] }] }
      if (command === 'financial_intelligence_query') return { asOf: '2026-07-31', historyFrom: '2025-07-31', recurringItems: [], anomalies: [] }
      if (command === 'fixed_cost_review_query') {
        const monthlyPoints = [9000, 10000, 11000, 12000, 13000, 14000].map((totalJpy, index) => ({ month: `2026-${String(index + 1).padStart(2, '0')}`, totalJpy, recurringPayeeCount: 1, transactionCount: 1 }))
        return { asOf: '2026-07-31', historyFrom: '2026-01-01', historyThrough: '2026-06-30', monthlyPoints, segments: [{ segment: 'MOBILE', monthlyPoints, recentThreeAverageJpy: 13000, previousThreeAverageJpy: 10000, changeJpy: 3000, changeRateBps: 3000, annualizedJpy: 156000, recurringPayeeCount: 1, transactionCount: 6, latestPaymentOn: '2026-06-20', topPayees: [{ normalizedPayee: 'mobile', displayPayee: 'Mobile Co', expenseCategoryNames: ['通信費'], cadence: 'MONTHLY', typicalAmountJpy: 13000, latestAmountJpy: 14000, latestPaymentOn: '2026-06-20', occurrenceCount: 6, confidenceBps: 9600, reasons: ['毎月の支払い'] }], reasons: ['直近3か月平均が増加'] }], totals: { recentThreeAverageJpy: 13000, previousThreeAverageJpy: 10000, changeJpy: 3000, changeRateBps: 3000, annualizedJpy: 156000, recurringPayeeCount: 1, transactionCount: 6 }, coverage: { completeMonthCount: 6, observedMonthCount: 12, confirmedTransactionCount: 100, recurringTransactionCount: 6, unclassifiedRecurringPayeeCount: 0 }, limitations: ['確定済み取引のみ'] }
      }
      if (command === 'export_csv_save') return { fileName: 'transactions.csv', rowCount: 1, byteSize: 100 }
      if (command === 'delimited_parser_profiles_list') return [{ id: 'custom-bank', householdId: 'family', name: 'Local bank CSV', delimiter: 'COMMA', encoding: 'UTF8', headerRow: 1, dateColumn: 'Date', dateFormat: 'YYYY_MM_DD', descriptionColumn: 'Description', payeeColumn: null, amountMode: 'SIGNED', signedPositiveDirection: 'IN', signedAmountColumn: 'Amount', debitColumn: null, creditColumn: null, externalIdColumn: null, accountHintColumn: 'Account', isEnabled: true, priority: 50, version: 2, createdAt: '2026-07-13T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z' }]
      if (command === 'account_groups_list') return accountGroupState.groups
      if (command === 'account_group_delete') {
        const deletedId = args?.groupId
        accountGroupState.groups = accountGroupState.groups.filter((group) => group.id !== deletedId)
        return null
      }
      throw new Error(`Unexpected native command: ${command}`)
    })
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
        ? [{ id: 'purchase', occurredOn: '2026-07-10', postedOn: null, transactionType: 'CARD_PURCHASE', payee: '生協', description: '食料品', amountJpy: 120_000, status: 'POSTED', attributionKind: 'HOUSEHOLD', attributedMemberId: null, attributedMemberName: null, audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null }]
        : [{ id: 'payment', occurredOn: '2026-07-27', postedOn: null, transactionType: 'CARD_PAYMENT', payee: 'Rakuten Card', description: '口座引落', amountJpy: 204_987, status: 'POSTED', attributionKind: 'HOUSEHOLD', attributedMemberId: null, attributedMemberName: null, audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null }],
      page: 1, pageSize, totalItems: 1, totalPages: 1,
    }))
  })

  it('renders SQLite-backed monthly totals and recent transactions', async () => {
    render(<App />)

    expect(await screen.findByText('生協')).toBeInTheDocument()
    expect(screen.getAllByText('¥500,000').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('−¥120,000')).toBeInTheDocument()
    expect(screen.getAllByText('帰属: 世帯共通').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('表示: 共有').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('¥8,246,320')).not.toBeInTheDocument()
    expect(desktop.queryDashboard).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'family', accountingBasis: 'ACCRUAL' }))
  })

  it('persists and forwards the global attribution scope while disclosing household-wide metrics', async () => {
    const view = render(<App />)
    await screen.findByText('生協')
    const selector = await screen.findByLabelText('集計対象') as HTMLSelectElement
    fireEvent.change(selector, { target: { value: 'MEMBER:taro' } })

    const memberScope = { kind: 'MEMBER', memberId: 'taro' }
    await waitFor(() => expect(desktop.queryDashboard).toHaveBeenCalledWith(expect.objectContaining({ attributionScope: memberScope })))
    expect(desktop.queryTransactions).toHaveBeenCalledWith(expect.objectContaining({ attributionScope: memberScope }))
    expect(screen.getByText(/純資産・資産残高・貯蓄目標・インポート状況は世帯全体です/)).toHaveTextContent('集計対象: 太郎')
    expect(JSON.parse(localStorage.getItem('kakeflow.attributionScopes') ?? '{}')).toEqual({ family: memberScope })

    fireEvent.click(screen.getByRole('button', { name: 'カレンダー・レポート' }))
    await screen.findByText('Financial Calendar')
    await waitFor(() => expect(nativeInvoke).toHaveBeenCalledWith('financial_calendar_query', { request: expect.objectContaining({ attributionScope: memberScope }) }))
    expect(nativeInvoke).toHaveBeenCalledWith('financial_report_monthly_query', { request: expect.objectContaining({ attributionScope: memberScope }) })
    expect(nativeInvoke).toHaveBeenCalledWith('forecast_action_query', { request: expect.objectContaining({ attributionScope: memberScope }) })

    fireEvent.click(screen.getByRole('tab', { name: /定期・異常/ }))
    await waitFor(() => expect(nativeInvoke).toHaveBeenCalledWith('financial_intelligence_query', { request: expect.objectContaining({ attributionScope: memberScope }) }))
    fireEvent.click(screen.getByRole('tab', { name: /固定費/ }))
    expect(await screen.findByText(/市場相場に基づく節約可能額は算出していません/)).toBeInTheDocument()
    await waitFor(() => expect(nativeInvoke).toHaveBeenCalledWith('fixed_cost_review_query', { request: expect.objectContaining({ householdId: 'family', attributionScope: memberScope, asOf: '2026-07-31' }) }))
    fireEvent.click(screen.getByRole('tab', { name: /グループ・出力/ }))
    fireEvent.click(await screen.findByRole('button', { name: '保存先を選んでCSV出力' }))
    await waitFor(() => expect(nativeInvoke).toHaveBeenCalledWith('export_csv_save', { request: expect.objectContaining({ attributionScope: memberScope }) }))

    view.unmount()
    render(<App />)
    await screen.findByText('生協')
    await waitFor(() => expect(screen.getByLabelText('集計対象')).toHaveValue('MEMBER:taro'))
    fireEvent.change(screen.getByLabelText('集計対象'), { target: { value: 'HOUSEHOLD_COMMON' } })
    await waitFor(() => expect(desktop.queryTransactions).toHaveBeenCalledWith(expect.objectContaining({ attributionScope: { kind: 'HOUSEHOLD_COMMON' } })))
  })

  it('persists one global account scope across month and page changes, defaults export to it, and resets after deletion', async () => {
    accountGroupState.groups = [{
      id: 'daily', householdId: 'family', name: '生活費', groupKind: 'DAILY_SPENDING', sortOrder: 0,
      accountIds: ['family-bank', 'family-card'], createdAt: '2026-07-13T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z',
    }]
    const { container } = render(<App />)
    await screen.findByText('生協')
    const scope = await screen.findByLabelText('口座スコープ') as HTMLSelectElement
    await waitFor(() => expect(scope).toHaveDisplayValue('すべての口座'))
    fireEvent.change(scope, { target: { value: 'daily' } })

    await waitFor(() => expect(desktop.queryDashboard).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'family', accountGroupId: 'daily' })))
    expect(localStorage.getItem('kakeflow.accountScope')).toContain('daily')
    expect(container.querySelector('.scope-footnote')).toHaveTextContent('口座スコープ: 生活費')

    fireEvent.change(screen.getByLabelText('対象月'), { target: { value: '2026-08' } })
    fireEvent.click(screen.getByRole('button', { name: '取引' }))
    await waitFor(() => expect(desktop.queryTransactions).toHaveBeenCalledWith(expect.objectContaining({ accountGroupId: 'daily', fromDate: '2026-08-01' })))
    expect(scope).toHaveValue('daily')

    fireEvent.click(screen.getByRole('button', { name: 'カレンダー・レポート' }))
    await screen.findByText('Financial Calendar')
    await waitFor(() => expect(nativeInvoke).toHaveBeenCalledWith('financial_calendar_query', { request: expect.objectContaining({ accountGroupId: 'daily' }) }))
    fireEvent.click(screen.getByRole('tab', { name: /グループ・出力/ }))
    expect(await screen.findByLabelText('エクスポートグループ')).toHaveValue('daily')

    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => expect(scope).toHaveValue(''))
    expect(localStorage.getItem('kakeflow.accountScope')).toBeNull()
    expect(container.querySelector('.scope-footnote')).toHaveTextContent('口座スコープ: すべての口座')
  })

  it('loads the financial calendar and monthly report from native read models', async () => {
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'カレンダー・レポート' }))

    expect(await screen.findByText('Financial Calendar')).toBeInTheDocument()
    expect(screen.getByText('No-spend days')).toBeInTheDocument()
    expect(nativeInvoke).toHaveBeenCalledWith('financial_calendar_query', expect.any(Object))

    fireEvent.click(screen.getByRole('tab', { name: /月次レポート/ }))
    expect(await screen.findByText('Monthly Review')).toBeInTheDocument()
    expect(screen.getByText('食費')).toBeInTheDocument()
    expect(nativeInvoke).toHaveBeenCalledWith('financial_report_monthly_query', expect.any(Object))

    fireEvent.click(screen.getByRole('tab', { name: /予測・アクション/ }))
    expect(await screen.findByText('現金・貯蓄予測')).toBeInTheDocument()
    expect(screen.getByText('食費予算を超過')).toBeInTheDocument()
    expect(nativeInvoke).toHaveBeenCalledWith('forecast_action_query', expect.any(Object))
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
    accountGroupState.groups = [{
      id: 'daily', householdId: 'family', name: '生活費', groupKind: 'DAILY_SPENDING', sortOrder: 0,
      accountIds: ['family-bank'], createdAt: '2026-07-13T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z',
    }]
    desktop.listHouseholds.mockResolvedValue([
      { id: 'family', name: '田中家', baseCurrency: 'JPY', createdAt: '2026-07-01T00:00:00Z' },
      { id: 'parents', name: '両親家', baseCurrency: 'JPY', createdAt: '2026-07-02T00:00:00Z' },
    ])
    render(<App />)
    await screen.findByText('生協')
    fireEvent.change(await screen.findByLabelText('口座スコープ'), { target: { value: 'daily' } })
    expect(localStorage.getItem('kakeflow.accountScope')).toContain('daily')

    fireEvent.change(screen.getByLabelText('世帯を切り替える'), { target: { value: 'parents' } })

    await waitFor(() => expect(desktop.queryDashboard).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'parents' })))
    expect(localStorage.getItem('kakeflow.activeHouseholdId')).toBe('parents')
    expect(localStorage.getItem('kakeflow.accountScope')).toBeNull()
    expect(screen.getByLabelText('口座スコープ')).toHaveValue('')
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
      items: [{ id: `transaction-${page}`, occurredOn: '2026-07-10', postedOn: null, transactionType: 'EXPENSE', payee: `店舗${page}`, description: null, amountJpy: 1000, status: 'POSTED', attributionKind: 'HOUSEHOLD', attributedMemberId: null, attributedMemberName: null, audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null }],
      page, pageSize, totalItems: 26, totalPages: 2,
    }))
    render(<App />)
    await screen.findByText('店舗1')
    fireEvent.click(screen.getByRole('button', { name: '取引' }))

    fireEvent.click(await screen.findByRole('button', { name: '次へ' }))

    expect(await screen.findByText('店舗2')).toBeInTheDocument()
    await waitFor(() => expect(desktop.queryTransactions).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 25 })))
  })

  it('searches the persisted ledger and posts a balanced manual transaction', async () => {
    desktop.listHouseholdMembers.mockResolvedValue([
      { id: 'taro', householdId: 'family', displayName: '太郎', relationshipLabel: '父', status: 'ACTIVE', sortOrder: 0, createdAt: '2026-07-01', updatedAt: '2026-07-01' },
      { id: 'hanako', householdId: 'family', displayName: '花子', relationshipLabel: '母', status: 'ACTIVE', sortOrder: 1, createdAt: '2026-07-01', updatedAt: '2026-07-01' },
    ])
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: '取引' }))

    fireEvent.change(screen.getByPlaceholderText('店舗、カテゴリー、口座を検索'), { target: { value: '八百屋' } })
    await waitFor(() => expect(desktop.queryTransactions).toHaveBeenCalledWith(expect.objectContaining({ search: '八百屋', page: 1 })))

    fireEvent.click(screen.getByRole('button', { name: '手動取引を追加' }))
    fireEvent.change(screen.getByLabelText('手動取引の支払先'), { target: { value: '八百屋' } })
    fireEvent.change(screen.getByLabelText('手動取引の金額'), { target: { value: '1500' } })
    fireEvent.change(screen.getByLabelText('手動取引の借方口座'), { target: { value: 'family-other-expense' } })
    fireEvent.change(screen.getByLabelText('手動取引の貸方口座'), { target: { value: 'family-bank' } })
    fireEvent.change(screen.getByLabelText('手動取引の家族内の帰属'), { target: { value: 'taro' } })
    fireEvent.change(screen.getByLabelText('手動取引の表示区分'), { target: { value: 'hanako' } })
    fireEvent.click(screen.getByRole('button', { name: '取引を記録' }))

    await waitFor(() => expect(desktop.createManualTransaction).toHaveBeenCalledWith(expect.objectContaining({
      householdId: 'family', transactionType: 'EXPENSE', payee: '八百屋',
      attributionKind: 'MEMBER', attributedMemberId: 'taro', audienceVisibility: 'PERSONAL', audienceMemberId: 'hanako',
      entries: expect.arrayContaining([
        expect.objectContaining({ accountId: 'family-other-expense', side: 'DEBIT', amountJpy: 1500 }),
        expect.objectContaining({ accountId: 'family-bank', side: 'CREDIT', amountJpy: 1500 }),
      ]),
    })))
    expect(await screen.findByText('手動取引を台帳に記録しました。')).toBeInTheDocument()
  })

  it('drills into source evidence and saves balanced transaction corrections', async () => {
    desktop.listHouseholdMembers.mockResolvedValue([
      { id: 'taro', householdId: 'family', displayName: '太郎', relationshipLabel: '父', status: 'ACTIVE', sortOrder: 0, createdAt: '2026-07-01', updatedAt: '2026-07-01' },
      { id: 'retired', householdId: 'family', displayName: '次郎', relationshipLabel: null, status: 'ARCHIVED', sortOrder: 1, createdAt: '2026-07-01', updatedAt: '2026-07-02' },
    ])
    desktop.getTransactionDetail.mockResolvedValue({ ...(await desktop.getTransactionDetail()), attributionKind: 'MEMBER', attributedMemberId: 'retired', attributedMemberName: '次郎', audienceVisibility: 'PERSONAL', audienceMemberId: 'retired', audienceMemberName: '次郎' })
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: '取引' }))
    const merchant = await screen.findByText('生協')
    fireEvent.click(merchant.closest('button')!)

    expect(await screen.findByText('card.csv')).toBeInTheDocument()
    expect(within(screen.getByLabelText('取引の家族内の帰属')).getByRole('option', { name: '次郎（アーカイブ済み）' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '個人・次郎（アーカイブ済み）' })).toBeInTheDocument()
    expect(screen.getByText(/行 2/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /card.csv.*原本行を表示/ }))
    expect(await screen.findByText(/"merchant": "生協"/)).toBeInTheDocument()
    expect(desktop.listTransactionSourceRecords).toHaveBeenCalledWith('family', 'purchase')
    fireEvent.change(screen.getByLabelText('card.csvの原本表示区分'), { target: { value: 'taro' } })
    fireEvent.click(screen.getByRole('button', { name: 'card.csvの原本区分を保存' }))
    await waitFor(() => expect(desktop.updateSourceDocumentAudience).toHaveBeenCalledWith({ householdId: 'family', sourceDocumentId: 'document', audienceVisibility: 'PERSONAL', audienceMemberId: 'taro' }))
    expect(await screen.findByText(/リンク先取引の帰属・表示区分は変更していません/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('取引の家族内の帰属'), { target: { value: 'taro' } })
    fireEvent.change(screen.getByLabelText('取引の表示区分'), { target: { value: 'SHARED' } })
    fireEvent.change(screen.getByDisplayValue('食料品'), { target: { value: '週末の食料品' } })
    fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))

    await waitFor(() => expect(desktop.updateTransaction).toHaveBeenCalledWith(expect.objectContaining({
      householdId: 'family', transactionId: 'purchase', description: '週末の食料品',
      attributionKind: 'MEMBER', attributedMemberId: 'taro', audienceVisibility: 'SHARED', audienceMemberId: null,
      entries: expect.arrayContaining([expect.objectContaining({ side: 'DEBIT', amountJpy: 120000 }), expect.objectContaining({ side: 'CREDIT', amountJpy: 120000 })]),
    })))
    expect(await screen.findByText('取引と仕訳を更新しました。')).toBeInTheDocument()
  })

  it('scans a registered sync folder and previews a file without exposing its absolute path', async () => {
    desktop.listWatchedFolders.mockResolvedValue([{ id: 'folder', householdId: 'family', label: '家計簿 Inbox', displayName: 'KakeFlow', isEnabled: true, createdAt: '2026-07-12T00:00:00Z' }])
    desktop.scanWatchedFolder.mockResolvedValue({ watchedFolderId: 'folder', files: [{ relativePath: 'PayPay/history.csv', fileName: 'history.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000 }] })
    desktop.readWatchedFile.mockResolvedValue({ relativePath: 'PayPay/history.csv', fileName: 'history.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fileBytes: [97, 44, 98] })
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))

    expect(await screen.findByText('KakeFlow')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '新しいファイルを確認' }))
    expect(await screen.findByText('history.csv')).toBeInTheDocument()
    expect(screen.queryByText(/Users|Documents|C:\\/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'プレビュー' }))

    await waitFor(() => expect(desktop.readWatchedFile).toHaveBeenCalledWith('family', 'folder', 'PayPay/history.csv'))
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
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: '設定' }))

    fireEvent.change(screen.getByLabelText('復元用パスフレーズ'), { target: { value: 'correct horse battery' } })
    fireEvent.change(screen.getByLabelText('復元用パスフレーズを確認'), { target: { value: 'correct horse battery' } })
    fireEvent.click(screen.getByRole('button', { name: 'バックアップを選択して復元' }))

    await waitFor(() => expect(desktop.stageBackupRestore).toHaveBeenCalledWith('correct horse battery'))
    expect(desktop.restartForRestore).toHaveBeenCalledOnce()
    expect(dialog.open).not.toHaveBeenCalled()
    expect(container.querySelector('.restore-panel input[type="checkbox"]')).not.toBeInTheDocument()
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
    await waitFor(() => expect(desktop.startImport).toHaveBeenCalledWith(expect.objectContaining({ audienceVisibility: 'SHARED', audienceMemberId: null, candidates: [expect.objectContaining({ attributionKind: 'HOUSEHOLD', attributedMemberId: null, audienceVisibility: 'SHARED', audienceMemberId: null })] }), expect.any(Uint8Array)))

    const commit = await screen.findByRole('button', { name: '承認済みを台帳へ反映' })
    expect(commit).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'STOREを承認' }))
    expect(commit).toBeEnabled()
    fireEvent.click(commit)

    await waitFor(() => expect(desktop.commitImport).toHaveBeenCalledWith('run-1', [expect.objectContaining({ candidateId: 'candidate-1', transactionType: 'EXPENSE', attributionKind: 'HOUSEHOLD', attributedMemberId: null, audienceVisibility: 'SHARED', audienceMemberId: null })]))
  })

  it('explicitly previews an unsupported CSV with a saved profile before staging it for review', async () => {
    const fallback = nativeInvoke.getMockImplementation()!
    nativeInvoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command !== 'delimited_parser_profiles_list') return fallback(command, args)
      const profiles = await fallback(command, args) as Array<Record<string, unknown>>
      return [...profiles, { ...profiles[0], id: 'custom-bank-2', name: 'Second profile', version: 1 }]
    })
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File(['Date,Description,Amount,Account\n2026/07/12,Local shop,-1200,銀行'], 'local-bank.csv', { type: 'text/csv' })
    fireEvent.change(input, { target: { files: [file] } })

    const profile = await screen.findByLabelText('local-bank.csvの読み取りプロファイル')
    expect(await screen.findByText('組み込み形式では未対応')).toBeInTheDocument()
    fireEvent.change(profile, { target: { value: 'custom-bank' } })
    fireEvent.click(screen.getByRole('button', { name: '適用してプレビュー' }))

    expect(await screen.findByText('1件の候補 / 0行を除外 / 0件のエラー')).toBeInTheDocument()
    expect(screen.getByText('DATE: Date → Date')).toBeInTheDocument()
    expect(screen.getByLabelText('local-bank.csvの取込先口座')).toHaveValue('family-bank')

    fireEvent.change(profile, { target: { value: 'custom-bank-2' } })
    expect(screen.queryByText('1件の候補 / 0行を除外 / 0件のエラー')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取込開始' })).not.toBeInTheDocument()
    expect(screen.getByText(/もう一度実行してください/)).toBeInTheDocument()
    fireEvent.change(profile, { target: { value: 'custom-bank' } })
    fireEvent.click(screen.getByRole('button', { name: '適用してプレビュー' }))
    expect(await screen.findByText('1件の候補 / 0行を除外 / 0件のエラー')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取込開始' }))

    await waitFor(() => expect(desktop.startImport).toHaveBeenCalledWith(expect.objectContaining({
      adapterId: 'custom-delimited-v1', adapterVersion: 'custom-bank@2',
      candidates: [expect.objectContaining({ accountId: 'family-bank', merchantRaw: 'Local shop', amountJpy: 1200, direction: 'OUT' })],
    }), expect.any(Uint8Array)))
    expect(await screen.findByRole('button', { name: '承認済みを台帳へ反映' })).toBeDisabled()
  })

  it('blocks custom staging when a preview has rejected error rows', async () => {
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(input, { target: { files: [new File(['Date,Description,Amount,Account\n2026/07/12,Valid,-1200,銀行\nnot-a-date,Rejected,-500,銀行'], 'mixed.csv', { type: 'text/csv' })] } })
    const selector = await screen.findByLabelText('mixed.csvの読み取りプロファイル')
    fireEvent.change(selector, { target: { value: 'custom-bank' } })
    fireEvent.click(screen.getByRole('button', { name: '適用してプレビュー' }))

    expect(await screen.findByText('1件の候補 / 1行を除外 / 1件のエラー')).toBeInTheDocument()
    expect(screen.getByText(/エラーを解消して再プレビュー/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取込開始' })).not.toBeInTheDocument()
    expect(desktop.startImport).not.toHaveBeenCalled()
  })

  it('prompts for a protected PDF password and never persists it in the import request', async () => {
    const fallback = nativeInvoke.getMockImplementation()!
    nativeInvoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command !== 'document_extract_attempt') return fallback(command, args)
      if (args?.password !== 'one-time-password') return { status: 'PASSWORD_REQUIRED', document: null }
      return {
        status: 'SUCCESS',
        document: { method: 'EMBEDDED_TEXT', text: 'スーパー\n2026/07/12\n合計 ¥1,200', confidenceBps: 9000, issues: [], regions: [{ pageNumber: 1, coordinateSpace: 'UNLOCATED', boundingBox: null, text: 'スーパー\n2026/07/12\n合計 ¥1,200', confidenceBps: 9000, provenance: 'PDF_EMBEDDED_TEXT' }] },
      }
    })
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.3 protected'], 'protected.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(await screen.findByRole('button', { name: 'PDF抽出' }))

    expect(await screen.findByText('このPDFはパスワードで保護されています')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('PDFパスワード'), { target: { value: 'one-time-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'ロックを解除' }))

    await waitFor(() => expect(nativeInvoke).toHaveBeenCalledWith('document_extract_attempt', expect.objectContaining({ password: 'one-time-password' })))
    await waitFor(() => expect(desktop.startImport).toHaveBeenCalled())
    expect(desktop.startImport.mock.calls.at(-1)?.[0]).not.toHaveProperty('password')
    expect(screen.queryByLabelText('PDFパスワード')).not.toBeInTheDocument()
  })

  it('creates a household-owned account from settings', async () => {
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    fireEvent.change(screen.getByLabelText('新しい口座名'), { target: { value: 'ゆうちょ銀行' } })
    fireEvent.click(screen.getByRole('button', { name: '口座を追加' }))

    await waitFor(() => expect(desktop.createAccount).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'family', name: 'ゆうちょ銀行', accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY' })))
  })

  it('manages local household members and explains that personal is not access control', async () => {
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: '家族スペース' }))

    expect(screen.getByRole('heading', { name: '家族スペース' })).toBeInTheDocument()
    expect(screen.getByText(/ログイン、閲覧制限、アクセス制御ではありません/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('新しいメンバーの表示名'), { target: { value: '花子' } })
    fireEvent.change(screen.getByLabelText('新しいメンバーの続柄・メモ'), { target: { value: '母' } })
    fireEvent.click(screen.getByRole('button', { name: 'メンバーを追加' }))
    await waitFor(() => expect(desktop.createHouseholdMember).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'family', displayName: '花子', relationshipLabel: '母' })))
    expect(desktop.createHouseholdMember.mock.calls[0]?.[0]).not.toHaveProperty('sortOrder')

    fireEvent.change(screen.getByLabelText('太郎の表示名'), { target: { value: '太郎さん' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(desktop.updateHouseholdMember).toHaveBeenCalledWith({ householdId: 'family', memberId: 'taro', displayName: '太郎さん', relationshipLabel: '父', sortOrder: 0 }))
    fireEvent.click(screen.getByRole('button', { name: 'アーカイブ' }))
    await waitFor(() => expect(desktop.archiveHouseholdMember).toHaveBeenCalledWith('family', 'taro'))
  })

  it('updates account ownership and prevents a household-owned personal combination', async () => {
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: '設定' }))

    const owner = screen.getByLabelText('銀行の所有者')
    const visibility = screen.getByLabelText('銀行の共有区分')
    expect(visibility).not.toBeDisabled()
    fireEvent.change(owner, { target: { value: 'HOUSEHOLD' } })
    expect(visibility).toBeDisabled()
    expect(visibility).toHaveValue('SHARED')
    fireEvent.click(screen.getAllByRole('button', { name: '区分を保存' })[0])
    await waitFor(() => expect(desktop.updateAccountOwnership).toHaveBeenCalledWith({ householdId: 'family', accountId: 'family-bank', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, visibility: 'SHARED' }))

    fireEvent.change(screen.getByLabelText('新しい口座名'), { target: { value: '太郎の財布' } })
    fireEvent.change(screen.getByLabelText('新しい口座の所有者'), { target: { value: 'taro' } })
    fireEvent.change(screen.getByLabelText('新しい口座の共有区分'), { target: { value: 'PERSONAL' } })
    fireEvent.click(screen.getByRole('button', { name: '口座を追加' }))
    await waitFor(() => expect(desktop.createAccount).toHaveBeenLastCalledWith(expect.objectContaining({ name: '太郎の財布', ownershipKind: 'MEMBER', ownerMemberId: 'taro', visibility: 'PERSONAL' })))
  })

  it('creates a persisted merchant classification rule', async () => {
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: '分類ルール' }))
    await screen.findByRole('heading', { name: '新しいルール' })
    fireEvent.change(screen.getByLabelText('ルール名'), { target: { value: '生協を食費へ' } })
    fireEvent.change(screen.getByLabelText('店舗名の条件'), { target: { value: '生協' } })
    fireEvent.change(screen.getByLabelText('分類先カテゴリー'), { target: { value: 'family-other-expense' } })
    fireEvent.change(screen.getByLabelText('タグ'), { target: { value: '#family, #food' } })
    fireEvent.click(screen.getByRole('button', { name: 'ルールを保存' }))

    await waitFor(() => expect(desktop.createClassificationRule).toHaveBeenCalledWith(expect.objectContaining({
      householdId: 'family', name: '生協を食費へ', merchantContains: '生協', categoryAccountId: 'family-other-expense', tags: ['family', 'food'], isEnabled: true,
    })))
  })
})
