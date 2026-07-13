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
  importSummary: vi.fn(),
  listPendingReviews: vi.fn(),
  getDashboardPreferences: vi.fn(),
  upsertDashboardPreferences: vi.fn(),
  queryTransactions: vi.fn(),
  createManualTransaction: vi.fn(),
  getTransactionDetail: vi.fn(),
  updateTransaction: vi.fn(),
  bulkUpdateTransactionMetadata: vi.fn(),
  listTransactionSourceRecords: vi.fn(),
  updateSourceDocumentAudience: vi.fn(),
  listWatchedFolders: vi.fn(),
  selectWatchedFolder: vi.fn(),
  removeWatchedFolder: vi.fn(),
  scanWatchedFolder: vi.fn(),
  readWatchedFile: vi.fn(),
  listWatchedFileInbox: vi.fn(),
  countWatchedFileInbox: vi.fn(),
  ignoreWatchedFileInboxItem: vi.fn(),
  retryWatchedFileInboxItem: vi.fn(),
  claimWatchedFileInboxItems: vi.fn(),
  markWatchedFileInboxReady: vi.fn(),
  markWatchedFileInboxNeedsMapping: vi.fn(),
  markWatchedFileInboxFailed: vi.fn(),
  markWatchedFileInboxStaged: vi.fn(),
  listCardSettlements: vi.fn(),
  confirmCardMatch: vi.fn(),
  confirmCardPaymentLink: vi.fn(),
  updateCardStatementDueDate: vi.fn(),
  listCardSettlementBankMappings: vi.fn(),
  upsertCardSettlementBankMapping: vi.fn(),
  deleteCardSettlementBankMapping: vi.fn(),
  queryCardSettlementBalanceCoverage: vi.fn(),
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
  rollbackImport: vi.fn(),
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
  ocrDocument: vi.fn(),
  suggestReceiptMatches: vi.fn(),
  confirmReceiptMatch: vi.fn(),
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
      getDashboardPreferences: desktop.getDashboardPreferences,
      upsertDashboardPreferences: desktop.upsertDashboardPreferences,
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
      bulkUpdateTransactionMetadata: desktop.bulkUpdateTransactionMetadata,
      listTransactionSourceRecords: desktop.listTransactionSourceRecords,
      updateSourceDocumentAudience: desktop.updateSourceDocumentAudience,
      listWatchedFolders: desktop.listWatchedFolders,
      selectWatchedFolder: desktop.selectWatchedFolder,
      removeWatchedFolder: desktop.removeWatchedFolder,
      scanWatchedFolder: desktop.scanWatchedFolder,
      readWatchedFile: desktop.readWatchedFile,
      listWatchedFileInbox: desktop.listWatchedFileInbox,
      countWatchedFileInbox: desktop.countWatchedFileInbox,
      ignoreWatchedFileInboxItem: desktop.ignoreWatchedFileInboxItem,
      retryWatchedFileInboxItem: desktop.retryWatchedFileInboxItem,
      claimWatchedFileInboxItems: desktop.claimWatchedFileInboxItems,
      markWatchedFileInboxReady: desktop.markWatchedFileInboxReady,
      markWatchedFileInboxNeedsMapping: desktop.markWatchedFileInboxNeedsMapping,
      markWatchedFileInboxFailed: desktop.markWatchedFileInboxFailed,
      markWatchedFileInboxStaged: desktop.markWatchedFileInboxStaged,
      importSummary: desktop.importSummary,
      listPendingReviews: desktop.listPendingReviews,
      startImport: desktop.startImport,
      previewImport: desktop.previewImport,
      commitImport: desktop.commitImport,
      rollbackImport: desktop.rollbackImport,
      listCardSettlements: desktop.listCardSettlements,
      confirmCardMatch: desktop.confirmCardMatch,
      confirmCardPaymentLink: desktop.confirmCardPaymentLink,
      updateCardStatementDueDate: desktop.updateCardStatementDueDate,
      listCardSettlementBankMappings: desktop.listCardSettlementBankMappings,
      upsertCardSettlementBankMapping: desktop.upsertCardSettlementBankMapping,
      deleteCardSettlementBankMapping: desktop.deleteCardSettlementBankMapping,
      queryCardSettlementBalanceCoverage: desktop.queryCardSettlementBalanceCoverage,
      createBackup: vi.fn(),
      stageBackupRestore: desktop.stageBackupRestore,
      restartForRestore: desktop.restartForRestore,
      extractDocument: vi.fn(),
      ocrDocument: desktop.ocrDocument,
      suggestReceiptMatches: desktop.suggestReceiptMatches,
      confirmReceiptMatch: desktop.confirmReceiptMatch,
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

const dashboardLayouts = (overrides: Record<string, { widgetOrder: readonly string[]; hiddenWidgets: readonly string[] }> = {}) => ({
  FINANCIAL_OVERVIEW: { widgetOrder: ['TREND', 'SPENDING', 'RECENT', 'CARDS'], hiddenWidgets: [] },
  HOUSEHOLD_LEDGER: { widgetOrder: ['SPENDING', 'RECENT', 'TREND', 'CARDS'], hiddenWidgets: [] },
  ASSETS_LIABILITIES: { widgetOrder: ['TREND', 'SPENDING', 'CARDS', 'RECENT'], hiddenWidgets: [] },
  CARD_RECONCILIATION: { widgetOrder: ['CARDS', 'RECENT', 'TREND', 'SPENDING'], hiddenWidgets: [] },
  CASH_FLOW: { widgetOrder: ['TREND', 'RECENT', 'CARDS', 'SPENDING'], hiddenWidgets: [] },
  ...overrides,
})

describe('KakeFlow desktop read models', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    localStorage.clear()
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.themePreference
    delete document.documentElement.dataset.density
    accountGroupState.groups = []
    desktop.listHouseholds.mockReset().mockResolvedValue([{ id: 'family', name: '田中家', baseCurrency: 'JPY', createdAt: '2026-07-01T00:00:00Z' }])
    desktop.listHouseholdMembers.mockReset().mockResolvedValue([{ id: 'taro', householdId: 'family', displayName: '太郎', relationshipLabel: '父', status: 'ACTIVE', sortOrder: 0, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z' }])
    desktop.createHouseholdMember.mockReset().mockImplementation(async (input) => ({ ...input, status: 'ACTIVE', sortOrder: 1, createdAt: '2026-07-13T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z' }))
    desktop.updateHouseholdMember.mockReset().mockImplementation(async (input) => ({ ...input, id: input.memberId, status: 'ACTIVE', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z' }))
    desktop.archiveHouseholdMember.mockReset().mockResolvedValue(undefined)
    desktop.listAccounts.mockReset().mockResolvedValue([
      { id: 'family-bank', name: '銀行', accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY', ownershipKind: 'MEMBER', ownerMemberId: 'taro', ownerMemberName: '太郎', visibility: 'PERSONAL' },
      { id: 'family-wallet', name: 'PayPay', accountKind: 'ASSET', accountSubtype: 'WALLET', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
      { id: 'family-other-expense', name: 'その他', accountKind: 'EXPENSE', accountSubtype: 'OTHER', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
      { id: 'family-income', name: '収入', accountKind: 'INCOME', accountSubtype: 'OTHER', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
      { id: 'family-card', name: 'カード', accountKind: 'LIABILITY', accountSubtype: 'CREDIT_CARD', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
    ])
    desktop.getDashboardPreferences.mockReset().mockImplementation(async (householdId: string) => ({ householdId, template: 'FINANCIAL_OVERVIEW', theme: 'SYSTEM', density: 'COMFORTABLE', templateLayouts: dashboardLayouts(), updatedAt: '2026-07-13T00:00:00Z' }))
    desktop.upsertDashboardPreferences.mockReset().mockImplementation(async (input) => ({ ...input, updatedAt: '2026-07-13T00:01:00Z' }))
    desktop.listCardSettlements.mockReset().mockResolvedValue([])
    desktop.importSummary.mockReset().mockResolvedValue({ totalRuns: 3, discovered: 0, extracting: 0, reviewRequired: 1, posted: 2, failed: 0, rolledBack: 0, sourceDocuments: 2, sourceRecords: 42, pendingCandidates: 1, readyCandidates: 2, latestSuccessfulImportAt: '2026-07-12T14:55:16Z', latestSourceFilename: 'yucho.csv', latestSourceType: 'MANUAL_UPLOAD', distinctSourceTypes: 2 })
    desktop.listPendingReviews.mockReset().mockImplementation(async (householdId: string) => ({ householdId, runs: [] }))
    desktop.confirmCardMatch.mockReset().mockResolvedValue({ statementId: 'statement-1', paymentId: 'payment-1', reconciliationStatus: 'FULLY_RECONCILED' })
    desktop.confirmCardPaymentLink.mockReset().mockResolvedValue({})
    desktop.updateCardStatementDueDate.mockReset().mockImplementation(async (input) => ({
      id: input.statementId, cardAccountId: 'family-card', cardName: '期日未登録カード', maskedIdentifier: null,
      periodStart: '2026-06-01', periodEnd: '2026-06-30', paymentDueOn: input.paymentDueOn,
      statementAmountJpy: 20_000, detailAmountJpy: 20_000, lineCount: 1,
      paymentId: null, bankTransactionId: null, paymentAmountJpy: null, paymentOn: null, matchScoreBps: null,
      reconciliationStatus: 'UNMATCHED', paidAmountJpy: 0, outstandingAmountJpy: 20_000, overpaidAmountJpy: 0,
      payments: [], eligiblePayments: [],
    }))
    desktop.listCardSettlementBankMappings.mockReset().mockResolvedValue([])
    desktop.upsertCardSettlementBankMapping.mockReset().mockImplementation(async (input) => ({ ...input, cardAccountName: 'カード', bankAccountName: '銀行', createdAt: '2026-07-13T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z' }))
    desktop.deleteCardSettlementBankMapping.mockReset().mockResolvedValue(undefined)
    desktop.queryCardSettlementBalanceCoverage.mockReset().mockResolvedValue({ asOf: '2026-07-13', historyFrom: '2026-07-13', horizonThrough: '2026-08-27', horizonDays: 45, banks: [], unmappedStatements: [], missingDueStatements: [] })
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
    desktop.rollbackImport.mockReset().mockResolvedValue(undefined)
    desktop.createAccount.mockReset().mockResolvedValue({ id: 'new-bank', name: 'ゆうちょ銀行', accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' })
    desktop.renameAccount.mockReset()
    desktop.archiveAccount.mockReset()
    desktop.updateAccountOwnership.mockReset()
    desktop.createManualTransaction.mockReset().mockResolvedValue({ id: 'manual', occurredOn: '2026-07-12', postedOn: null, transactionType: 'EXPENSE', payee: '八百屋', description: null, amountJpy: 1500, status: 'POSTED', calculationTarget: true, debitAccountId: 'family-other-expense', debitAccountName: 'その他', creditAccountId: 'family-bank', creditAccountName: '銀行', categoryAccountId: 'family-other-expense', categoryName: 'その他', attributionKind: 'HOUSEHOLD', attributedMemberId: null, attributedMemberName: null, audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null })
    desktop.getTransactionDetail.mockReset().mockResolvedValue({ id: 'purchase', householdId: 'family', occurredOn: '2026-07-10', postedOn: null, transactionType: 'CARD_PURCHASE', payee: '生協', description: '食料品', calculationTarget: true, attributionKind: 'HOUSEHOLD', attributedMemberId: null, attributedMemberName: null, audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null, status: 'POSTED', createdAt: '2026-07-10T00:00:00Z', updatedAt: '2026-07-10T00:00:00Z', editable: true, entries: [{ id: 'debit', accountId: 'family-other-expense', accountName: 'その他', accountKind: 'EXPENSE', side: 'DEBIT', amountJpy: 120000, lineNumber: 1 }, { id: 'credit', accountId: 'family-card', accountName: 'カード', accountKind: 'LIABILITY', side: 'CREDIT', amountJpy: 120000, lineNumber: 2 }], sourceEvidence: [{ sourceRecordId: 'record', sourceDocumentId: 'document', sourceType: 'MANUAL_UPLOAD', originalFilename: 'card.csv', mediaType: 'text/csv', rowNumber: 2, importedAt: '2026-07-12T00:00:00Z', evidenceRole: 'PRIMARY', audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null }] })
    desktop.updateTransaction.mockReset().mockImplementation(async (input) => ({ ...(await desktop.getTransactionDetail()), ...input, id: input.transactionId }))
    desktop.bulkUpdateTransactionMetadata.mockReset().mockResolvedValue({ updatedCount: 1 })
    desktop.listTransactionSourceRecords.mockReset().mockResolvedValue([{ id: 'record', sourceDocumentId: 'document', rowNumber: 2, recordHash: 'hash', payloadJson: '{"merchant":"生協","amount":120000}', createdAt: '2026-07-12T00:00:00Z', evidenceRole: 'PRIMARY' }])
    desktop.updateSourceDocumentAudience.mockReset().mockImplementation(async (input) => ({ id: input.sourceDocumentId, householdId: input.householdId, importRunId: 'run-1', sourceType: 'MANUAL_UPLOAD', originalFilename: 'card.csv', mediaType: 'text/csv', byteSize: 100, sha256: 'hash', sourceModifiedAt: null, importedAt: '2026-07-12T00:00:00Z', adapterId: 'card', adapterVersion: '1', recordCount: 1, audienceVisibility: input.audienceVisibility, audienceMemberId: input.audienceMemberId, audienceMemberName: input.audienceMemberId ? '太郎' : null }))
    desktop.listClassificationRules.mockReset().mockResolvedValue([])
    desktop.createClassificationRule.mockReset().mockImplementation(async (input) => ({ ...input, categoryName: 'その他', createdAt: '2026-07-13T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z' }))
    desktop.updateClassificationRule.mockReset()
    desktop.deleteClassificationRule.mockReset().mockResolvedValue(undefined)
    desktop.previewClassificationRules.mockReset().mockResolvedValue({ winningRuleId: null, matches: [] })
    desktop.applyClassificationRule.mockReset()
    desktop.ocrDocument.mockReset().mockResolvedValue({ method: 'OCR', text: 'STORE\n2026/07/12\n合計 ¥1,200', confidenceBps: 9000, issues: [] })
    desktop.suggestReceiptMatches.mockReset().mockResolvedValue([{ candidateId: 'candidate-1', transactionId: 'purchase', occurredOn: '2026-07-12', payee: 'STORE', description: null, transactionType: 'EXPENSE', amountJpy: 1200, dayDifference: 0, merchantSimilarityBps: 10000, scoreBps: 10000, reasons: ['Exact receipt and posted-expense amount'] }])
    desktop.confirmReceiptMatch.mockReset().mockResolvedValue({ runId: 'run-1', candidateId: 'candidate-1', transactionId: 'purchase', resolutionStatus: 'LINKED', evidenceCount: 1, runStatus: 'POSTED' })
    desktop.listWatchedFolders.mockReset().mockResolvedValue([])
    desktop.selectWatchedFolder.mockReset().mockResolvedValue(null)
    desktop.removeWatchedFolder.mockReset().mockResolvedValue(undefined)
    desktop.scanWatchedFolder.mockReset().mockResolvedValue({ watchedFolderId: 'folder', files: [] })
    desktop.readWatchedFile.mockReset()
    desktop.listWatchedFileInbox.mockReset().mockResolvedValue([])
    desktop.countWatchedFileInbox.mockReset().mockResolvedValue({ discovered: 0, processing: 0, ready: 0, needsMapping: 0, staged: 0, failed: 0, ignored: 0, removed: 0, actionable: 0, total: 0 })
    desktop.ignoreWatchedFileInboxItem.mockReset()
    desktop.retryWatchedFileInboxItem.mockReset()
    desktop.claimWatchedFileInboxItems.mockReset().mockResolvedValue({ leaseToken: 'lease', leaseExpiresAt: '2026-07-13T00:05:00Z', items: [] })
    desktop.markWatchedFileInboxReady.mockReset()
    desktop.markWatchedFileInboxNeedsMapping.mockReset()
    desktop.markWatchedFileInboxFailed.mockReset()
    desktop.markWatchedFileInboxStaged.mockReset()
    dialog.open.mockReset().mockResolvedValue('/tmp/family.kakeflow-backup')
    dialog.save.mockReset().mockResolvedValue(null)
    nativeInvoke.mockReset().mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      const quality = { totalImports: 1, postedImports: 1, reviewRequiredImports: 0, failedImports: 0, inProgressImports: 0, importCompletionBps: 10000, latestImportedAt: '2026-07-12T00:00:00Z', staleDays: 1, hasUnresolvedImports: false }
      const budget = { budgetJpy: 150000, actualJpy: 120000, remainingJpy: 30000, utilizationBps: 8000, categoryCount: 4, overBudgetCount: 0 }
      const goals = { activeCount: 1, targetJpy: 1000000, savedJpy: 400000, remainingJpy: 600000, dueWithinPeriodCount: 0 }
      const metrics = { incomeJpy: 500000, expenseJpy: 120000, savingsJpy: 380000, savingsRateBps: 7600, postedTransactionCount: 1 }
      const deltas = { income: { amountJpy: 10000, rateBps: 204 }, expense: { amountJpy: -5000, rateBps: -400 }, savings: { amountJpy: 15000, rateBps: 411 } }
      if (command === 'financial_calendar_query') return { month: '2026-07', asOf: '2026-07-31', days: [{ date: '2026-07-10', accrualIncomeJpy: 0, accrualExpenseJpy: 120000, cashInflowJpy: 0, cashOutflowJpy: 0, postedTransactionCount: 1, noSpendDay: false, events: [] }], budget, goals, dataQuality: quality }
      if (command === 'financial_report_monthly_query') return { period: '2026-07', current: metrics, priorMonth: { ...metrics, expenseJpy: 125000 }, priorYear: { ...metrics, incomeJpy: 490000 }, vsPriorMonth: deltas, vsPriorYear: deltas, topCategoryDrivers: [{ id: 'food', name: '食費', currentJpy: 70000, previousJpy: 60000, deltaJpy: 10000 }], topMerchantDrivers: [{ merchant: '生協', currentJpy: 50000, previousJpy: 40000, deltaJpy: 10000 }], budget, goals, dataQuality: quality, reconciliation: { totalStatements: 1, fullyReconciled: 1, possibleMatches: 0, partiallyReconciled: 0, unmatched: 0, mismatchCount: 0, paymentTotalJpy: 204987 } }
      if (command === 'financial_report_yearly_query') {
        const current = { incomeJpy: 600000, expenseJpy: 300000, savingsJpy: 300000, savingsRateBps: 5000, postedTransactionCount: 12 }
        const prior = { incomeJpy: 540000, expenseJpy: 300000, savingsJpy: 240000, savingsRateBps: 4444, postedTransactionCount: 12 }
        const delta = { income: { amountJpy: 60000, rateBps: 1111 }, expense: { amountJpy: 0, rateBps: 0 }, savings: { amountJpy: 60000, rateBps: 2500 } }
        const months = Array.from({ length: 12 }, (_, index) => ({ month: `2026-${String(index + 1).padStart(2, '0')}`, status: index < 6 ? 'COMPLETE' : index === 6 ? 'PARTIAL' : 'FUTURE', incomeJpy: index < 6 ? 100000 : 0, expenseJpy: index < 6 ? 50000 : 0, savingsJpy: index < 6 ? 50000 : 0, savingsRateBps: index < 6 ? 5000 : null, postedTransactionCount: index < 6 ? 2 : 0 }))
        return { period: '2026', asOf: '2026-07-13', throughMonth: '2026-06', completedMonthCount: 6, isCompleteYear: false, currentComparable: current, priorYearComparable: prior, vsPriorYearComparable: delta, current, priorYear: prior, vsPriorYear: delta, months, topCategoryDrivers: [{ id: 'food', name: '食費', currentJpy: 90000, previousJpy: 70000, deltaJpy: 20000 }], topMerchantDrivers: [{ merchant: '生協', currentJpy: 60000, previousJpy: 50000, deltaJpy: 10000 }], budget, goals, dataQuality: quality, reconciliation: { totalStatements: 6, fullyReconciled: 5, possibleMatches: 1, partiallyReconciled: 0, unmatched: 0, mismatchCount: 0, paymentTotalJpy: 204987 } }
      }
      if (command === 'forecast_action_query') return { asOf: '2026-07-31', forecastFrom: '2026-08', forecastThrough: '2026-10', openingCashJpy: 620000, assumptions: { historyFrom: '2026-04', historyThrough: '2026-06', historyMonths: 3, averageMonthlyIncomeJpy: 500000, averageMonthlyExpenseJpy: 120000, averageMonthlyNonRecurringExpenseJpy: 100000, averageMonthlyCashChangeBeforeCardPaymentsJpy: 300000, recurringMonthlyExpenseJpy: 20000, recurringItemCount: 2, reasons: ['確定台帳の直近3か月平均'] }, months: ['2026-08', '2026-09', '2026-10'].map((month, index) => ({ month, openingCashJpy: 620000 + index * 250000, projectedIncomeJpy: 500000, projectedNonRecurringExpenseJpy: 100000, projectedRecurringExpenseJpy: 20000, projectedSavingsJpy: 380000, projectedCashChangeBeforeCardPaymentsJpy: 300000, knownCardPaymentsJpy: 50000, projectedCashChangeJpy: 250000, closingCashJpy: 870000 + index * 250000 })), actions: [{ id: 'budget-food', kind: 'BUDGET_OVERRUN', priority: 'HIGH', title: '食費予算を超過', detail: '予算を確認してください', dueOn: null, amountJpy: 12000, entityId: 'food', reasons: ['確定支出が予算を超えました'] }, { id: 'import-review', kind: 'IMPORT_REVIEW', priority: 'MEDIUM', title: '取込を確認', detail: '候補を確認してください', dueOn: null, amountJpy: null, entityId: null, reasons: ['未確定'] }, { id: 'card-due', kind: 'CARD_PAYMENT_DUE', priority: 'MEDIUM', title: 'カード引落を確認', detail: '引落予定があります', dueOn: '2026-07-27', amountJpy: 20000, entityId: 'card', reasons: ['支払期日'] }, { id: 'anomaly', kind: 'SPENDING_ANOMALY', priority: 'LOW', title: '支出を確認', detail: '通常より高額です', dueOn: null, amountJpy: 9000, entityId: 'purchase', reasons: ['履歴比較'] }] }
      if (command === 'financial_intelligence_query') return { asOf: '2026-07-31', historyFrom: '2025-07-31', recurringItems: [], anomalies: [] }
      if (command === 'fixed_cost_review_query') {
        const monthlyPoints = [9000, 10000, 11000, 12000, 13000, 14000].map((totalJpy, index) => ({ month: `2026-${String(index + 1).padStart(2, '0')}`, totalJpy, recurringPayeeCount: 1, transactionCount: 1 }))
        return { asOf: '2026-07-31', historyFrom: '2026-01-01', historyThrough: '2026-06-30', monthlyPoints, segments: [{ segment: 'MOBILE', monthlyPoints, recentThreeAverageJpy: 13000, previousThreeAverageJpy: 10000, changeJpy: 3000, changeRateBps: 3000, annualizedJpy: 156000, recurringPayeeCount: 1, transactionCount: 6, latestPaymentOn: '2026-06-20', topPayees: [{ normalizedPayee: 'mobile', displayPayee: 'Mobile Co', expenseCategoryNames: ['通信費'], cadence: 'MONTHLY', typicalAmountJpy: 13000, latestAmountJpy: 14000, latestPaymentOn: '2026-06-20', occurrenceCount: 6, confidenceBps: 9600, reasons: ['毎月の支払い'] }], reasons: ['直近3か月平均が増加'] }], totals: { recentThreeAverageJpy: 13000, previousThreeAverageJpy: 10000, changeJpy: 3000, changeRateBps: 3000, annualizedJpy: 156000, recurringPayeeCount: 1, transactionCount: 6 }, coverage: { completeMonthCount: 6, observedMonthCount: 12, confirmedTransactionCount: 100, recurringTransactionCount: 6, unclassifiedRecurringPayeeCount: 0 }, limitations: ['確定済み取引のみ'] }
      }
      if (command === 'export_csv_save') return { fileName: 'transactions.csv', rowCount: 1, byteSize: 100 }
      if (command === 'annual_household_review_csv_save') return { fileName: 'kakeflow-annual-review-2026.csv', rowCount: 6, byteSize: 800 }
      if (command === 'aggregate_asset_history_list') return [{ id: 'aggregate-jul', householdId: 'family', sourceDocumentId: 'mf-doc', sourceRow: 3, asOf: '2026-07-31', totalAssetsJpy: 8700000, components: [{ assetClass: 'DEPOSITS_CASH_CRYPTO', officialHeader: '預金・現金・暗号資産(円)', valueJpy: 2100000 }, { assetClass: 'LISTED_STOCKS', officialHeader: '株式(現物)(円)', valueJpy: 3100000 }] }, { id: 'aggregate-jun', householdId: 'family', sourceDocumentId: 'mf-doc', sourceRow: 2, asOf: '2026-06-30', totalAssetsJpy: 8500000, components: [{ assetClass: 'DEPOSITS_CASH_CRYPTO', officialHeader: '預金・現金・暗号資産(円)', valueJpy: 2000000 }] }]
      if (command === 'aggregate_asset_history_import') {
        const input = args?.input as { snapshots: Array<Record<string, unknown>> }
        return { createdCount: input.snapshots.length, reusedCount: 0, snapshots: input.snapshots }
      }
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
      cashFlowTrend: Array.from({ length: 6 }, (_, index) => ({ month: `2026-${String(index + 2).padStart(2, '0')}`, inflowJpy: index === 5 ? 480_000 : 0, outflowJpy: index === 5 ? 204_987 : 0, netCashFlowJpy: index === 5 ? 275_013 : 0 })),
      expenseCategories: [{ accountId: 'family-other-expense', name: 'その他', amountJpy: 120_000 }],
    }))
    desktop.queryTransactions.mockReset().mockImplementation(async ({ accountingBasis, pageSize }: { accountingBasis: 'ACCRUAL' | 'CASH'; pageSize: number }) => ({
      items: accountingBasis === 'ACCRUAL'
        ? [{ id: 'purchase', occurredOn: '2026-07-10', postedOn: null, transactionType: 'CARD_PURCHASE', payee: '生協', description: '食料品', amountJpy: 120_000, status: 'POSTED', calculationTarget: true, attributionKind: 'HOUSEHOLD', attributedMemberId: null, attributedMemberName: null, audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null, labels: ['RECURRING'], tags: ['food'] }]
        : [{ id: 'payment', occurredOn: '2026-07-27', postedOn: null, transactionType: 'CARD_PAYMENT', payee: 'Rakuten Card', description: '口座引落', amountJpy: 204_987, status: 'POSTED', calculationTarget: true, attributionKind: 'HOUSEHOLD', attributedMemberId: null, attributedMemberName: null, audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null, labels: [], tags: [] }],
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
    const dataQuality = screen.getByRole('heading', { name: 'データ品質' }).closest('section')!
    expect(within(dataQuality).getByText('yucho.csv ・ MANUAL_UPLOAD')).toBeInTheDocument()
    expect(within(dataQuality).getByText('3件')).toBeInTheDocument()
    expect(within(dataQuality).getByText('42行 ・ 2種類')).toBeInTheDocument()
    expect(desktop.queryDashboard).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'family', accountingBasis: 'ACCRUAL' }))
  })

  it('shows the bounded Home Action Center and opens its workspace or complete forecast view', async () => {
    render(<App />)

    expect(await screen.findByText('食費予算を超過')).toBeInTheDocument()
    expect(screen.getByText('カード引落を確認')).toBeInTheDocument()
    expect(screen.getByText('取込を確認')).toBeInTheDocument()
    expect(screen.queryByText('支出を確認')).not.toBeInTheDocument()
    expect(nativeInvoke).toHaveBeenCalledWith('forecast_action_query', { request: { householdId: 'family', accountGroupId: null, attributionScope: { kind: 'ALL' }, asOf: '2026-07-31' } })

    fireEvent.click(screen.getByRole('button', { name: '食費予算を超過を確認' }))
    expect(await screen.findByRole('heading', { name: '予算・貯蓄目標' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ホーム' }))
    fireEvent.click(await screen.findByRole('button', { name: '4件すべて見る' }))
    expect(await screen.findByText('現金・貯蓄予測')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '予測・アクション' })).toHaveAttribute('aria-selected', 'true')
  })

  it('loads and persists household dashboard appearance and focus presets', async () => {
    desktop.getDashboardPreferences.mockResolvedValue({ householdId: 'family', template: 'HOUSEHOLD_LEDGER', theme: 'DARK', density: 'COMPACT', templateLayouts: dashboardLayouts(), updatedAt: '2026-07-13T00:00:00Z' })
    render(<App />)

    await waitFor(() => expect(screen.getByLabelText('ホームの表示テンプレート')).toHaveValue('HOUSEHOLD_LEDGER'))
    expect(screen.getByLabelText('アプリのテーマ')).toHaveValue('DARK')
    expect(screen.getByLabelText('画面の表示密度')).toHaveValue('COMPACT')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement).toHaveAttribute('data-density', 'compact')

    fireEvent.change(screen.getByLabelText('ホームの表示テンプレート'), { target: { value: 'ASSETS_LIABILITIES' } })
    await waitFor(() => expect(desktop.upsertDashboardPreferences).toHaveBeenCalledWith({ householdId: 'family', template: 'ASSETS_LIABILITIES', theme: 'DARK', density: 'COMPACT', templateLayouts: dashboardLayouts() }))
    expect(await screen.findByRole('button', { name: /資産・投資を見る/ })).toBeInTheDocument()
    expect(Array.from(document.querySelector('.dashboard-grid')!.children).map((element) => element.className)).toEqual([expect.stringContaining('dashboard-widget--trend'), 'dashboard-widget dashboard-widget--spending', 'dashboard-widget dashboard-widget--cards', expect.stringContaining('dashboard-widget--recent')])

    fireEvent.change(screen.getByLabelText('アプリのテーマ'), { target: { value: 'LIGHT' } })
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'light'))
    fireEvent.change(screen.getByLabelText('画面の表示密度'), { target: { value: 'COMFORTABLE' } })
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-density', 'comfortable'))
  })

  it('restores, reorders, and hides dashboard widgets without changing metric semantics', async () => {
    desktop.getDashboardPreferences.mockResolvedValue({ householdId: 'family', template: 'FINANCIAL_OVERVIEW', theme: 'LIGHT', density: 'COMFORTABLE', templateLayouts: dashboardLayouts({ FINANCIAL_OVERVIEW: { widgetOrder: ['CARDS', 'TREND', 'SPENDING', 'RECENT'], hiddenWidgets: ['SPENDING'] } }), updatedAt: '2026-07-13T00:00:00Z' })
    render(<App />)

    await waitFor(() => expect(screen.getByLabelText('ホームの表示テンプレート')).toHaveValue('FINANCIAL_OVERVIEW'))
    expect(Array.from(document.querySelector('.dashboard-grid')!.children).map((element) => element.className)).toEqual(['dashboard-widget dashboard-widget--cards', expect.stringContaining('dashboard-widget--trend'), expect.stringContaining('dashboard-widget--recent')])
    expect(screen.queryByRole('heading', { name: '支出の内訳' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /レイアウト/ }))
    fireEvent.click(screen.getByRole('button', { name: 'カード支払いを下へ移動' }))
    await waitFor(() => expect(desktop.upsertDashboardPreferences).toHaveBeenCalledWith(expect.objectContaining({ templateLayouts: expect.objectContaining({ FINANCIAL_OVERVIEW: { widgetOrder: ['TREND', 'CARDS', 'SPENDING', 'RECENT'], hiddenWidgets: ['SPENDING'] } }) })))
    expect(screen.getByText('カード支払いを2/4へ移動しました')).toBeInTheDocument()
  })

  it('persists independent layouts for each dashboard template', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('ホームの表示テンプレート')).toHaveValue('FINANCIAL_OVERVIEW'))
    fireEvent.click(screen.getByRole('button', { name: /レイアウト/ }))
    let editor = screen.getByRole('region', { name: 'ウィジェットの並びと表示' })
    fireEvent.click(within(editor).getByRole('button', { name: 'カテゴリ別支出を非表示' }))
    await waitFor(() => expect(desktop.upsertDashboardPreferences).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText('ホームの表示テンプレート'), { target: { value: 'CARD_RECONCILIATION' } })
    await waitFor(() => expect(screen.getByLabelText('ホームの表示テンプレート')).toHaveValue('CARD_RECONCILIATION'))
    editor = screen.getByRole('region', { name: 'ウィジェットの並びと表示' })
    fireEvent.click(within(editor).getByRole('button', { name: '最近の取引を非表示' }))
    await waitFor(() => expect(desktop.upsertDashboardPreferences).toHaveBeenCalledTimes(3))

    fireEvent.change(screen.getByLabelText('ホームの表示テンプレート'), { target: { value: 'FINANCIAL_OVERVIEW' } })
    await waitFor(() => expect(screen.getByLabelText('ホームの表示テンプレート')).toHaveValue('FINANCIAL_OVERVIEW'))
    expect(screen.queryByRole('heading', { name: '支出の内訳' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '最近の取引' })).toBeInTheDocument()
    const latest = desktop.upsertDashboardPreferences.mock.calls.at(-1)?.[0]
    expect(latest.templateLayouts.FINANCIAL_OVERVIEW.hiddenWidgets).toEqual(['SPENDING'])
    expect(latest.templateLayouts.CARD_RECONCILIATION.hiddenWidgets).toEqual(['RECENT'])
  })

  it('persists native drag-and-drop widget order and renders the same DOM order', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /レイアウト/ }))
    const editor = screen.getByRole('region', { name: 'ウィジェットの並びと表示' })
    const trendRow = within(editor).getByText('収支の推移').closest<HTMLElement>('.dashboard-layout-row')!
    const cardsRow = within(editor).getByText('カード支払い').closest<HTMLElement>('.dashboard-layout-row')!
    const dataTransfer = { effectAllowed: 'none', setData: vi.fn(), getData: vi.fn() }

    fireEvent.dragStart(trendRow, { dataTransfer })
    fireEvent.dragOver(cardsRow, { dataTransfer })
    fireEvent.drop(cardsRow, { dataTransfer })

    await waitFor(() => expect(desktop.upsertDashboardPreferences).toHaveBeenCalledWith(expect.objectContaining({ templateLayouts: expect.objectContaining({ FINANCIAL_OVERVIEW: expect.objectContaining({ widgetOrder: ['SPENDING', 'RECENT', 'CARDS', 'TREND'] }) }) })))
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'TREND')
    expect(Array.from(document.querySelector('.dashboard-grid')!.children).map((element) => element.className)).toEqual(['dashboard-widget dashboard-widget--spending', expect.stringContaining('dashboard-widget--recent'), 'dashboard-widget dashboard-widget--cards', expect.stringContaining('dashboard-widget--trend')])
  })

  it('keeps the last eligible dashboard widget visible', async () => {
    desktop.getDashboardPreferences.mockResolvedValue({ householdId: 'family', template: 'CASH_FLOW', theme: 'LIGHT', density: 'COMFORTABLE', templateLayouts: dashboardLayouts({ CASH_FLOW: { widgetOrder: ['TREND', 'RECENT', 'CARDS', 'SPENDING'], hiddenWidgets: ['RECENT', 'CARDS'] } }), updatedAt: '2026-07-13T00:00:00Z' })
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /レイアウト/ }))
    const editor = screen.getByRole('region', { name: 'ウィジェットの並びと表示' })
    const trendRow = within(editor).getByText('収支の推移').closest<HTMLElement>('.dashboard-layout-row')!
    expect(screen.getByRole('heading', { name: '入出金の推移' })).toBeInTheDocument()
    expect(within(trendRow).getByRole('button', { name: '収支の推移を非表示' })).toBeDisabled()
    expect(within(editor).getByText('少なくとも1つのウィジェットを表示します。')).toBeInTheDocument()
  })

  it('restores an independent dashboard preset when switching households', async () => {
    desktop.listHouseholds.mockResolvedValue([
      { id: 'family', name: '田中家', baseCurrency: 'JPY', createdAt: '2026-07-01T00:00:00Z' },
      { id: 'parents', name: '両親家', baseCurrency: 'JPY', createdAt: '2026-07-02T00:00:00Z' },
    ])
    desktop.getDashboardPreferences.mockImplementation(async (householdId: string) => householdId === 'parents'
      ? { householdId, template: 'CARD_RECONCILIATION', theme: 'DARK', density: 'COMPACT', templateLayouts: dashboardLayouts(), updatedAt: '2026-07-13T00:00:00Z' }
      : { householdId, template: 'FINANCIAL_OVERVIEW', theme: 'LIGHT', density: 'COMFORTABLE', templateLayouts: dashboardLayouts(), updatedAt: '2026-07-13T00:00:00Z' })
    render(<App />)
    expect(await screen.findByLabelText('ホームの表示テンプレート')).toHaveValue('FINANCIAL_OVERVIEW')

    fireEvent.change(screen.getByLabelText('世帯を切り替える'), { target: { value: 'parents' } })

    await waitFor(() => expect(screen.getByLabelText('ホームの表示テンプレート')).toHaveValue('CARD_RECONCILIATION'))
    expect(screen.getByRole('button', { name: /カード照合を開く/ })).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement).toHaveAttribute('data-density', 'compact')
    expect(desktop.getDashboardPreferences).toHaveBeenCalledWith('parents')
  })

  it('uses cash basis consistently for the cash-flow Home without double counting card purchases', async () => {
    desktop.getDashboardPreferences.mockResolvedValue({ householdId: 'family', template: 'CASH_FLOW', theme: 'LIGHT', density: 'COMFORTABLE', templateLayouts: dashboardLayouts(), updatedAt: '2026-07-13T00:00:00Z' })
    render(<App />)

    await waitFor(() => expect(screen.getByLabelText('ホームの表示テンプレート')).toHaveValue('CASH_FLOW'))
    await waitFor(() => expect(desktop.queryDashboard).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'family', accountingBasis: 'CASH', month: '2026-07' })))
    expect(desktop.queryTransactions).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'family', accountingBasis: 'CASH', fromDate: '2026-07-01', toDate: '2026-07-31' }))

    expect(within(screen.getByText('今月の入金').closest('article')!).getByText('¥480,000')).toBeInTheDocument()
    expect(within(screen.getByText('今月の出金').closest('article')!).getByText('¥204,987')).toBeInTheDocument()
    expect(within(screen.getByText('差引キャッシュフロー').closest('article')!).getByText('¥275,013')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '直近6か月の入金と出金' })).toBeInTheDocument()
    expect(screen.getByText('Rakuten Card')).toBeInTheDocument()
    expect(screen.queryByText('生協')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '支出の内訳' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /資金移動を見る/ })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('ホームの表示テンプレート'), { target: { value: 'FINANCIAL_OVERVIEW' } })
    await waitFor(() => expect(desktop.upsertDashboardPreferences).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'family', template: 'FINANCIAL_OVERVIEW' })))
    await waitFor(() => expect(desktop.queryDashboard).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'family', accountingBasis: 'ACCRUAL' })))
    expect(await screen.findByText('生協')).toBeInTheDocument()
  })

  it('does not let a delayed cash-flow response overwrite a newer accrual Home', async () => {
    desktop.getDashboardPreferences.mockResolvedValue({ householdId: 'family', template: 'CASH_FLOW', theme: 'LIGHT', density: 'COMFORTABLE', templateLayouts: dashboardLayouts(), updatedAt: '2026-07-13T00:00:00Z' })
    let resolveCash: ((value: Awaited<ReturnType<typeof desktop.queryDashboard>>) => void) | undefined
    const accrual = {
      month: '2026-07', accountingBasis: 'ACCRUAL' as const, incomeJpy: 500_000, expenseJpy: 120_000, savingsJpy: 380_000, postedTransactionCount: 1,
      netWorthAsOf: '2026-07-31', assetsJpy: 620_000, liabilitiesJpy: 120_000, netWorthJpy: 500_000,
      accrualTrend: [{ month: '2026-07', incomeJpy: 500_000, expenseJpy: 120_000 }], cashFlowTrend: Array.from({ length: 6 }, (_, index) => ({ month: `2026-${String(index + 2).padStart(2, '0')}`, inflowJpy: index === 5 ? 480_000 : 0, outflowJpy: index === 5 ? 204_987 : 0, netCashFlowJpy: index === 5 ? 275_013 : 0 })), expenseCategories: [],
    }
    desktop.queryDashboard.mockImplementation(({ accountingBasis }: { accountingBasis: 'ACCRUAL' | 'CASH' }) => accountingBasis === 'CASH'
      ? new Promise((resolve) => { resolveCash = resolve })
      : Promise.resolve(accrual))
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('ホームの表示テンプレート')).toHaveValue('CASH_FLOW'))
    await waitFor(() => expect(desktop.queryDashboard).toHaveBeenCalledWith(expect.objectContaining({ accountingBasis: 'CASH' })))

    fireEvent.change(screen.getByLabelText('ホームの表示テンプレート'), { target: { value: 'FINANCIAL_OVERVIEW' } })
    expect(await screen.findByText('生協')).toBeInTheDocument()
    resolveCash?.({ ...accrual, accountingBasis: 'CASH', incomeJpy: 480_000, expenseJpy: 204_987, savingsJpy: 275_013 })

    await waitFor(() => expect(screen.getByLabelText('ホームの表示テンプレート')).toHaveValue('FINANCIAL_OVERVIEW'))
    expect(screen.getByText('生協')).toBeInTheDocument()
    expect(screen.queryByText('差引キャッシュフロー')).not.toBeInTheDocument()
  })

  it('bulk adds transaction labels and tags without category edits', async () => {
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: '取引' }))
    await screen.findByLabelText('生協を一括編集対象に選択')

    fireEvent.click(screen.getByLabelText('生協を一括編集対象に選択'))
    fireEvent.change(screen.getByLabelText('一括編集するラベル'), { target: { value: 'TAX_DEDUCTIBLE' } })
    fireEvent.change(screen.getByLabelText('一括編集するタグ'), { target: { value: '#tax-2026, business' } })
    fireEvent.click(screen.getByRole('button', { name: '追加を適用' }))

    await waitFor(() => expect(desktop.bulkUpdateTransactionMetadata).toHaveBeenCalledWith({
      householdId: 'family', transactionIds: ['purchase'], addLabels: ['TAX_DEDUCTIBLE'], removeLabels: [], addTags: ['tax-2026', 'business'], removeTags: [],
    }))
    expect(await screen.findByText(/1件のラベル・タグを追加しました/)).toHaveTextContent('カテゴリーと仕訳は変更していません')
  })

  it('persists and forwards the global attribution scope while disclosing household-wide metrics', async () => {
    const tokyoDateParts = Object.fromEntries(new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date()).map((part) => [part.type, part.value]))
    const reportAsOf = `${tokyoDateParts.year}-${tokyoDateParts.month}-${tokyoDateParts.day}`
    const view = render(<App />)
    await screen.findByText('生協')
    const selector = await screen.findByLabelText('家族集計範囲') as HTMLSelectElement
    fireEvent.change(selector, { target: { value: 'MEMBER:taro' } })

    const memberScope = { kind: 'MEMBER', memberId: 'taro' }
    await waitFor(() => expect(desktop.queryDashboard).toHaveBeenCalledWith(expect.objectContaining({ attributionScope: memberScope })))
    expect(desktop.queryTransactions).toHaveBeenCalledWith(expect.objectContaining({ attributionScope: memberScope }))
    expect(screen.getByText(/純資産・資産残高・貯蓄目標・インポート状況は世帯全体です/)).toHaveTextContent('家族集計範囲: 太郎')
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
    fireEvent.click(screen.getByRole('tab', { name: /年次レビュー/ }))
    expect(await screen.findByText(/集計対象外・現在の未完了月・将来月は年間KPIから除外/)).toBeInTheDocument()
    await waitFor(() => expect(nativeInvoke).toHaveBeenCalledWith('financial_report_yearly_query', { request: expect.objectContaining({ householdId: 'family', accountGroupId: null, attributionScope: memberScope, year: '2026', asOf: reportAsOf }) }))
    fireEvent.click(screen.getByRole('button', { name: '年次CSVを保存' }))
    await waitFor(() => expect(nativeInvoke).toHaveBeenCalledWith('annual_household_review_csv_save', { request: expect.objectContaining({ attributionScope: memberScope, year: '2026', asOf: reportAsOf }) }))
    fireEvent.click(screen.getByRole('tab', { name: /グループ・出力/ }))
    fireEvent.click(await screen.findByRole('button', { name: '保存先を選んでCSV出力' }))
    await waitFor(() => expect(nativeInvoke).toHaveBeenCalledWith('export_csv_save', { request: expect.objectContaining({ attributionScope: memberScope }) }))

    view.unmount()
    render(<App />)
    await screen.findByText('生協')
    await waitFor(() => expect(screen.getByLabelText('家族集計範囲')).toHaveValue('MEMBER:taro'))
    fireEvent.change(screen.getByLabelText('家族集計範囲'), { target: { value: 'HOUSEHOLD_COMMON' } })
    await waitFor(() => expect(desktop.queryTransactions).toHaveBeenCalledWith(expect.objectContaining({ attributionScope: { kind: 'HOUSEHOLD_COMMON' } })))
  })

  it('preserves account and family scopes when filtering calculation-target transactions', async () => {
    accountGroupState.groups = [{
      id: 'daily', householdId: 'family', name: '生活費', groupKind: 'DAILY_SPENDING', sortOrder: 0,
      accountIds: ['family-bank', 'family-card'], createdAt: '2026-07-13T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z',
    }]
    const { container } = render(<App />)
    await screen.findByText('生協')
    const scope = await screen.findByLabelText('口座スコープ') as HTMLSelectElement
    await waitFor(() => expect(scope).toHaveDisplayValue('すべての口座'))
    fireEvent.change(scope, { target: { value: 'daily' } })
    fireEvent.change(screen.getByLabelText('家族集計範囲'), { target: { value: 'MEMBER:taro' } })

    await waitFor(() => expect(desktop.queryDashboard).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'family', accountGroupId: 'daily' })))
    expect(localStorage.getItem('kakeflow.accountScope')).toContain('daily')
    expect(container.querySelector('.scope-footnote')).toHaveTextContent('口座スコープ: 生活費')

    fireEvent.change(screen.getByLabelText('対象月'), { target: { value: '2026-08' } })
    fireEvent.click(screen.getByRole('button', { name: '取引' }))
    await waitFor(() => expect(desktop.queryTransactions).toHaveBeenCalledWith(expect.objectContaining({ accountGroupId: 'daily', attributionScope: { kind: 'MEMBER', memberId: 'taro' }, fromDate: '2026-08-01' })))
    fireEvent.click(within(screen.getByLabelText('計算対象フィルター')).getByRole('button', { name: '集計対象外' }))
    await waitFor(() => expect(desktop.queryTransactions).toHaveBeenCalledWith(expect.objectContaining({ accountGroupId: 'daily', attributionScope: { kind: 'MEMBER', memberId: 'taro' }, calculationTargetFilter: 'EXCLUDED' })))
    expect(scope).toHaveValue('daily')
    expect(screen.getByLabelText('家族集計範囲')).toHaveValue('MEMBER:taro')

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
      items: [{ id: `transaction-${page}`, occurredOn: '2026-07-10', postedOn: null, transactionType: 'EXPENSE', payee: `店舗${page}`, description: null, amountJpy: 1000, status: 'POSTED', calculationTarget: true, attributionKind: 'HOUSEHOLD', attributedMemberId: null, attributedMemberName: null, audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null }],
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
    expect(desktop.createManualTransaction.mock.calls.at(-1)?.[0]).not.toHaveProperty('calculationTarget')
    expect(await screen.findByText('手動取引を台帳に記録しました。')).toBeInTheDocument()
  })

  it('marks excluded ledger rows without removing them from the ledger', async () => {
    desktop.queryTransactions.mockResolvedValue({
      items: [{ id: 'excluded', occurredOn: '2026-07-10', postedOn: null, transactionType: 'EXPENSE', payee: '除外店舗', description: null, amountJpy: 800, status: 'POSTED', calculationTarget: false, attributionKind: 'HOUSEHOLD', attributedMemberId: null, attributedMemberName: null, audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null }],
      page: 1, pageSize: 25, totalItems: 1, totalPages: 1,
    })
    render(<App />)
    await screen.findByRole('heading', { name: '田中家の家計' })
    fireEvent.click(screen.getByRole('button', { name: '取引' }))

    const row = (await screen.findByText('除外店舗')).closest('button')!
    expect(within(row).getByText('集計対象外')).toBeInTheDocument()
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
    const calculationTarget = screen.getByRole('checkbox', { name: /家計の集計に含める/ })
    expect(calculationTarget).toBeChecked()
    expect(screen.getByText(/台帳の仕訳は削除されず、口座・カード残高も変わりません/)).toBeInTheDocument()
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
    fireEvent.click(calculationTarget)
    fireEvent.click(screen.getByRole('button', { name: '変更を保存' }))

    await waitFor(() => expect(desktop.updateTransaction).toHaveBeenCalledWith(expect.objectContaining({
      householdId: 'family', transactionId: 'purchase', description: '週末の食料品',
      calculationTarget: false,
      attributionKind: 'MEMBER', attributedMemberId: 'taro', audienceVisibility: 'SHARED', audienceMemberId: null,
      entries: expect.arrayContaining([expect.objectContaining({ accountId: 'family-other-expense', side: 'DEBIT', amountJpy: 120000 }), expect.objectContaining({ accountId: 'family-card', side: 'CREDIT', amountJpy: 120000 })]),
    })))
    expect(await screen.findByText('取引と仕訳を更新しました。')).toBeInTheDocument()
  })

  it('hydrates a durable folder item in the background without exposing its absolute path or posting it', async () => {
    desktop.listWatchedFolders.mockResolvedValue([{ id: 'folder', householdId: 'family', label: '家計簿 Inbox', displayName: 'KakeFlow', isEnabled: true, createdAt: '2026-07-12T00:00:00Z' }])
    desktop.scanWatchedFolder.mockResolvedValue({ watchedFolderId: 'folder', files: [{ relativePath: 'PayPay/history.csv', fileName: 'history.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000 }] })
    desktop.readWatchedFile.mockResolvedValue({ relativePath: 'PayPay/history.csv', fileName: 'history.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fileBytes: [97, 44, 98] })
    const discovered = { id: 'inbox-1', householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: '家計簿 Inbox', relativePath: 'PayPay/history.csv', fileName: 'history.csv', mediaType: 'text/csv', byteSize: 3, modifiedUnixMs: 1000, fingerprint: 'fingerprint', state: 'DISCOVERED', attemptCount: 0, importRunId: null, lastErrorCode: null, discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:00:00Z' }
    desktop.listWatchedFileInbox.mockResolvedValue([discovered])
    desktop.countWatchedFileInbox.mockResolvedValue({ discovered: 1, processing: 0, ready: 0, needsMapping: 0, staged: 0, failed: 0, ignored: 0, removed: 0, actionable: 1, total: 1 })
    desktop.claimWatchedFileInboxItems.mockResolvedValue({ leaseToken: 'lease', leaseExpiresAt: '2026-07-12T00:05:00Z', items: [{ ...discovered, state: 'PROCESSING', attemptCount: 1 }] })
    desktop.markWatchedFileInboxNeedsMapping.mockResolvedValue({ ...discovered, state: 'NEEDS_MAPPING', attemptCount: 1 })
    render(<App />)
    await screen.findByText('生協')
    await waitFor(() => expect(desktop.readWatchedFile).toHaveBeenCalledWith('family', 'folder', 'PayPay/history.csv'))
    await waitFor(() => expect(desktop.markWatchedFileInboxNeedsMapping).toHaveBeenCalledWith('family', 'inbox-1', 'lease'))
    expect(desktop.startImport).not.toHaveBeenCalled()
    expect(desktop.commitImport).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'インポート（1件の確認対象）' }))
    expect(await screen.findByText('history.csv')).toBeInTheDocument()
    expect(screen.queryByText(/Users|Documents|C:\\/)).not.toBeInTheDocument()
  })

  it('recovers a manually staged review after restart and commits it exactly once', async () => {
    const pending = { householdId: 'family', runs: [{ runId: 'run-1', documentId: 'document-1', status: 'REVIEW_REQUIRED', adapterId: 'japanese-bank-ledger-v1', adapterVersion: '1', startedAt: '2026-07-13T00:00:00Z', sourceType: 'MANUAL_UPLOAD', originalFilename: 'bank.csv', mediaType: 'text/csv', byteSize: 42, sourceModifiedAt: null, recordCount: 1, candidateCount: 1 }] }
    desktop.listPendingReviews.mockResolvedValueOnce(pending).mockResolvedValue({ householdId: 'family', runs: [] })
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))

    expect(await screen.findByText('RECOVERED')).toBeInTheDocument()
    expect(screen.getByText(/再起動後に復元/)).toBeInTheDocument()
    expect(desktop.previewImport).toHaveBeenCalledWith('run-1')
    expect(desktop.commitImport).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'STOREを承認' }))
    const commitButton = screen.getByRole('button', { name: '承認済みを台帳へ反映' })
    fireEvent.click(commitButton)
    fireEvent.click(commitButton)

    await waitFor(() => expect(desktop.commitImport).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText('RECOVERED')).not.toBeInTheDocument())
    expect(await screen.findByText('1件の取引を台帳へ反映しました。')).toBeInTheDocument()
  })

  it('recovers and finalizes a zero-candidate source run without inventing a transaction', async () => {
    desktop.listPendingReviews.mockResolvedValueOnce({ householdId: 'family', runs: [{ runId: 'run-zero', documentId: 'document-zero', status: 'REVIEW_REQUIRED', adapterId: 'securities-asset-snapshot-v1', adapterVersion: '1', startedAt: '2026-07-13T00:00:00Z', sourceType: 'MANUAL_UPLOAD', originalFilename: 'assetbalance.csv', mediaType: 'text/csv', byteSize: 42, sourceModifiedAt: null, recordCount: 3, candidateCount: 0, completionState: 'SOURCE_READY' }] }).mockResolvedValue({ householdId: 'family', runs: [] })
    desktop.previewImport.mockResolvedValueOnce({
      summary: { runId: 'run-zero', documentId: 'document-zero', status: 'REVIEW_REQUIRED', recordCount: 3, candidateCount: 0, reusedExisting: false },
      source: { sourceType: 'MANUAL_UPLOAD', originalFilename: 'assetbalance.csv', mediaType: 'text/csv', byteSize: 42, sha256: 'hash-zero', audienceVisibility: 'SHARED', audienceMemberId: null },
      candidates: [],
    })
    desktop.commitImport.mockResolvedValueOnce({ runId: 'run-zero', postedCount: 0 })
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))

    expect(await screen.findByText('台帳候補のない原本処理です。内容を確認して完了するか、取り消してください。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '原本処理を完了' }))
    await waitFor(() => expect(desktop.commitImport).toHaveBeenCalledWith('run-zero', []))
    expect(await screen.findByText('取引を追加せず原本処理を完了しました。')).toBeInTheDocument()
  })

  it('never finalizes an interrupted investment import before its domain data is stored', async () => {
    desktop.listPendingReviews.mockResolvedValue({ householdId: 'family', runs: [{ runId: 'run-resume', documentId: 'document-resume', status: 'REVIEW_REQUIRED', adapterId: 'securities-asset-snapshot-v1', adapterVersion: '1', startedAt: '2026-07-13T00:00:00Z', sourceType: 'MANUAL_UPLOAD', originalFilename: 'assetbalance-interrupted.csv', mediaType: 'text/csv', byteSize: 42, sourceModifiedAt: null, recordCount: 3, candidateCount: 0, completionState: 'SOURCE_RESUME_REQUIRED' }] })
    desktop.previewImport.mockResolvedValueOnce({
      summary: { runId: 'run-resume', documentId: 'document-resume', status: 'REVIEW_REQUIRED', recordCount: 3, candidateCount: 0, reusedExisting: false },
      source: { sourceType: 'MANUAL_UPLOAD', originalFilename: 'assetbalance-interrupted.csv', mediaType: 'text/csv', byteSize: 42, sha256: 'hash-resume', audienceVisibility: 'SHARED', audienceMemberId: null },
      candidates: [],
    })
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('専用データの保存が完了する前に中断されました')
    expect(screen.queryByRole('button', { name: '原本処理を完了' })).not.toBeInTheDocument()
    expect(desktop.commitImport).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取り消して再取込' }))
    await waitFor(() => expect(desktop.rollbackImport).toHaveBeenCalledWith('run-resume'))
    expect(desktop.commitImport).not.toHaveBeenCalled()
  })

  it('keeps successful previews when another pending run fails to preview', async () => {
    const runs = [
      { runId: 'run-good', documentId: 'document-good', status: 'REVIEW_REQUIRED', adapterId: 'japanese-bank-ledger-v1', adapterVersion: '1', startedAt: '2026-07-13T00:01:00Z', sourceType: 'MANUAL_UPLOAD', originalFilename: 'good.csv', mediaType: 'text/csv', byteSize: 42, sourceModifiedAt: null, recordCount: 1, candidateCount: 1 },
      { runId: 'run-raced', documentId: 'document-raced', status: 'REVIEW_REQUIRED', adapterId: null, adapterVersion: null, startedAt: '2026-07-13T00:00:00Z', sourceType: 'MANUAL_UPLOAD', originalFilename: 'raced.csv', mediaType: 'text/csv', byteSize: 42, sourceModifiedAt: null, recordCount: 1, candidateCount: 1 },
    ]
    desktop.listPendingReviews.mockResolvedValue({ householdId: 'family', runs })
    desktop.previewImport.mockImplementation(async (runId: string) => {
      if (runId === 'run-raced') throw new Error('already posted')
      return {
        summary: { runId: 'run-good', documentId: 'document-good', status: 'REVIEW_REQUIRED', recordCount: 1, candidateCount: 1, reusedExisting: false },
        source: { sourceType: 'MANUAL_UPLOAD', originalFilename: 'good.csv', mediaType: 'text/csv', byteSize: 42, sha256: 'hash-good', audienceVisibility: 'SHARED', audienceMemberId: null },
        candidates: [{ id: 'candidate-good', accountId: 'family-bank', occurredOn: '2026-07-12', postedOn: null, amountJpy: 1200, direction: 'OUT', descriptionRaw: 'GOOD', merchantRaw: 'GOOD', externalTransactionId: null, extractionConfidenceBps: 10000, normalizationConfidenceBps: 10000, attributionKind: 'HOUSEHOLD', attributedMemberId: null, audienceVisibility: 'SHARED', audienceMemberId: null, reviewStatus: 'READY', evidenceCount: 1, evidenceRoles: ['PRIMARY'], issues: [] }],
      }
    })
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))

    expect(await screen.findByText('good.csv')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('1件の確認待ちを復元できませんでした')
    expect(screen.queryByText('raced.csv')).not.toBeInTheDocument()
  })

  it('keeps a recovered run removable when its source account no longer exists', async () => {
    desktop.listPendingReviews.mockResolvedValue({ householdId: 'family', runs: [{ runId: 'run-missing', documentId: 'document-missing', status: 'REVIEW_REQUIRED', adapterId: 'japanese-bank-ledger-v1', adapterVersion: '1', startedAt: '2026-07-13T00:00:00Z', sourceType: 'MANUAL_UPLOAD', originalFilename: 'archived-account.csv', mediaType: 'text/csv', byteSize: 42, sourceModifiedAt: null, recordCount: 1, candidateCount: 1 }] })
    desktop.previewImport.mockResolvedValueOnce({
      summary: { runId: 'run-missing', documentId: 'document-missing', status: 'REVIEW_REQUIRED', recordCount: 1, candidateCount: 1, reusedExisting: false },
      source: { sourceType: 'MANUAL_UPLOAD', originalFilename: 'archived-account.csv', mediaType: 'text/csv', byteSize: 42, sha256: 'hash-missing', audienceVisibility: 'SHARED', audienceMemberId: null },
      candidates: [{ id: 'candidate-missing', accountId: 'archived-bank', occurredOn: '2026-07-12', postedOn: null, amountJpy: 1200, direction: 'OUT', descriptionRaw: 'STORE', merchantRaw: 'STORE', externalTransactionId: null, extractionConfidenceBps: 10000, normalizationConfidenceBps: 10000, attributionKind: 'HOUSEHOLD', attributedMemberId: null, audienceVisibility: 'SHARED', audienceMemberId: null, reviewStatus: 'READY', evidenceCount: 1, evidenceRoles: ['PRIMARY'], issues: [] }],
    })
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('取込先または相手勘定が見つかりません')
    expect(desktop.commitImport).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取り消す' }))
    await waitFor(() => expect(desktop.rollbackImport).toHaveBeenCalledWith('run-missing'))
  })

  it('rolls back a recovered manual review without posting it', async () => {
    desktop.listPendingReviews.mockResolvedValueOnce({ householdId: 'family', runs: [{ runId: 'run-1', documentId: 'document-1', status: 'REVIEW_REQUIRED', adapterId: null, adapterVersion: null, startedAt: '2026-07-13T00:00:00Z', sourceType: 'MANUAL_UPLOAD', originalFilename: 'bank.csv', mediaType: 'text/csv', byteSize: 42, sourceModifiedAt: null, recordCount: 1, candidateCount: 1 }] }).mockResolvedValue({ householdId: 'family', runs: [] })
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    expect(await screen.findByText('RECOVERED')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取り消す' }))

    await waitFor(() => expect(desktop.rollbackImport).toHaveBeenCalledWith('run-1'))
    expect(desktop.commitImport).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('RECOVERED')).not.toBeInTheDocument())
  })

  it('keeps a recovered review on list failure and retries without a false empty state', async () => {
    const pending = { householdId: 'family', runs: [{ runId: 'run-1', documentId: 'document-1', status: 'REVIEW_REQUIRED', adapterId: null, adapterVersion: null, startedAt: '2026-07-13T00:00:00Z', sourceType: 'MANUAL_UPLOAD', originalFilename: 'bank.csv', mediaType: 'text/csv', byteSize: 42, sourceModifiedAt: null, recordCount: 1, candidateCount: 1 }] }
    desktop.listPendingReviews.mockResolvedValueOnce(pending).mockRejectedValueOnce(new Error('temporary')).mockResolvedValue({ householdId: 'family', runs: [] })
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    expect(await screen.findByText('RECOVERED')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '確認待ちを更新' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('確認待ちのインポートを復元できませんでした')
    expect(screen.getByText('RECOVERED')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '再試行' }))
    await waitFor(() => expect(desktop.listPendingReviews).toHaveBeenCalledTimes(3))
  })

  it('rehydrates a staged folder review whenever Import Inbox remounts and never auto-posts it', async () => {
    const stagedItem = { id: 'inbox-staged', householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: '家計簿 Inbox', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 42, modifiedUnixMs: 1000, fingerprint: 'fingerprint', state: 'STAGED', attemptCount: 2, importRunId: 'run-1', lastErrorCode: null, discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:02:00Z' }
    desktop.listPendingReviews.mockResolvedValue({ householdId: 'family', runs: [{ runId: 'run-1', documentId: 'document-1', status: 'REVIEW_REQUIRED', adapterId: 'japanese-bank-ledger-v1', adapterVersion: '1', startedAt: '2026-07-12T00:01:00Z', sourceType: 'LOCAL_FOLDER', originalFilename: 'bank.csv', mediaType: 'text/csv', byteSize: 42, sourceModifiedAt: '2026-07-12T00:00:01Z', recordCount: 1, candidateCount: 1, completionState: 'CANDIDATE_REVIEW' }] })
    desktop.listWatchedFileInbox.mockResolvedValue([stagedItem])
    desktop.countWatchedFileInbox.mockResolvedValue({ discovered: 0, processing: 0, ready: 0, needsMapping: 0, staged: 1, failed: 0, ignored: 0, removed: 0, actionable: 0, total: 1 })
    desktop.retryWatchedFileInboxItem.mockResolvedValue(undefined)
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    expect(await screen.findByRole('button', { name: '承認済みを台帳へ反映' })).toBeDisabled()
    expect(screen.getAllByRole('button', { name: '承認済みを台帳へ反映' })).toHaveLength(1)
    expect(desktop.commitImport).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'ホーム' }))
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    expect(await screen.findByRole('button', { name: '承認済みを台帳へ反映' })).toBeDisabled()
    expect(screen.getAllByRole('button', { name: '承認済みを台帳へ反映' })).toHaveLength(1)
    await waitFor(() => expect(desktop.previewImport.mock.calls.filter(([runId]) => runId === 'run-1').length).toBeGreaterThanOrEqual(2))
    expect(desktop.commitImport).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取り消す' }))
    await waitFor(() => expect(desktop.rollbackImport).toHaveBeenCalledWith('run-1'))
    await waitFor(() => expect(desktop.retryWatchedFileInboxItem).toHaveBeenCalledWith('family', 'inbox-staged'))
  })

  it('keeps auto-preview off while still exposing an app-wide actionable Inbox badge', async () => {
    localStorage.setItem('kakeflow.folder-auto-scan', 'off')
    const discovered = { id: 'inbox-off', householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: 42, modifiedUnixMs: 1000, fingerprint: 'fingerprint', state: 'DISCOVERED', attemptCount: 0, importRunId: null, lastErrorCode: null, discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:00:00Z' }
    desktop.listWatchedFileInbox.mockResolvedValue([discovered])
    desktop.countWatchedFileInbox.mockResolvedValue({ discovered: 1, processing: 0, ready: 0, needsMapping: 0, staged: 0, failed: 0, ignored: 0, removed: 0, actionable: 1, total: 1 })
    render(<App />)
    await screen.findByText('生協')
    expect(await screen.findByRole('button', { name: 'インポート（1件の確認対象）' })).toBeInTheDocument()
    expect(desktop.claimWatchedFileInboxItems).not.toHaveBeenCalled()
    expect(desktop.readWatchedFile).not.toHaveBeenCalled()
  })

  it('never marks a canonical import failed when only the STAGED acknowledgement fails', async () => {
    localStorage.setItem('kakeflow.folder-auto-scan', 'off')
    const csv = '日付,摘要,支払い金額,預かり金額,差引残高\n2026/07/12,STORE,1200,,10000'
    const bytes = [...new TextEncoder().encode(csv)]
    const ready = { id: 'inbox-ready', householdId: 'family', watchedFolderId: 'folder', watchedFolderLabel: 'Inbox', relativePath: 'bank.csv', fileName: 'bank.csv', mediaType: 'text/csv', byteSize: bytes.length, modifiedUnixMs: 1000, fingerprint: 'fingerprint', state: 'READY', attemptCount: 1, importRunId: null, lastErrorCode: null, discoveredAt: '2026-07-12T00:00:00Z', updatedAt: '2026-07-12T00:01:00Z' }
    desktop.listWatchedFileInbox.mockResolvedValue([ready])
    desktop.countWatchedFileInbox.mockResolvedValue({ discovered: 0, processing: 0, ready: 1, needsMapping: 0, staged: 0, failed: 0, ignored: 0, removed: 0, actionable: 1, total: 1 })
    desktop.claimWatchedFileInboxItems.mockImplementation(async () => ({ leaseToken: 'lease', leaseExpiresAt: '2026-07-12T00:05:00Z', items: [{ ...ready, state: 'PROCESSING', attemptCount: 2 }] }))
    desktop.readWatchedFile.mockResolvedValue({ relativePath: ready.relativePath, fileName: ready.fileName, mediaType: ready.mediaType, byteSize: ready.byteSize, modifiedUnixMs: ready.modifiedUnixMs, fileBytes: bytes })
    desktop.markWatchedFileInboxReady.mockResolvedValue(ready)
    desktop.markWatchedFileInboxStaged.mockRejectedValue(new Error('ack failed'))
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(await screen.findByRole('button', { name: 'インポート（1件の確認対象）' }))
    fireEvent.click(await screen.findByRole('button', { name: '更新' }))
    fireEvent.change(await screen.findByLabelText('bank.csvの取込先銀行口座'), { target: { value: 'family-bank' } })
    fireEvent.click(await screen.findByRole('button', { name: '取込開始' }))
    await waitFor(() => expect(desktop.startImport).toHaveBeenCalled())
    await waitFor(() => expect(desktop.markWatchedFileInboxStaged).toHaveBeenCalledWith('family', 'inbox-ready', 'lease', 'run-1'))
    expect(desktop.markWatchedFileInboxFailed).not.toHaveBeenCalled()
  })

  it('shows cumulative card payments and explicitly confirms one eligible payment', async () => {
    const partial = {
      id: 'statement-1', cardAccountId: 'family-rakuten-card', cardName: 'Rakuten Card', maskedIdentifier: '•••• 8106',
      periodStart: '2026-06-01', periodEnd: '2026-06-30', paymentDueOn: null,
      statementAmountJpy: 204_987, detailAmountJpy: 204_987, lineCount: 15,
      paymentId: 'payment-1', bankTransactionId: 'bank-payment-1', paymentAmountJpy: 100_000,
      paymentOn: '2026-07-20', matchScoreBps: 9000, reconciliationStatus: 'PARTIALLY_RECONCILED',
      paidAmountJpy: 100_000, outstandingAmountJpy: 104_987, overpaidAmountJpy: 0,
      payments: [{ paymentId: 'payment-1', bankTransactionId: 'bank-payment-1', paymentAmountJpy: 100_000, paymentOn: '2026-07-20', matchScoreBps: 9000 }],
      eligiblePayments: [{ paymentId: 'payment-2', bankTransactionId: 'bank-payment-2', paymentAmountJpy: 104_987, paymentOn: '2026-07-27', matchScoreBps: null }],
    } as const
    desktop.listCardSettlements.mockResolvedValue([
      partial,
      { ...partial, id: 'statement-full', cardName: 'Full Card', statementAmountJpy: 50_000, detailAmountJpy: 50_000, paymentId: 'full-payment', bankTransactionId: 'full-bank', paymentAmountJpy: 50_000, matchScoreBps: 10000, reconciliationStatus: 'FULLY_RECONCILED', paidAmountJpy: 50_000, outstandingAmountJpy: 0, payments: [{ paymentId: 'full-payment', bankTransactionId: 'full-bank', paymentAmountJpy: 50_000, paymentOn: '2026-07-20', matchScoreBps: 10000 }], eligiblePayments: [] },
      { ...partial, id: 'statement-overpaid', cardName: 'Overpaid Card', statementAmountJpy: 40_000, detailAmountJpy: 40_000, paymentId: 'over-payment', bankTransactionId: 'over-bank', paymentAmountJpy: 45_000, reconciliationStatus: 'OVERPAID', paidAmountJpy: 45_000, outstandingAmountJpy: 0, overpaidAmountJpy: 5_000, payments: [{ paymentId: 'over-payment', bankTransactionId: 'over-bank', paymentAmountJpy: 45_000, paymentOn: '2026-07-20', matchScoreBps: null }], eligiblePayments: [] },
    ])
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'カード照合' }))

    expect(await screen.findByText('一部支払済み')).toBeInTheDocument()
    expect(screen.getByText('✓ 全額照合')).toBeInTheDocument()
    expect(screen.getAllByText('過払い').some((element) => element.classList.contains('overpaid'))).toBe(true)
    expect(screen.getAllByText('¥100,000').length).toBeGreaterThan(0)
    expect(screen.getAllByText('¥104,987').length).toBeGreaterThan(0)
    expect(screen.getByText(/一致度未算出/)).toBeInTheDocument()
    expect(screen.getAllByText('確認済み').length).toBe(3)
    expect(desktop.confirmCardPaymentLink).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'この引落を確認して紐付け' }))

    await waitFor(() => expect(desktop.confirmCardPaymentLink).toHaveBeenCalledWith('family', 'statement-1', 'payment-2'))
    expect(desktop.confirmCardMatch).not.toHaveBeenCalled()
    expect(await screen.findByText('選択した口座引落を請求に紐付けました。仕訳や支払いは変更していません。')).toBeInTheDocument()
  })

  it('saves an explicit card-to-bank mapping and shows projected coverage and unmapped warnings', async () => {
    desktop.queryCardSettlementBalanceCoverage.mockResolvedValue({
      asOf: '2026-07-13', historyFrom: '2025-07-13', horizonThrough: '2026-08-27', horizonDays: 45,
      banks: [{
        bankAccountId: 'family-bank', bankAccountName: '銀行', balanceAsOfJpy: 100_000, projectedEndingBalanceJpy: -20_000, maxShortfallJpy: 20_000,
        statements: [{ statementId: 'due-1', cardAccountId: 'family-card', cardAccountName: 'カード', paymentDueOn: '2026-07-27', statementAmountJpy: 120_000, paidAmountJpy: 0, outstandingAmountJpy: 120_000, projectedBankBalanceJpy: -20_000, shortfallJpy: 20_000, status: 'SHORTFALL' }],
      }],
      unmappedStatements: [{ statementId: 'unmapped-1', cardAccountId: 'other-card', cardAccountName: '未設定カード', paymentDueOn: '2026-08-10', statementAmountJpy: 30_000, paidAmountJpy: 0, outstandingAmountJpy: 30_000, status: 'UNMAPPED' }],
      missingDueStatements: [{ statementId: 'missing-date-1', cardAccountId: 'family-card', cardAccountName: '期日未登録カード', statementAmountJpy: 20_000, paidAmountJpy: 0, outstandingAmountJpy: 20_000, mappingConfigured: true }],
    })
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'カード照合' }))

    expect(await screen.findByRole('heading', { name: 'カード引落・支払余力' })).toBeInTheDocument()
    expect(screen.getByText(/明示した設定だけを使用し、取引名から推測しません/)).toBeInTheDocument()
    expect(screen.getByText(/「集計対象外」を含むすべての確定済み仕訳/)).toBeInTheDocument()
    expect(screen.getByText('現在残高 ¥100,000')).toBeInTheDocument()
    expect(screen.getAllByText('−¥20,000')).toHaveLength(2)
    expect(screen.getByText('残高不足')).toBeInTheDocument()
    expect(screen.getByText('未設定カード')).toBeInTheDocument()
    expect(screen.getByText(/支払余力の計算にも含めません/)).toBeInTheDocument()
    expect(screen.getByText('期日未登録カード')).toBeInTheDocument()
    expect(screen.getByText(/支払期日がないため予測から除外/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('カードの引落銀行口座'), { target: { value: 'family-bank' } })
    fireEvent.click(within(screen.getByLabelText('カード引落口座設定')).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(desktop.upsertCardSettlementBankMapping).toHaveBeenCalledWith({ householdId: 'family', cardAccountId: 'family-card', bankAccountId: 'family-bank' }))
    expect(await screen.findByText('明示したカード引落口座を保存しました。')).toBeInTheDocument()
    expect(desktop.queryCardSettlementBalanceCoverage).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'family', horizonDays: 45 }))

    const dueDate = screen.getByLabelText('期日未登録カードの未登録支払期日')
    fireEvent.change(dueDate, { target: { value: '2026-07-28' } })
    desktop.updateCardStatementDueDate.mockRejectedValueOnce(new Error('invalid'))
    fireEvent.click(within(dueDate.closest('label')!).getByRole('button', { name: '保存' }))
    expect(await screen.findByText(/明細期間以降の正しい日付/)).toBeInTheDocument()
    expect(dueDate).toHaveValue('2026-07-28')

    const retryDueDate = screen.getByLabelText('期日未登録カードの未登録支払期日')
    const retry = within(retryDueDate.closest('label')!).getByRole('button', { name: '保存' })
    await waitFor(() => expect(retry).toBeEnabled())
    fireEvent.click(retry)
    await waitFor(() => expect(desktop.updateCardStatementDueDate).toHaveBeenLastCalledWith({ householdId: 'family', statementId: 'missing-date-1', paymentDueOn: '2026-07-28' }))
    expect(await screen.findByText(/ユーザー確認済みの支払期日を保存/)).toBeInTheDocument()
  })

  it('shows Money Forward total-assets history without treating it as net worth', async () => {
    render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: '資産・投資' }))

    expect(await screen.findByRole('heading', { name: '総資産履歴（Money Forward）' })).toBeInTheDocument()
    expect(screen.getByText('資産のみ・純資産ではありません')).toBeInTheDocument()
    expect(screen.getByText(/台帳、収支、口座残高、現在の純資産には加算しません/)).toBeInTheDocument()
    expect(screen.getByText('+¥200,000')).toBeInTheDocument()
    await waitFor(() => expect(nativeInvoke).toHaveBeenCalledWith('aggregate_asset_history_list', { request: { householdId: 'family', limit: 240 } }))
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
    const start = await screen.findByRole('button', { name: '取込開始' })
    fireEvent.click(start)
    expect(await screen.findByText('銀行CSVの取込先銀行口座を選択してください。')).toBeInTheDocument()
    expect(desktop.startImport).not.toHaveBeenCalled()
    const account = screen.getByLabelText('bank.csvの取込先銀行口座')
    expect(within(account).queryByRole('option', { name: 'カード' })).not.toBeInTheDocument()
    fireEvent.change(account, { target: { value: 'family-bank' } })
    fireEvent.click(start)
    await waitFor(() => expect(desktop.startImport).toHaveBeenCalledWith(expect.objectContaining({ audienceVisibility: 'SHARED', audienceMemberId: null, candidates: [expect.objectContaining({ attributionKind: 'HOUSEHOLD', attributedMemberId: null, audienceVisibility: 'SHARED', audienceMemberId: null })] }), expect.any(Uint8Array)))

    const commit = await screen.findByRole('button', { name: '承認済みを台帳へ反映' })
    expect(commit).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'STOREを承認' }))
    expect(commit).toBeEnabled()
    fireEvent.click(commit)

    await waitFor(() => expect(desktop.commitImport).toHaveBeenCalledWith('run-1', [expect.objectContaining({ candidateId: 'candidate-1', transactionType: 'EXPENSE', attributionKind: 'HOUSEHOLD', attributedMemberId: null, audienceVisibility: 'SHARED', audienceMemberId: null })]))
  })

  it.each([
    {
      name: 'PayPay', filename: 'paypay.csv', accountLabel: 'paypay.csvの取込先ウォレット口座', accountId: 'family-wallet', missing: 'PayPay履歴の取込先ウォレット口座を選択してください。', adapterId: 'paypay-history-v1',
      csv: 'Date & Time,Amount Outgoing (Yen),Amount Incoming (Yen),Transaction Type,Payment Option,Transaction ID,Description\n2026/07/12 12:00,1200,,Payment,PayPay Balance,pay-1,STORE',
    },
    {
      name: 'Rakuten', filename: 'rakuten.csv', accountLabel: 'rakuten.csvの取込先カード口座', accountId: 'family-card', missing: '楽天カード明細の取込先カード口座を選択してください。', adapterId: 'rakuten-enavi-v1',
      csv: '利用日,利用店名・商品名,利用者,支払方法,利用金額,7月支払金額\n2026/06/12,STORE,本人,一括,1200,1200',
    },
    {
      name: 'Amazon', filename: 'amazon.csv', accountLabel: 'amazon.csvの取込先カード口座', accountId: 'family-card', missing: 'Amazon Mastercard明細の取込先カード口座を選択してください。', adapterId: 'amazon-mastercard-statement-v1',
      csv: '田中太郎,****1234,Amazon Mastercard\n2026/06/12,STORE,1200,一括\n合計,,,1200',
    },
    {
      name: 'JCB', filename: 'myjcb.csv', accountLabel: 'myjcb.csvの取込先カード口座', accountId: 'family-card', missing: 'JCB明細の取込先カード口座を選択してください。', adapterId: 'jcb-myjcb-statement-v1',
      csv: 'JCBカードご利用代金明細\nご利用日,ご利用先など,お支払い金額(円),支払区分\n2026/06/12,架空ストア,1200,ショッピング\n,お支払い合計,1200,',
    },
    {
      name: 'SMBC Vpass', filename: 'vpass.csv', accountLabel: 'vpass.csvの取込先カード口座', accountId: 'family-card', missing: '三井住友カード（Vpass）明細の取込先カード口座を選択してください。', adapterId: 'smbc-vpass-statement-v1',
      csv: 'VPASSガイド 様,****1234,三井住友カード NL\n2026/06/12,架空ストア,1200,1,1,1200,,,,,\n,,,,,1200,,,,,',
    },
  ])('requires the explicit adapter-compatible account for $name', async ({ filename, accountLabel, accountId, missing, adapterId, csv }) => {
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(input, { target: { files: [new File([csv], filename, { type: 'text/csv' })] } })

    const start = await screen.findByRole('button', { name: '取込開始' })
    fireEvent.click(start)
    expect(await screen.findByText(missing)).toBeInTheDocument()
    expect(desktop.startImport).not.toHaveBeenCalled()
    const account = screen.getByLabelText(accountLabel)
    if (accountId === 'family-card') expect(within(account).queryByRole('option', { name: '銀行' })).not.toBeInTheDocument()
    else expect(within(account).queryByRole('option', { name: 'カード' })).not.toBeInTheDocument()
    fireEvent.change(account, { target: { value: accountId } })
    fireEvent.click(start)
    await waitFor(() => expect(desktop.startImport).toHaveBeenCalledWith(expect.objectContaining({
      adapterId,
      candidates: [expect.objectContaining({ accountId })],
      ...(accountId === 'family-card' ? { cardStatements: [expect.objectContaining({ cardAccountId: accountId })] } : {}),
    }), expect.any(Uint8Array)))
  })

  it('requires an explicit securities account for SBI trades and never posts a household transaction', async () => {
    desktop.listAccounts.mockResolvedValue([
      { id: 'family-bank', name: '銀行', accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
      { id: 'sbi-general', name: 'SBI証券 一般口座', accountKind: 'ASSET', accountSubtype: 'SECURITIES', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
      { id: 'sbi-nisa', name: 'SBI証券 NISA', accountKind: 'ASSET', accountSubtype: 'SECURITIES', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
      { id: 'family-other-expense', name: 'その他', accountKind: 'EXPENSE', accountSubtype: 'OTHER', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
      { id: 'family-income', name: '収入', accountKind: 'INCOME', accountSubtype: 'OTHER', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
    ])
    desktop.startImport.mockResolvedValue({ runId: 'run-sbi', documentId: 'document-sbi', status: 'REVIEW_REQUIRED', recordCount: 1, candidateCount: 0, reusedExisting: false })
    desktop.commitImport.mockResolvedValue({ runId: 'run-sbi', postedCount: 0 })
    const fallback = nativeInvoke.getMockImplementation()!
    nativeInvoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => command === 'brokerage_events_import'
      ? { sourceDocumentId: 'document-sbi', importedEventCount: 1, importedLegCount: 4 }
      : fallback(command, args))

    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const csv = '約定日,銘柄,取引,預り,約定数量,約定単価,受渡日,受渡金額／決済損益\n2026/07/01,7203 トヨタ自動車 東証,株式現物買,特定,100,2500,2026/07/03,250000'
    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [new File([csv], 'sbi-trades.csv', { type: 'text/csv' })] } })

    const save = await screen.findByRole('button', { name: '証券取引に保存' })
    expect(save).toBeDisabled()
    expect(desktop.startImport).not.toHaveBeenCalled()
    const account = screen.getByLabelText('sbi-trades.csvの取込先証券口座')
    expect(within(account).queryByRole('option', { name: '銀行' })).not.toBeInTheDocument()
    fireEvent.change(account, { target: { value: 'sbi-nisa' } })
    expect(save).toBeEnabled()
    fireEvent.click(save)

    await waitFor(() => expect(desktop.startImport).toHaveBeenCalledWith(expect.objectContaining({
      adapterId: 'sbi-securities-trade-history-v1', candidates: [], cardStatements: [],
    }), expect.any(Uint8Array)))
    await waitFor(() => expect(nativeInvoke).toHaveBeenCalledWith('brokerage_events_import', { input: expect.objectContaining({ accountId: 'sbi-nisa', sourceDocumentId: 'document-sbi' }) }))
    expect(desktop.commitImport).toHaveBeenCalledWith('run-sbi', [])
  })

  it('requires and applies one explicit account mapping per Money Forward institution', async () => {
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const csv = [
      '計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID',
      '1,2026/07/12,給与,300000,MUFG,収入,給与,7月分,0,mf-1',
      '1,2026/07/13,カード利用,-1200,楽天カード,食費,食料品,昼食,0,mf-2',
    ].join('\n')
    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [new File([csv], 'money-forward.csv', { type: 'text/csv' })] } })

    const start = await screen.findByRole('button', { name: '取込開始' })
    expect(start).toBeDisabled()
    fireEvent.change(screen.getByLabelText('money-forward.csvのMUFG取込先口座'), { target: { value: 'family-bank' } })
    expect(start).toBeDisabled()
    fireEvent.change(screen.getByLabelText('money-forward.csvの楽天カード取込先口座'), { target: { value: 'family-card' } })
    expect(start).toBeEnabled()
    fireEvent.click(start)

    await waitFor(() => expect(desktop.startImport).toHaveBeenCalledWith(expect.objectContaining({
      adapterId: 'money-forward-me-household-ledger-v1',
      candidates: [
        expect.objectContaining({ institutionRaw: 'MUFG', accountId: 'family-bank', direction: 'IN' }),
        expect.objectContaining({ institutionRaw: '楽天カード', accountId: 'family-card', direction: 'OUT' }),
      ],
    }), expect.any(Uint8Array)))
  })

  it('explains and disables Money Forward mapping when no Asset or Liability account exists', async () => {
    desktop.listAccounts.mockResolvedValue([
      { id: 'family-other-expense', name: 'その他', accountKind: 'EXPENSE', accountSubtype: 'OTHER', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
      { id: 'family-income', name: '収入', accountKind: 'INCOME', accountSubtype: 'OTHER', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
    ])
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const csv = '計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID\n1,2026/07/12,給与,300000,MUFG,収入,給与,,0,mf-1'
    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [new File([csv], 'money-forward.csv', { type: 'text/csv' })] } })

    const explanation = await screen.findByText('設定ページで先に資産または負債口座を追加してください。追加するまで取込は開始できません。')
    const selector = screen.getByLabelText('money-forward.csvのMUFG取込先口座')
    const start = screen.getByRole('button', { name: '取込開始' })
    expect(selector).toBeDisabled()
    expect(selector).toHaveAttribute('aria-describedby', explanation.id)
    expect(start).toBeDisabled()
    expect(start).toHaveAttribute('aria-describedby', explanation.id)
    expect(desktop.startImport).not.toHaveBeenCalled()
  })

  it('disables Vpass staging and explains the Settings prerequisite when no card account exists', async () => {
    desktop.listAccounts.mockResolvedValue([
      { id: 'family-bank', name: '銀行', accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
      { id: 'family-other-expense', name: 'その他', accountKind: 'EXPENSE', accountSubtype: 'OTHER', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
    ])
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const csv = '架空 太郎 様,4980-****-****-1234,三井住友カード(NL)\n2026/06/12,架空ストア,1200,1,1,1200,,,,,\n,,,,,1200,,,,,'
    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [new File([csv], 'vpass.csv', { type: 'text/csv' })] } })

    expect(await screen.findByText('設定ページで先にカード口座を追加してください。追加するまで取込は開始できません。')).toBeInTheDocument()
    expect(screen.getByLabelText('vpass.csvの取込先カード口座')).toBeDisabled()
    const start = screen.getByRole('button', { name: '取込開始' })
    expect(start).toBeDisabled()
    expect(start).toHaveAttribute('aria-describedby', expect.stringMatching(/^standard-account-empty-/))
    expect(desktop.startImport).not.toHaveBeenCalled()
  })

  it('shows a blocking JCB total mismatch before staging', async () => {
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const csv = 'JCBカードご利用代金明細\nご利用日,ご利用先など,お支払い金額(円)\n2026/06/12,架空ストア,1200\n,お支払い合計,999'
    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [new File([csv], 'myjcb.csv', { type: 'text/csv' })] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('Detail sum (1200) does not match statement total (999).')
    expect(screen.getByText('確認が必要')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取込開始' })).not.toBeInTheDocument()
    expect(desktop.startImport).not.toHaveBeenCalled()
  })

  it('shows a blocking Vpass total mismatch before staging', async () => {
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const csv = 'VPASSガイド 様,****1234,三井住友カード NL\n2026/06/12,架空ストア,1200,1,1,1200,,,,,\n,,,,,999,,,,,'
    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [new File([csv], 'vpass.csv', { type: 'text/csv' })] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('Detail sum (1200) does not match statement total (999).')
    expect(screen.getByText('確認が必要')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取込開始' })).not.toBeInTheDocument()
    expect(desktop.startImport).not.toHaveBeenCalled()
  })

  it('defaults a signed JCB credit to REFUND even when the merchant has no refund keyword', async () => {
    let stagedCandidates: readonly Record<string, unknown>[] = []
    desktop.startImport.mockImplementation(async (request) => {
      stagedCandidates = request.candidates
      return { runId: 'run-jcb', documentId: 'document-jcb', status: 'REVIEW_REQUIRED', recordCount: request.records.length, candidateCount: request.candidates.length, reusedExisting: false }
    })
    desktop.previewImport.mockImplementation(async () => ({
      summary: { runId: 'run-jcb', documentId: 'document-jcb', status: 'REVIEW_REQUIRED', recordCount: 2, candidateCount: stagedCandidates.length, reusedExisting: false },
      source: { sourceType: 'MANUAL_UPLOAD', originalFilename: 'myjcb.csv', mediaType: 'text/csv', byteSize: 1, sha256: 'hash', audienceVisibility: 'SHARED', audienceMemberId: null },
      candidates: stagedCandidates.map((candidate) => ({ ...candidate, reviewStatus: 'READY', evidenceCount: 1, evidenceRoles: ['PRIMARY'], issues: [] })),
    }))
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const csv = 'JCBカードご利用代金明細\nご利用日,ご利用先など,お支払い金額(円),支払区分\n2026/06/10,架空ストア,1200,ショッピング\n2026/06/12,AMAZON.CO.JP,-200,ショッピング\n,お支払い合計,1000,'
    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [new File([csv], 'myjcb.csv', { type: 'text/csv' })] } })
    fireEvent.change(await screen.findByLabelText('myjcb.csvの取込先カード口座'), { target: { value: 'family-card' } })
    fireEvent.click(screen.getByRole('button', { name: '取込開始' }))

    const types = await screen.findAllByLabelText(/の取引種別/)
    expect(types.map((select) => (select as HTMLSelectElement).value)).toEqual(expect.arrayContaining(['CARD_PURCHASE', 'REFUND']))
    expect(stagedCandidates).toEqual(expect.arrayContaining([expect.objectContaining({ direction: 'IN', descriptionRaw: 'REFUND / ショッピング' })]))
  })

  it('keeps destination mappings independent for two bank previews in one batch', async () => {
    desktop.listAccounts.mockResolvedValue([
      { id: 'family-bank', name: '既定テスト口座', accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
      { id: 'bank-a', name: '生活口座', accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
      { id: 'bank-b', name: '貯蓄口座', accountKind: 'ASSET', accountSubtype: 'BANK', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
      { id: 'family-other-expense', name: 'その他', accountKind: 'EXPENSE', accountSubtype: 'OTHER', currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' },
    ])
    desktop.startImport.mockImplementation(async (request) => ({ runId: `run-${request.originalFilename}`, documentId: `document-${request.originalFilename}`, status: 'REVIEW_REQUIRED', recordCount: 1, candidateCount: 1, reusedExisting: false }))
    desktop.previewImport.mockImplementation(async (runId: string) => {
      const suffix = runId.endsWith('bank-a.csv') ? 'a' : 'b'
      return {
        summary: { runId, documentId: `document-bank-${suffix}.csv`, status: 'REVIEW_REQUIRED', recordCount: 1, candidateCount: 1, reusedExisting: false },
        source: { sourceType: 'MANUAL_UPLOAD', originalFilename: `bank-${suffix}.csv`, mediaType: 'text/csv', byteSize: 1, sha256: `hash-${suffix}`, audienceVisibility: 'SHARED', audienceMemberId: null },
        candidates: [{ id: `candidate-${suffix}`, accountId: `bank-${suffix}`, occurredOn: '2026-07-12', postedOn: null, amountJpy: 100, direction: 'OUT', descriptionRaw: `STORE ${suffix}`, merchantRaw: `STORE ${suffix}`, externalTransactionId: null, extractionConfidenceBps: 10000, normalizationConfidenceBps: 10000, attributionKind: 'HOUSEHOLD', attributedMemberId: null, audienceVisibility: 'SHARED', audienceMemberId: null, reviewStatus: 'READY', evidenceCount: 1, evidenceRoles: ['PRIMARY'], issues: [] }],
      }
    })
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const header = '日付,摘要,支払い金額,預かり金額,差引残高\n'
    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [
      new File([`${header}2026/07/11,STORE A,100,,10000`], 'bank-a.csv', { type: 'text/csv' }),
      new File([`${header}2026/07/12,STORE B,200,,20000`], 'bank-b.csv', { type: 'text/csv' }),
    ] } })

    fireEvent.change(await screen.findByLabelText('bank-a.csvの取込先銀行口座'), { target: { value: 'bank-a' } })
    fireEvent.change(screen.getByLabelText('bank-b.csvの取込先銀行口座'), { target: { value: 'bank-b' } })
    fireEvent.click(screen.getByRole('button', { name: 'bank-a.csvの取込開始' }))
    fireEvent.click(screen.getByRole('button', { name: 'bank-b.csvの取込開始' }))
    await waitFor(() => expect(desktop.startImport).toHaveBeenCalledTimes(2))
    const mappedAccounts = desktop.startImport.mock.calls.map(([request]) => request.candidates[0].accountId)
    expect(mappedAccounts).toEqual(expect.arrayContaining(['bank-a', 'bank-b']))
  })

  it('requires and applies an explicit bank account for a Yucho import', async () => {
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const csv = 'お客さま口座情報\n現在高：,150000,円\n取引日,入出金明細ID,受入金額（円）,払出金額（円）,詳細1,詳細2,現在（貸付）高\n20260701,1,50000,,給与,勤務先,150000'
    fireEvent.change(input, { target: { files: [new File([csv], 'yucho.csv', { type: 'text/csv' })] } })

    const start = await screen.findByRole('button', { name: '取込開始' })
    fireEvent.click(start)
    expect(await screen.findByText('ゆうちょCSVの取込先銀行口座を選択してください。')).toBeInTheDocument()
    expect(desktop.startImport).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('yucho.csvのゆうちょ取込先口座'), { target: { value: 'family-bank' } })
    fireEvent.click(start)
    await waitFor(() => expect(desktop.startImport).toHaveBeenCalledWith(expect.objectContaining({
      adapterId: 'yucho-direct-ledger-v1',
      candidates: [expect.objectContaining({ accountId: 'family-bank' })],
    }), expect.any(Uint8Array)))
  })

  it('imports a Money Forward asset-history file as one source and one atomic non-ledger batch', async () => {
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File(['日付,合計（円）,預金・現金・暗号資産（円）,株式(現物)（円）\n2026/06/30,"8,500,000","2,000,000","3,000,000"\n2026/07/31,"8,700,000","2,100,000","3,100,000"'], 'moneyforward-assets.csv', { type: 'text/csv' })
    fireEvent.change(input, { target: { files: [file] } })

    fireEvent.click(await screen.findByRole('button', { name: '総資産履歴に保存' }))
    await waitFor(() => expect(desktop.startImport).toHaveBeenCalledWith(expect.objectContaining({
      adapterId: 'money-forward-me-asset-trend-v1', records: expect.arrayContaining([expect.objectContaining({ rowNumber: 2 }), expect.objectContaining({ rowNumber: 3 })]), candidates: [], cardStatements: [],
    }), expect.any(Uint8Array)))
    await waitFor(() => expect(nativeInvoke).toHaveBeenCalledWith('aggregate_asset_history_import', { input: expect.objectContaining({ householdId: 'family', snapshots: [expect.objectContaining({ sourceDocumentId: 'document-1', sourceRow: 2, asOf: '2026-06-30' }), expect.objectContaining({ sourceDocumentId: 'document-1', sourceRow: 3, asOf: '2026-07-31' })] }) }))
    expect(desktop.commitImport).toHaveBeenCalledWith('run-1', [])
    expect(desktop.previewImport).not.toHaveBeenCalled()
    expect(await screen.findByText(/2時点の総資産履歴を保存しました。台帳と純資産には加算しません/)).toBeInTheDocument()
  })

  it('rolls back a newly staged Money Forward source when the atomic batch fails', async () => {
    const fallback = nativeInvoke.getMockImplementation()!
    nativeInvoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => command === 'aggregate_asset_history_import' ? Promise.reject(new Error('conflict')) : fallback(command, args))
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(input, { target: { files: [new File(['日付,合計（円）,預金・現金・暗号資産（円）\n2026/07/31,8700000,2100000'], 'moneyforward-assets.csv', { type: 'text/csv' })] } })
    fireEvent.click(await screen.findByRole('button', { name: '総資産履歴に保存' }))

    await waitFor(() => expect(desktop.rollbackImport).toHaveBeenCalledWith('run-1'))
    expect(desktop.commitImport).not.toHaveBeenCalled()
    expect(await screen.findByText(/総資産履歴を保存できませんでした/)).toBeInTheDocument()
  })

  it('reuses an already imported Money Forward source without committing transactions again', async () => {
    desktop.startImport.mockResolvedValue({ runId: 'existing-run', documentId: 'existing-document', status: 'POSTED', recordCount: 1, candidateCount: 0, reusedExisting: true })
    const fallback = nativeInvoke.getMockImplementation()!
    nativeInvoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command !== 'aggregate_asset_history_import') return fallback(command, args)
      const input = args?.input as { snapshots: Array<Record<string, unknown>> }
      return { createdCount: 0, reusedCount: input.snapshots.length, snapshots: input.snapshots }
    })
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(input, { target: { files: [new File(['日付,合計（円）,預金・現金・暗号資産（円）\n2026/07/31,8700000,2100000'], 'moneyforward-assets.csv', { type: 'text/csv' })] } })
    fireEvent.click(await screen.findByRole('button', { name: '総資産履歴に保存' }))

    expect(await screen.findByText('このMoney Forward総資産履歴はすでに取り込み済みです。')).toBeInTheDocument()
    expect(desktop.commitImport).not.toHaveBeenCalled()
    expect(desktop.rollbackImport).not.toHaveBeenCalled()
  })

  it('finalizes a reused nontransaction run left incomplete by an earlier commit failure', async () => {
    desktop.startImport.mockResolvedValue({ runId: 'retry-run', documentId: 'retry-document', status: 'REVIEW_REQUIRED', recordCount: 1, candidateCount: 0, reusedExisting: true })
    const fallback = nativeInvoke.getMockImplementation()!
    nativeInvoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command !== 'aggregate_asset_history_import') return fallback(command, args)
      const input = args?.input as { snapshots: Array<Record<string, unknown>> }
      return { createdCount: 0, reusedCount: 1, snapshots: input.snapshots }
    })
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(input, { target: { files: [new File(['日付,合計（円）,預金・現金・暗号資産（円）\n2026/07/31,8700000,2100000'], 'moneyforward-assets.csv', { type: 'text/csv' })] } })
    fireEvent.click(await screen.findByRole('button', { name: '総資産履歴に保存' }))

    await waitFor(() => expect(desktop.commitImport).toHaveBeenCalledWith('retry-run', []))
    expect(desktop.rollbackImport).not.toHaveBeenCalled()
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

  it('rescues an unsupported CSV inline when no parser profile exists', async () => {
    const fallback = nativeInvoke.getMockImplementation()!
    nativeInvoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'delimited_parser_profiles_list') return []
      if (command === 'delimited_parser_profile_create') {
        const input = args?.input as Record<string, unknown>
        return { ...input, version: 1, createdAt: '2026-07-13T00:00:00Z', updatedAt: '2026-07-13T00:00:00Z' }
      }
      return fallback(command, args)
    })
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const file = new File(['Date,Description,Amount\n2026/07/12,Local shop,-1200'], 'new-bank.csv', { type: 'text/csv' })
    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [file] } })

    fireEvent.click(await screen.findByRole('button', { name: 'このファイルを読み取る' }))
    expect(screen.getByRole('dialog', { name: 'このCSVを読み取る' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('日付列'), { target: { value: 'Date' } })
    fireEvent.change(screen.getByLabelText('支払先列'), { target: { value: 'Description' } })
    fireEvent.change(screen.getByLabelText('符号付き金額列'), { target: { value: 'Amount' } })
    fireEvent.change(screen.getByLabelText('救済取込先口座'), { target: { value: 'family-bank' } })
    expect(await screen.findByText('utf-8 ・ 区切り「,」・ 候補 1件 ・ 除外 0行 ・ エラー 0件')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'プロファイルを保存してプレビューへ' }))

    expect(await screen.findByText('1件の候補 / 0行を除外 / 0件のエラー')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取込開始' }))
    await waitFor(() => expect(desktop.startImport).toHaveBeenCalledWith(expect.objectContaining({
      adapterId: 'custom-delimited-v1', candidates: [expect.objectContaining({ accountId: 'family-bank', merchantRaw: 'Local shop', amountJpy: 1200, direction: 'OUT' })],
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

  it('requires an explicit receipt match confirmation and does not post a duplicate expense', async () => {
    desktop.previewImport
      .mockResolvedValueOnce({
        summary: { runId: 'run-1', documentId: 'document-1', status: 'REVIEW_REQUIRED', recordCount: 1, candidateCount: 1, reusedExisting: false },
        source: { sourceType: 'MANUAL_UPLOAD', originalFilename: 'receipt.png', mediaType: 'image/png', byteSize: 3, sha256: 'hash', audienceVisibility: 'SHARED', audienceMemberId: null },
        candidates: [{ id: 'candidate-1', accountId: 'family-bank', occurredOn: '2026-07-12', postedOn: null, amountJpy: 1200, direction: 'OUT', descriptionRaw: 'STORE', merchantRaw: 'STORE', externalTransactionId: null, extractionConfidenceBps: 9000, normalizationConfidenceBps: 9000, attributionKind: 'HOUSEHOLD', attributedMemberId: null, audienceVisibility: 'SHARED', audienceMemberId: null, reviewStatus: 'READY', evidenceCount: 1, evidenceRoles: ['PRIMARY'], issues: [] }],
      })
      .mockResolvedValueOnce({
        summary: { runId: 'run-1', documentId: 'document-1', status: 'POSTED', recordCount: 1, candidateCount: 1, reusedExisting: false },
        source: { sourceType: 'MANUAL_UPLOAD', originalFilename: 'receipt.png', mediaType: 'image/png', byteSize: 3, sha256: 'hash', audienceVisibility: 'SHARED', audienceMemberId: null },
        candidates: [],
      })
    const { container } = render(<App />)
    await screen.findByText('生協')
    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1, 2, 3])], 'receipt.png', { type: 'image/png' })] } })
    fireEvent.click(await screen.findByRole('button', { name: '画像OCR' }))

    const matchButton = await screen.findByRole('button', { name: '新規支出を作らず証憑として紐付け' })
    expect(desktop.confirmReceiptMatch).not.toHaveBeenCalled()
    expect(desktop.commitImport).not.toHaveBeenCalled()
    fireEvent.click(matchButton)

    await waitFor(() => expect(desktop.confirmReceiptMatch).toHaveBeenCalledWith('family', 'candidate-1', 'purchase'))
    expect(desktop.commitImport).not.toHaveBeenCalled()
    expect(await screen.findByText('既存取引にレシート証憑を紐付けました。新しい支出は作成していません。')).toBeInTheDocument()
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
