import { invoke as tauriInvoke } from '@tauri-apps/api/core'

import type {
  AppBootstrapDto,
  AppCommand,
  AppHealthDto,
  AppStatusDto,
  AccountDto,
  BackupSummaryDto,
  CommitSummaryDto,
  CardMatchConfirmationDto,
  CardReconciliationStatusDto,
  CardSettlementDto,
  CardSettlementBankMappingDto,
  CardSettlementBalanceCoverageDto,
  DashboardMonthlyTotalsDto,
  DashboardPreferencesDto,
  DashboardTemplateDto,
  DashboardTemplateLayoutsDto,
  DashboardWidgetIdDto,
  DatabaseStatusDto,
  ExtractedDocumentDto,
  HouseholdDto,
  HouseholdMemberDto,
  LocalSyncFoundationStatusDto,
  DesktopRelayStatusDto,
  DesktopRelayPreparedDeliveryDto,
  ImportPreviewDto,
  ImportRunCountsDto,
  ImportSummaryDto,
  PendingReviewListDto,
  PendingReviewRunDto,
  Invoke,
  MonthlyCategoryBudgetDto,
  PlatformClient,
  PreviewCandidateDto,
  TransactionPageDto,
  TransactionDetailDto,
  SourceDocumentViewDto,
  SourceRecordPageDto,
  SourceRecordViewDto,
  WatchedFolderDto,
  WatchedFileMetadataDto,
  WatchedFileInboxStateDto,
  WatchedFileInboxItemDto,
  WatchedFileInboxClaimDto,
  SavingsGoalDto,
  AppliedClassificationDto,
  AttributionKindDto,
  AudienceVisibilityDto,
  ClassificationPreviewDto,
  ClassificationRuleDto,
  ReceiptMatchSuggestionDto,
  ReceiptMatchConfirmationDto,
  BulkUpdateTransactionMetadataResultDto,
  ChangePackageReviewDto,
  EvidenceBundleSummaryDto,
  PendingImportApplySummaryDto,
  PendingImportExportSummaryDto,
  PendingImportStageDto,
} from './types'

export type PlatformIpcErrorCode = 'COMMAND_FAILED' | 'INVALID_RESPONSE'

/** A deliberately sanitized error safe to show or log in the webview. */
export class PlatformIpcError extends Error {
  readonly code: PlatformIpcErrorCode
  readonly command: AppCommand

  constructor(code: PlatformIpcErrorCode, command: AppCommand) {
    super(code === 'INVALID_RESPONSE' ? 'The desktop service returned an invalid response.' : 'The desktop service is unavailable.')
    this.name = 'PlatformIpcError'
    this.code = code
    this.command = command
  }
}

const WEB_DATABASE_STATUS: DatabaseStatusDto = Object.freeze({
  healthy: false,
  schemaVersion: 0,
})

const WEB_BOOTSTRAP: AppBootstrapDto = Object.freeze({
  application: 'KakeFlow',
  database: WEB_DATABASE_STATUS,
})

const WEB_HEALTH: AppHealthDto = Object.freeze({
  status: 'degraded',
  database: WEB_DATABASE_STATUS,
})

const WEB_STATUS: AppStatusDto = Object.freeze({
  schemaVersion: 0,
  integrity: 'failed',
})

const EMPTY_DASHBOARD_ANALYTICS = Object.freeze({
  netWorthAsOf: '1970-01-31', assetsJpy: 0, liabilitiesJpy: 0, netWorthJpy: 0,
  accrualTrend: Object.freeze([]), cashFlowTrend: Object.freeze([]), expenseCategories: Object.freeze([]),
})

function defaultDashboardTemplateLayouts(): DashboardTemplateLayoutsDto {
  return {
    FINANCIAL_OVERVIEW: { widgetOrder: ['TREND', 'SPENDING', 'RECENT', 'CARDS'], hiddenWidgets: [] },
    HOUSEHOLD_LEDGER: { widgetOrder: ['SPENDING', 'RECENT', 'TREND', 'CARDS'], hiddenWidgets: [] },
    ASSETS_LIABILITIES: { widgetOrder: ['TREND', 'SPENDING', 'CARDS', 'RECENT'], hiddenWidgets: [] },
    CARD_RECONCILIATION: { widgetOrder: ['CARDS', 'RECENT', 'TREND', 'SPENDING'], hiddenWidgets: [] },
    CASH_FLOW: { widgetOrder: ['TREND', 'RECENT', 'CARDS', 'SPENDING'], hiddenWidgets: [] },
  }
}

type TauriGlobal = typeof globalThis & {
  __TAURI_INTERNALS__?: unknown
}

export function isTauriRuntime(scope: typeof globalThis = globalThis): boolean {
  return typeof (scope as TauriGlobal).__TAURI_INTERNALS__ === 'object'
    && (scope as TauriGlobal).__TAURI_INTERNALS__ !== null
}

export interface PlatformClientOptions {
  readonly invoke?: Invoke
  readonly tauri?: boolean
}

export function createPlatformClient(options: PlatformClientOptions = {}): PlatformClient {
  const runtime = (options.tauri ?? isTauriRuntime()) ? 'tauri' : 'web'
  const invoke: Invoke = options.invoke ?? tauriInvoke

  if (runtime === 'web') {
    return {
      runtime,
      bootstrap: async () => WEB_BOOTSTRAP,
      health: async () => WEB_HEALTH,
      status: async () => WEB_STATUS,
      getLocalSyncFoundationStatus: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'local_sync_foundation_status') },
      updatePrincipalMemberBinding: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'principal_member_binding_update') },
      getDesktopRelayStatus: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'relay_status') },
      saveDesktopRelayConnection: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'relay_connection_save') },
      disconnectDesktopRelay: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'relay_disconnect') },
      prepareDesktopRelaySend: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'relay_send_prepare') },
      acceptDesktopRelaySend: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'relay_send_accept') },
      failDesktopRelaySend: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'relay_send_failed') },
      registerDesktopRelayInbound: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'relay_inbound_register') },
      stageDesktopRelayInbound: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'relay_inbound_stage') },
      exportChangePackage: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'change_package_export_save') },
      pickAndStageChangePackage: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'change_package_pick_and_stage') },
      getActiveChangePackageReview: async () => null,
      resolveChangePackage: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'change_package_resolve') },
      applyChangePackage: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'change_package_apply') },
      discardChangePackage: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'change_package_discard') },
      exportEvidenceBundle: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'evidence_bundle_export_save') },
      pickAndImportEvidenceBundle: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'evidence_bundle_pick_and_import') },
      exportPendingImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'pending_import_export_to_picker') },
      pickAndStagePendingImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'pending_import_pick_and_stage') },
      applyPendingImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'pending_import_apply') },
      discardPendingImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'pending_import_discard') },
      listHouseholds: async () => [],
      createHousehold: async (input) => ({ id: input.id, name: input.name, baseCurrency: 'JPY', createdAt: new Date(0).toISOString() }),
      listHouseholdMembers: async () => [],
      createHouseholdMember: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'household_member_create') },
      updateHouseholdMember: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'household_member_update') },
      archiveHouseholdMember: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'household_member_archive') },
      listAccounts: async () => [],
      createAccount: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'account_create') },
      renameAccount: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'account_rename') },
      archiveAccount: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'account_archive') },
      updateAccountOwnership: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'account_ownership_update') },
      queryTransactions: async (request) => ({ items: [], page: request.page, pageSize: request.pageSize, totalItems: 0, totalPages: 0 }),
      createManualTransaction: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'transaction_manual_create') },
      getTransactionDetail: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'transaction_detail_get') },
      updateTransaction: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'transaction_update') },
      bulkUpdateTransactionMetadata: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'transaction_metadata_bulk_update') },
      getSourceDocument: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'source_document_get') },
      updateSourceDocumentAudience: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'source_document_audience_update') },
      querySourceDocumentRecords: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'source_document_records_query') },
      listTransactionSourceRecords: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'transaction_source_records_list') },
      listWatchedFolders: async () => [],
      selectWatchedFolder: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_folder_select') },
      removeWatchedFolder: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_folder_remove') },
      scanWatchedFolder: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_folder_scan') },
      readWatchedFile: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_folder_file_read') },
      listWatchedFileInbox: async () => [],
      countWatchedFileInbox: async () => ({ discovered: 0, processing: 0, ready: 0, needsMapping: 0, staged: 0, failed: 0, ignored: 0, removed: 0, actionable: 0, total: 0 }),
      ignoreWatchedFileInboxItem: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_file_inbox_ignore') },
      retryWatchedFileInboxItem: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_file_inbox_retry') },
      claimWatchedFileInboxItems: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_file_inbox_claim') },
      markWatchedFileInboxReady: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_file_inbox_mark_ready') },
      markWatchedFileInboxNeedsMapping: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_file_inbox_mark_needs_mapping') },
      markWatchedFileInboxFailed: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_file_inbox_mark_failed') },
      markWatchedFileInboxStaged: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'watched_file_inbox_mark_staged') },
      queryDashboard: async (request) => ({ month: request.month, accountingBasis: request.accountingBasis, incomeJpy: 0, expenseJpy: 0, savingsJpy: 0, postedTransactionCount: 0, ...EMPTY_DASHBOARD_ANALYTICS }),
      getDashboardPreferences: async (householdId) => ({ householdId, template: 'FINANCIAL_OVERVIEW', theme: 'SYSTEM', density: 'COMFORTABLE', templateLayouts: defaultDashboardTemplateLayouts(), updatedAt: new Date(0).toISOString() }),
      upsertDashboardPreferences: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'dashboard_preferences_upsert') },
      listBudgets: async () => [],
      upsertBudget: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'budget_upsert') },
      listSavingsGoals: async () => [],
      createSavingsGoal: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'savings_goal_create') },
      updateSavingsGoal: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'savings_goal_update') },
      deleteSavingsGoal: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'savings_goal_delete') },
      listClassificationRules: async () => [],
      createClassificationRule: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'classification_rule_create') },
      updateClassificationRule: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'classification_rule_update') },
      deleteClassificationRule: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'classification_rule_delete') },
      previewClassificationRules: async () => ({ winningRuleId: null, matches: [] }),
      applyClassificationRule: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'classification_rule_apply') },
      importSummary: async () => ({ totalRuns: 0, discovered: 0, extracting: 0, reviewRequired: 0, posted: 0, failed: 0, rolledBack: 0, sourceDocuments: 0, sourceRecords: 0, pendingCandidates: 0, readyCandidates: 0, latestSuccessfulImportAt: null, latestSourceFilename: null, latestSourceType: null, distinctSourceTypes: 0 }),
      listPendingReviews: async (householdId) => ({ householdId, runs: [] }),
      startImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'import_start') },
      previewImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'import_preview') },
      commitImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'import_commit') },
      rollbackImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'import_rollback') },
      createBackup: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'backup_create') },
      stageBackupRestore: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'backup_restore_stage') },
      restartForRestore: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'app_restart_for_restore') },
      extractDocument: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'document_extract') },
      ocrDocument: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'document_ocr') },
      listCardSettlements: async () => [],
      confirmCardMatch: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'card_match_confirm') },
      confirmCardPaymentLink: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'card_payment_link_confirm') },
      updateCardStatementDueDate: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'card_statement_due_date_update') },
      listCardSettlementBankMappings: async () => [],
      upsertCardSettlementBankMapping: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'card_settlement_bank_mapping_upsert') },
      deleteCardSettlementBankMapping: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'card_settlement_bank_mapping_delete') },
      queryCardSettlementBalanceCoverage: async () => ({ asOf: '1970-01-01', historyFrom: '1970-01-01', horizonThrough: '1970-02-15', horizonDays: 45, banks: [], unmappedStatements: [], missingDueStatements: [] }),
      suggestReceiptMatches: async () => [],
      confirmReceiptMatch: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'receipt_match_confirm') },
    }
  }

  return {
    runtime,
    bootstrap: () => invokeValidated(invoke, 'app_bootstrap', parseBootstrap),
    health: () => invokeValidated(invoke, 'app_health', parseHealth),
    status: () => invokeValidated(invoke, 'app_status', parseStatus),
    getLocalSyncFoundationStatus: (householdId) => invokeValidated(invoke, 'local_sync_foundation_status', parseLocalSyncFoundationStatus, { householdId }),
    updatePrincipalMemberBinding: (input) => invokeValidated(invoke, 'principal_member_binding_update', parseLocalSyncFoundationStatus, { input }),
    getDesktopRelayStatus: (householdId) => invokeValidated(invoke, 'relay_status', parseDesktopRelayStatus, { householdId }),
    saveDesktopRelayConnection: (input) => invokeValidated(invoke, 'relay_connection_save', parseDesktopRelayStatus, { input }),
    disconnectDesktopRelay: (householdId) => invokeValidated(invoke, 'relay_disconnect', parseDesktopRelayStatus, { householdId }),
    prepareDesktopRelaySend: (householdId) => invokeValidated(invoke, 'relay_send_prepare', parseDesktopRelayPreparedDelivery, { householdId }),
    acceptDesktopRelaySend: (input) => invokeValidated(invoke, 'relay_send_accept', parseDesktopRelayStatus, { input }),
    failDesktopRelaySend: (householdId, deliveryId) => invokeValidated(invoke, 'relay_send_failed', parseDesktopRelayStatus, { householdId, deliveryId }),
    registerDesktopRelayInbound: (input) => invokeValidated(invoke, 'relay_inbound_register', parseDesktopRelayStatus, { input }),
    stageDesktopRelayInbound: (input) => invokeValidated(invoke, 'relay_inbound_stage', parseDesktopRelayStatus, { input }),
    exportChangePackage: (householdId) => invokeValidated(invoke, 'change_package_export_save', parseNullableString, { householdId }),
    pickAndStageChangePackage: (householdId) => invokeValidated(invoke, 'change_package_pick_and_stage', parseNullableChangePackageReview, { householdId }),
    getActiveChangePackageReview: (householdId) => invokeValidated(invoke, 'change_package_active_review', parseNullableChangePackageReview, { householdId }),
    resolveChangePackage: (packageId, resolutions) => invokeValidated(invoke, 'change_package_resolve', parseChangePackageReview, { packageId, resolutions }),
    applyChangePackage: (packageId) => invokeValidated(invoke, 'change_package_apply', parseChangePackageReview, { packageId }),
    discardChangePackage: async (packageId) => { await invokeValidated(invoke, 'change_package_discard', parseVoid, { packageId }) },
    exportEvidenceBundle: (householdId, passphrase) => invokeValidated(invoke, 'evidence_bundle_export_save', parseNullableEvidenceBundleSummary, { householdId, passphrase }),
    pickAndImportEvidenceBundle: (householdId, passphrase) => invokeValidated(invoke, 'evidence_bundle_pick_and_import', parseNullableEvidenceBundleSummary, { householdId, passphrase }),
    exportPendingImport: (request, passphrase) => invokeValidated(invoke, 'pending_import_export_to_picker', (value) => parseNullablePendingImportExportSummary(value, request.householdId), { request, passphrase }),
    pickAndStagePendingImport: (householdId, passphrase) => invokeValidated(invoke, 'pending_import_pick_and_stage', parseNullablePendingImportStage, { householdId, passphrase }),
    applyPendingImport: (householdId, packageId, mappings) => invokeValidated(invoke, 'pending_import_apply', (value) => parsePendingImportApplySummary(value, packageId), { householdId, packageId, mappings }),
    discardPendingImport: (packageId) => invokeValidated(invoke, 'pending_import_discard', parseBoolean, { packageId }),
    listHouseholds: () => invokeValidated(invoke, 'households_list', parseHouseholds),
    createHousehold: (input) => invokeValidated(invoke, 'household_create', parseHousehold, { input }),
    listHouseholdMembers: (householdId) => invokeValidated(invoke, 'household_members_list', parseHouseholdMembers, { householdId }),
    createHouseholdMember: (input) => invokeValidated(invoke, 'household_member_create', parseHouseholdMember, { input }),
    updateHouseholdMember: (input) => invokeValidated(invoke, 'household_member_update', parseHouseholdMember, { input }),
    archiveHouseholdMember: async (householdId, memberId) => { await invokeValidated(invoke, 'household_member_archive', parseVoid, { householdId, memberId }) },
    listAccounts: (householdId) => invokeValidated(invoke, 'accounts_list', parseAccounts, { householdId }),
    createAccount: (input) => invokeValidated(invoke, 'account_create', parseAccount, { input }),
    renameAccount: (input) => invokeValidated(invoke, 'account_rename', parseAccount, { input }),
    archiveAccount: async (input) => { await invokeValidated(invoke, 'account_archive', parseVoid, { input }) },
    updateAccountOwnership: (input) => invokeValidated(invoke, 'account_ownership_update', parseAccount, { input }),
    queryTransactions: (request) => invokeValidated(invoke, 'transactions_query', parseTransactionPage, { request }),
    createManualTransaction: (input) => invokeValidated(invoke, 'transaction_manual_create', parseTransactionRow, { input }),
    getTransactionDetail: (householdId, transactionId) => invokeValidated(invoke, 'transaction_detail_get', parseTransactionDetail, { householdId, transactionId }),
    updateTransaction: (input) => invokeValidated(invoke, 'transaction_update', parseTransactionDetail, { input }),
    bulkUpdateTransactionMetadata: (input) => invokeValidated(invoke, 'transaction_metadata_bulk_update', parseBulkUpdateTransactionMetadataResult, { input }),
    getSourceDocument: (householdId, sourceDocumentId) => invokeValidated(invoke, 'source_document_get', parseSourceDocument, { householdId, sourceDocumentId }),
    updateSourceDocumentAudience: (input) => invokeValidated(invoke, 'source_document_audience_update', parseSourceDocument, { input }),
    querySourceDocumentRecords: (request) => invokeValidated(invoke, 'source_document_records_query', parseSourceRecordPage, { request }),
    listTransactionSourceRecords: (householdId, transactionId) => invokeValidated(invoke, 'transaction_source_records_list', parseSourceRecords, { householdId, transactionId }),
    listWatchedFolders: (householdId) => invokeValidated(invoke, 'watched_folders_list', parseWatchedFolders, { householdId }),
    selectWatchedFolder: (householdId, label) => invokeValidated(invoke, 'watched_folder_select', parseNullableWatchedFolder, { householdId, label }),
    removeWatchedFolder: async (householdId, watchedFolderId) => { await invokeValidated(invoke, 'watched_folder_remove', parseVoid, { householdId, watchedFolderId }) },
    scanWatchedFolder: (householdId, watchedFolderId) => invokeValidated(invoke, 'watched_folder_scan', parseWatchedFolderScan, { householdId, watchedFolderId }),
    readWatchedFile: (householdId, watchedFolderId, relativePath) => invokeValidated(invoke, 'watched_folder_file_read', parseWatchedFile, { householdId, watchedFolderId, relativePath }),
    listWatchedFileInbox: (householdId, state, limit) => invokeValidated(invoke, 'watched_file_inbox_list', parseWatchedFileInboxItems, { householdId, state: state ?? null, limit: limit ?? null }),
    countWatchedFileInbox: (householdId) => invokeValidated(invoke, 'watched_file_inbox_counts', parseWatchedFileInboxCounts, { householdId }),
    ignoreWatchedFileInboxItem: (householdId, itemId) => invokeValidated(invoke, 'watched_file_inbox_ignore', parseWatchedFileInboxItem, { householdId, itemId }),
    retryWatchedFileInboxItem: (householdId, itemId) => invokeValidated(invoke, 'watched_file_inbox_retry', parseWatchedFileInboxItem, { householdId, itemId }),
    claimWatchedFileInboxItems: (householdId, itemIds) => invokeValidated(invoke, 'watched_file_inbox_claim', parseWatchedFileInboxClaim, { householdId, itemIds }),
    markWatchedFileInboxReady: (householdId, itemId, leaseToken) => invokeValidated(invoke, 'watched_file_inbox_mark_ready', parseWatchedFileInboxItem, { householdId, itemId, leaseToken }),
    markWatchedFileInboxNeedsMapping: (householdId, itemId, leaseToken) => invokeValidated(invoke, 'watched_file_inbox_mark_needs_mapping', parseWatchedFileInboxItem, { householdId, itemId, leaseToken }),
    markWatchedFileInboxFailed: (householdId, itemId, leaseToken, errorCode) => invokeValidated(invoke, 'watched_file_inbox_mark_failed', parseWatchedFileInboxItem, { householdId, itemId, leaseToken, errorCode }),
    markWatchedFileInboxStaged: (householdId, itemId, leaseToken, importRunId) => invokeValidated(invoke, 'watched_file_inbox_mark_staged', parseWatchedFileInboxItem, { householdId, itemId, leaseToken, importRunId }),
    queryDashboard: (request) => invokeValidated(invoke, 'dashboard_query', parseDashboard, { request }),
    getDashboardPreferences: (householdId) => invokeValidated(invoke, 'dashboard_preferences_get', parseDashboardPreferences, { householdId }),
    upsertDashboardPreferences: (input) => invokeValidated(invoke, 'dashboard_preferences_upsert', parseDashboardPreferences, { input }),
    listBudgets: (householdId, month) => invokeValidated(invoke, 'budgets_query', parseBudgets, { householdId, month }),
    upsertBudget: (input) => invokeValidated(invoke, 'budget_upsert', parseBudget, { input }),
    listSavingsGoals: (householdId) => invokeValidated(invoke, 'savings_goals_list', parseSavingsGoals, { householdId }),
    createSavingsGoal: (input) => invokeValidated(invoke, 'savings_goal_create', parseSavingsGoal, { input }),
    updateSavingsGoal: (input) => invokeValidated(invoke, 'savings_goal_update', parseSavingsGoal, { input }),
    deleteSavingsGoal: async (householdId, goalId) => { await invokeValidated(invoke, 'savings_goal_delete', parseVoid, { householdId, goalId }) },
    listClassificationRules: (householdId) => invokeValidated(invoke, 'classification_rules_list', parseClassificationRules, { householdId }),
    createClassificationRule: (input) => invokeValidated(invoke, 'classification_rule_create', parseClassificationRule, { input }),
    updateClassificationRule: (input) => invokeValidated(invoke, 'classification_rule_update', parseClassificationRule, { input }),
    deleteClassificationRule: async (householdId, ruleId) => { await invokeValidated(invoke, 'classification_rule_delete', parseVoid, { householdId, ruleId }) },
    previewClassificationRules: (input) => invokeValidated(invoke, 'classification_rules_preview', parseClassificationPreview, { input }),
    applyClassificationRule: (input) => invokeValidated(invoke, 'classification_rule_apply', parseAppliedClassification, { input }),
    importSummary: (householdId) => invokeValidated(invoke, 'import_summary', parseImportSummary, { householdId }),
    listPendingReviews: (householdId) => invokeValidated(invoke, 'pending_review_list', (value) => parsePendingReviewList(value, householdId), { householdId }),
    startImport: (request, fileBytes) => invokeValidated(invoke, 'import_start', parseImportSummaryDto, { request: { import: request, fileBytes: Array.from(fileBytes) } }),
    previewImport: (runId) => invokeValidated(invoke, 'import_preview', parseImportPreview, { runId }),
    commitImport: (runId, decisions) => invokeValidated(invoke, 'import_commit', parseCommitSummary, { runId, decisions }),
    rollbackImport: async (runId) => { await invokeValidated(invoke, 'import_rollback', parseVoid, { runId }) },
    createBackup: (passphrase) => invokeValidated(invoke, 'backup_create', parseNullableBackupSummary, { passphrase }),
    stageBackupRestore: (passphrase) => invokeValidated(invoke, 'backup_restore_stage', parseNullableBackupSummary, { passphrase }),
    restartForRestore: async () => { await invokeValidated(invoke, 'app_restart_for_restore', parseVoid) },
    extractDocument: (fileBytes, mediaType) => invokeValidated(invoke, 'document_extract', parseExtractedDocument, { fileBytes: Array.from(fileBytes), mediaType }),
    ocrDocument: (fileBytes, mediaType) => invokeValidated(invoke, 'document_ocr', parseExtractedDocument, { fileBytes: Array.from(fileBytes), mediaType }),
    listCardSettlements: (householdId) => invokeValidated(invoke, 'cards_list', parseCardSettlements, { householdId }),
    confirmCardMatch: (householdId, statementId, paymentId) => invokeValidated(invoke, 'card_match_confirm', parseCardMatchConfirmation, { householdId, statementId, paymentId }),
    confirmCardPaymentLink: (householdId, statementId, paymentId) => invokeValidated(invoke, 'card_payment_link_confirm', parseCardSettlement, { householdId, statementId, paymentId }),
    updateCardStatementDueDate: (input) => invokeValidated(invoke, 'card_statement_due_date_update', parseCardSettlement, { input }),
    listCardSettlementBankMappings: (householdId) => invokeValidated(invoke, 'card_settlement_bank_mappings_list', parseCardSettlementBankMappings, { householdId }),
    upsertCardSettlementBankMapping: (input) => invokeValidated(invoke, 'card_settlement_bank_mapping_upsert', parseCardSettlementBankMapping, { input }),
    deleteCardSettlementBankMapping: async (input) => { await invokeValidated(invoke, 'card_settlement_bank_mapping_delete', parseVoid, { input }) },
    queryCardSettlementBalanceCoverage: (request) => invokeValidated(invoke, 'card_settlement_balance_coverage_query', parseCardSettlementBalanceCoverage, { request }),
    suggestReceiptMatches: (householdId, candidateId) => invokeValidated(invoke, 'receipt_match_suggestions', parseReceiptMatchSuggestions, { request: { householdId, candidateId } }),
    confirmReceiptMatch: (householdId, candidateId, transactionId) => invokeValidated(invoke, 'receipt_match_confirm', parseReceiptMatchConfirmation, { request: { householdId, candidateId, transactionId } }),
  }
}

async function invokeValidated<T>(
  invoke: Invoke,
  command: AppCommand,
  parse: (value: unknown) => T,
  args?: Record<string, unknown>,
): Promise<T> {
  let response: unknown

  try {
    response = await invoke<unknown>(command, args)
  } catch {
    // Rust, SQL, filesystem paths, and source data must never cross this boundary.
    throw new PlatformIpcError('COMMAND_FAILED', command)
  }

  try {
    return parse(response)
  } catch {
    throw new PlatformIpcError('INVALID_RESPONSE', command)
  }
}

function parseHouseholds(value: unknown): readonly HouseholdDto[] {
  if (!Array.isArray(value)) throw new TypeError('households')
  return value.map(parseHousehold)
}

function parseHousehold(value: unknown): HouseholdDto {
  const record = asRecord(value)
  if (typeof record.id !== 'string' || typeof record.name !== 'string' || record.baseCurrency !== 'JPY' || typeof record.createdAt !== 'string') {
    throw new TypeError('household')
  }
  return { id: record.id, name: record.name, baseCurrency: record.baseCurrency, createdAt: record.createdAt }
}

function parseHouseholdMembers(value: unknown): readonly HouseholdMemberDto[] {
  if (!Array.isArray(value)) throw new TypeError('household members')
  return value.map(parseHouseholdMember)
}

function parseHouseholdMember(value: unknown): HouseholdMemberDto {
  const record = asRecord(value)
  if ((record.status !== 'ACTIVE' && record.status !== 'ARCHIVED') || (record.relationshipLabel !== null && typeof record.relationshipLabel !== 'string')) throw new TypeError('household member')
  return {
    id: asRequiredString(record.id), householdId: asRequiredString(record.householdId), displayName: asRequiredString(record.displayName),
    relationshipLabel: record.relationshipLabel, status: record.status, sortOrder: asSafeInteger(record.sortOrder),
    createdAt: asRequiredString(record.createdAt), updatedAt: asRequiredString(record.updatedAt),
  }
}

function parseLocalSyncFoundationStatus(value: unknown): LocalSyncFoundationStatusDto {
  const record = asRecord(value)
  const device = asRecord(record.device); const principal = asRecord(record.principal)
  const binding = asRecord(record.binding); const outbox = asRecord(record.outbox)
  if (!['MACOS', 'WINDOWS', 'OTHER'].includes(String(record.platform))
      || record.remoteTransport !== 'NOT_CONFIGURED' || record.restoreValidation !== 'ENABLED') throw new TypeError('local sync status')
  const parseIdentity = (identity: Record<string, unknown>) => ({
    id: asRequiredString(identity.id), displayName: asRequiredString(identity.displayName), createdAt: asRequiredString(identity.createdAt),
  })
  const memberId = asNullableString(binding.memberId); const memberName = asNullableString(binding.memberName)
  if ((memberId === null) !== (memberName === null)) throw new TypeError('principal binding')
  const latestRecordedAt = asNullableString(outbox.latestRecordedAt)
  return {
    device: parseIdentity(device), platform: record.platform as LocalSyncFoundationStatusDto['platform'],
    principal: parseIdentity(principal),
    binding: {
      householdId: asRequiredString(binding.householdId), principalId: asRequiredString(binding.principalId),
      memberId, memberName, updatedAt: asRequiredString(binding.updatedAt),
    },
    outbox: { envelopeCount: asSafeInteger(outbox.envelopeCount), latestSequence: asSafeInteger(outbox.latestSequence), latestRecordedAt },
    remoteTransport: 'NOT_CONFIGURED', restoreValidation: 'ENABLED',
  }
}

const DESKTOP_RELAY_CONNECTION_STATES = new Set(['NOT_CONFIGURED', 'CONNECTED', 'DEGRADED'])
const DESKTOP_RELAY_DELIVERY_STATES = new Set(['IDLE', 'SENDING', 'ACCEPTED', 'FAILED_RETRYABLE'])
const DESKTOP_RELAY_INBOUND_STATES = new Set(['AVAILABLE', 'WAITING_FOR_REVIEW', 'DUPLICATE', 'REJECTED_INVALID', 'FAILED_RETRYABLE'])

function parseDesktopRelayStatus(value: unknown): DesktopRelayStatusDto {
  const record = asRecord(value); const outbound = asRecord(record.outbound)
  if (!DESKTOP_RELAY_CONNECTION_STATES.has(String(record.connectionState))
      || !DESKTOP_RELAY_DELIVERY_STATES.has(String(outbound.deliveryState))
      || !Array.isArray(record.inbound)) throw new TypeError('desktop relay status')
  const endpoint = asNullableStrictString(record.endpoint)
  const remotePrincipalId = asNullableStrictString(record.remotePrincipalId)
  if (record.connectionState === 'NOT_CONFIGURED' ? endpoint !== null || remotePrincipalId !== null : endpoint === null || remotePrincipalId === null) throw new TypeError('desktop relay connection')
  const pendingEnvelopeCount = asSafeInteger(outbound.pendingEnvelopeCount)
  const totalEnvelopeCount = asSafeInteger(outbound.totalEnvelopeCount)
  if (pendingEnvelopeCount > totalEnvelopeCount) throw new TypeError('desktop relay outbox')
  const seen = new Set<string>()
  const inbound = record.inbound.map((value) => {
    const artifact = asRecord(value); const artifactId = asRequiredString(artifact.artifactId)
    if (seen.has(artifactId) || !DESKTOP_RELAY_INBOUND_STATES.has(String(artifact.state))) throw new TypeError('desktop relay inbound')
    seen.add(artifactId)
    return {
      artifactId, digest: asCanonicalHash(artifact.digest), createdAt: asIsoTimestamp(artifact.createdAt),
      originDeviceId: asRequiredString(artifact.originDeviceId), state: artifact.state as DesktopRelayStatusDto['inbound'][number]['state'],
    }
  })
  return {
    householdId: asRequiredString(record.householdId), connectionState: record.connectionState as DesktopRelayStatusDto['connectionState'],
    localDeviceId: asRequiredString(record.localDeviceId),
    remotePrincipalId, endpoint,
    outbound: {
      pendingEnvelopeCount, totalEnvelopeCount,
      deliveryState: outbound.deliveryState as DesktopRelayStatusDto['outbound']['deliveryState'],
      latestAcceptedAt: outbound.latestAcceptedAt === null ? null : asIsoTimestamp(outbound.latestAcceptedAt),
    },
    inbound,
  }
}

function parseDesktopRelayPreparedDelivery(value: unknown): DesktopRelayPreparedDeliveryDto {
  const record = asRecord(value)
  if (!Array.isArray(record.packageBytes) || record.packageBytes.length === 0 || record.packageBytes.length > 64 * 1024 * 1024
      || record.packageBytes.some((byte) => typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new TypeError('desktop relay package bytes')
  return {
    deliveryId: asRequiredString(record.deliveryId), artifactId: asRequiredString(record.artifactId),
    digest: asCanonicalHash(record.digest), householdId: asRequiredString(record.householdId),
    originDeviceId: asRequiredString(record.originDeviceId), packageBytes: record.packageBytes,
  }
}

function parseNullableString(value: unknown): string | null {
  if (value === null || typeof value === 'string') return value
  throw new TypeError('nullable string')
}

function parseEvidenceBundleSummary(value: unknown): EvidenceBundleSummaryDto {
  const record = asRecord(value)
  return {
    bundleId: asRequiredString(record.bundleId),
    householdId: asRequiredString(record.householdId),
    originInstallationId: asRequiredString(record.originInstallationId),
    documentCount: asSafeInteger(record.documentCount),
    recordCount: asSafeInteger(record.recordCount),
    plaintextBytes: asSafeInteger(record.plaintextBytes),
    importedDocumentCount: asSafeInteger(record.importedDocumentCount),
    deduplicatedDocumentCount: asSafeInteger(record.deduplicatedDocumentCount),
  }
}

function parseNullableEvidenceBundleSummary(value: unknown): EvidenceBundleSummaryDto | null {
  return value === null ? null : parseEvidenceBundleSummary(value)
}

const MAX_PENDING_IMPORT_RECORDS = 100_000
const MAX_PENDING_IMPORT_CANDIDATES = 100_000
const MAX_PENDING_IMPORT_STATEMENTS = 16
const MAX_PENDING_IMPORT_DEPENDENCIES = 100_000
const MAX_PENDING_IMPORT_PACKAGE_BYTES = 512 * 1024 * 1024

function parsePendingImportCounts(record: Record<string, unknown>): { recordCount: number; candidateCount: number; statementCount: number } {
  const recordCount = asBoundedInteger(record.recordCount, MAX_PENDING_IMPORT_RECORDS)
  const candidateCount = asBoundedInteger(record.candidateCount, MAX_PENDING_IMPORT_CANDIDATES)
  const statementCount = asBoundedInteger(record.statementCount, MAX_PENDING_IMPORT_STATEMENTS)
  if (recordCount === 0 || candidateCount === 0) throw new TypeError('pending import counts')
  return { recordCount, candidateCount, statementCount }
}

function parseNullablePendingImportExportSummary(value: unknown, expectedHouseholdId: string): PendingImportExportSummaryDto | null {
  if (value === null) return null
  const record = asRecord(value)
  if (record.schemaVersion !== 1 || record.householdId !== expectedHouseholdId) throw new TypeError('pending import export')
  const byteSize = asBoundedInteger(record.byteSize, MAX_PENDING_IMPORT_PACKAGE_BYTES)
  if (byteSize === 0) throw new TypeError('pending import export size')
  return {
    packageId: asRequiredString(record.packageId), schemaVersion: 1, householdId: expectedHouseholdId,
    portableRunId: asRequiredString(record.portableRunId), manifestSha256: asCanonicalHash(record.manifestSha256),
    sourceSha256: asCanonicalHash(record.sourceSha256), ...parsePendingImportCounts(record), byteSize,
  }
}

function parseNullablePendingImportStage(value: unknown): PendingImportStageDto | null {
  if (value === null) return null
  const record = asRecord(value)
  if (record.schemaVersion !== 1 || typeof record.alreadyApplied !== 'boolean'
      || !Array.isArray(record.accountDependencies) || record.accountDependencies.length > MAX_PENDING_IMPORT_DEPENDENCIES
      || !Array.isArray(record.memberDependencies) || record.memberDependencies.length > MAX_PENDING_IMPORT_DEPENDENCIES
      || !Object.hasOwn(record, 'existingLocalRunId')) throw new TypeError('pending import stage')
  const accountKinds = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const
  const accountSubtypes = ['BANK', 'CASH', 'WALLET', 'SECURITIES', 'CREDIT_CARD', 'RECEIVABLE', 'OTHER'] as const
  const accountDependencies = record.accountDependencies.map((value) => {
    const dependency = asRecord(value)
    if (!accountKinds.includes(dependency.accountKind as typeof accountKinds[number])
        || (dependency.accountSubtype !== null && !accountSubtypes.includes(dependency.accountSubtype as typeof accountSubtypes[number]))
        || !Object.hasOwn(dependency, 'institutionName') || !Object.hasOwn(dependency, 'maskedIdentifier')) throw new TypeError('pending import account dependency')
    return {
      portableAccountId: asRequiredString(dependency.portableAccountId), name: asRequiredString(dependency.name),
      accountKind: dependency.accountKind as PendingImportStageDto['accountDependencies'][number]['accountKind'],
      accountSubtype: dependency.accountSubtype as PendingImportStageDto['accountDependencies'][number]['accountSubtype'],
      currency: asRequiredString(dependency.currency), institutionName: asNullableStrictString(dependency.institutionName),
      maskedIdentifier: asNullableStrictString(dependency.maskedIdentifier),
    }
  })
  const memberDependencies = record.memberDependencies.map((value) => {
    const dependency = asRecord(value)
    return { portableMemberId: asRequiredString(dependency.portableMemberId), displayName: asRequiredString(dependency.displayName), role: asRequiredString(dependency.role) }
  })
  if (new Set(accountDependencies.map((item) => item.portableAccountId)).size !== accountDependencies.length
      || new Set(memberDependencies.map((item) => item.portableMemberId)).size !== memberDependencies.length) throw new TypeError('pending import duplicate dependency')
  const existingLocalRunId = asNullableStrictString(record.existingLocalRunId)
  if (record.alreadyApplied !== (existingLocalRunId !== null)) throw new TypeError('pending import applied state')
  return {
    packageId: asRequiredString(record.packageId), schemaVersion: 1,
    originInstallationId: asRequiredString(record.originInstallationId), portableRunId: asRequiredString(record.portableRunId),
    manifestSha256: asCanonicalHash(record.manifestSha256), sourceFilename: asRequiredString(record.sourceFilename),
    sourceSha256: asCanonicalHash(record.sourceSha256), ...parsePendingImportCounts(record),
    accountDependencies, memberDependencies, alreadyApplied: record.alreadyApplied, existingLocalRunId,
  }
}

function parsePendingImportApplySummary(value: unknown, expectedPackageId: string): PendingImportApplySummaryDto {
  const record = asRecord(value)
  if (record.packageId !== expectedPackageId || typeof record.reusedExisting !== 'boolean') throw new TypeError('pending import apply')
  return {
    packageId: expectedPackageId, localRunId: asRequiredString(record.localRunId),
    localDocumentId: asRequiredString(record.localDocumentId), ...parsePendingImportCounts(record),
    reusedExisting: record.reusedExisting,
  }
}

function parseBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError('boolean')
  return value
}

function parseNullableChangePackageReview(value: unknown): ChangePackageReviewDto | null {
  return value === null ? null : parseChangePackageReview(value)
}

function parseChangePackageReview(value: unknown): ChangePackageReviewDto {
  const record = asRecord(value)
  const states = ['STAGED', 'REVIEW_REQUIRED', 'READY', 'APPLIED', 'REJECTED'] as const
  if (!states.includes(record.state as typeof states[number]) || !Array.isArray(record.records)) throw new TypeError('change package review')
  return {
    packageId: asRequiredString(record.packageId), targetHouseholdId: asRequiredString(record.targetHouseholdId),
    sourceInstallationId: asRequiredString(record.sourceInstallationId), sourceRevision: asSafeInteger(record.sourceRevision),
    sourceCreatedAt: asRequiredString(record.sourceCreatedAt), state: record.state as ChangePackageReviewDto['state'],
    recordCount: asSafeInteger(record.recordCount), createCount: asSafeInteger(record.createCount),
    updateCount: asSafeInteger(record.updateCount), unchangedCount: asSafeInteger(record.unchangedCount),
    deleteCount: asSafeInteger(record.deleteCount), conflictCount: asSafeInteger(record.conflictCount),
    records: record.records.map((item) => {
      const entry = asRecord(item)
      const operations = ['UPSERT', 'DELETE'] as const
      const reviewStates = ['CREATE', 'UPDATE', 'UNCHANGED', 'DELETE', 'CONFLICT'] as const
      const resolutions = ['PENDING', 'APPLY_INCOMING', 'KEEP_LOCAL', 'SKIP'] as const
      if (!operations.includes(entry.operation as typeof operations[number])
          || !reviewStates.includes(entry.reviewState as typeof reviewStates[number])
          || !resolutions.includes(entry.resolution as typeof resolutions[number])) throw new TypeError('change package record')
      return {
        recordOrder: asSafeInteger(entry.recordOrder), entityKind: asRequiredString(entry.entityKind),
        entityId: asRequiredString(entry.entityId), operation: entry.operation as 'UPSERT' | 'DELETE',
        payloadSha256: asRequiredString(entry.payloadSha256),
        reviewState: entry.reviewState as ChangePackageReviewDto['records'][number]['reviewState'],
        resolution: entry.resolution as ChangePackageReviewDto['records'][number]['resolution'],
        currentPayloadSha256: asNullableString(entry.currentPayloadSha256),
        conflictReason: asNullableString(entry.conflictReason),
      }
    }),
  }
}

function parseAccounts(value: unknown): readonly AccountDto[] {
  if (!Array.isArray(value)) throw new TypeError('accounts')
  return value.map(parseAccount)
}

function parseAccount(value: unknown): AccountDto {
  const record = asRecord(value)
  const accountKinds = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const
  const accountSubtypes = ['BANK', 'CASH', 'WALLET', 'SECURITIES', 'CREDIT_CARD', 'RECEIVABLE', 'OTHER'] as const
  if (!accountKinds.includes(record.accountKind as typeof accountKinds[number]) || !accountSubtypes.includes(record.accountSubtype as typeof accountSubtypes[number]) || record.currency !== 'JPY') throw new TypeError('account')
  if ((record.ownershipKind !== 'HOUSEHOLD' && record.ownershipKind !== 'MEMBER') || (record.visibility !== 'SHARED' && record.visibility !== 'PERSONAL')) throw new TypeError('account ownership')
  if (!Object.hasOwn(record, 'ownerMemberId') || !Object.hasOwn(record, 'ownerMemberName')) throw new TypeError('account owner fields')
  const ownerMemberId = asNullableString(record.ownerMemberId)
  const ownerMemberName = asNullableString(record.ownerMemberName)
  if ((record.ownershipKind === 'HOUSEHOLD' && ownerMemberId !== null) || (record.ownershipKind === 'MEMBER' && ownerMemberId === null)) throw new TypeError('account owner')
  if ((record.ownershipKind === 'HOUSEHOLD' && ownerMemberName !== null) || (record.ownershipKind === 'MEMBER' && ownerMemberName === null)) throw new TypeError('account owner name')
  return {
    id: asRequiredString(record.id), name: asRequiredString(record.name),
    accountKind: record.accountKind as AccountDto['accountKind'],
    accountSubtype: record.accountSubtype as AccountDto['accountSubtype'], currency: 'JPY',
    ownershipKind: record.ownershipKind, ownerMemberId, ownerMemberName, visibility: record.visibility,
  }
}

function parseImportSummaryDto(value: unknown): ImportSummaryDto {
  const record = asRecord(value)
  if (typeof record.runId !== 'string' || typeof record.documentId !== 'string' || typeof record.status !== 'string' || typeof record.reusedExisting !== 'boolean') throw new TypeError('import summary')
  return { runId: record.runId, documentId: record.documentId, status: record.status, recordCount: asSafeInteger(record.recordCount), candidateCount: asSafeInteger(record.candidateCount), reusedExisting: record.reusedExisting }
}

function parsePendingReviewList(value: unknown, expectedHouseholdId: string): PendingReviewListDto {
  const record = asRecord(value)
  if (!Array.isArray(record.runs) || record.runs.length > 200) throw new TypeError('pending review list')
  const runs = record.runs.map(parsePendingReviewRun)
  if (new Set(runs.map((run) => run.runId)).size !== runs.length
    || new Set(runs.map((run) => run.documentId)).size !== runs.length) {
    throw new TypeError('duplicate pending review')
  }
  for (let index = 1; index < runs.length; index += 1) {
    const previous = runs[index - 1]
    const current = runs[index]
    const previousTime = Date.parse(previous.startedAt)
    const currentTime = Date.parse(current.startedAt)
    if (previousTime < currentTime || (previousTime === currentTime && previous.runId > current.runId)) {
      throw new TypeError('pending review order')
    }
  }
  const householdId = asRequiredString(record.householdId)
  if (householdId !== expectedHouseholdId) throw new TypeError('pending review household')
  return { householdId, runs }
}

function parsePendingReviewRun(value: unknown): PendingReviewRunDto {
  const record = asRecord(value)
  if (record.status !== 'REVIEW_REQUIRED'
    || !Object.hasOwn(record, 'adapterId')
    || !Object.hasOwn(record, 'adapterVersion')
    || !Object.hasOwn(record, 'sourceModifiedAt')
    || typeof record.adapterId === 'undefined'
    || typeof record.adapterVersion === 'undefined'
    || typeof record.sourceModifiedAt === 'undefined') throw new TypeError('pending review status')
  const adapterId = asNullableString(record.adapterId)
  const adapterVersion = asNullableString(record.adapterVersion)
  if (adapterId === '' || adapterVersion === '') throw new TypeError('pending review adapter')
  if (record.completionState !== 'CANDIDATE_REVIEW' && record.completionState !== 'SOURCE_READY' && record.completionState !== 'SOURCE_RESUME_REQUIRED') throw new TypeError('pending review completion state')
  const candidateCount = asSafeInteger(record.candidateCount)
  if ((candidateCount > 0) !== (record.completionState === 'CANDIDATE_REVIEW')) throw new TypeError('pending review completion consistency')
  return {
    runId: asRequiredString(record.runId),
    documentId: asRequiredString(record.documentId),
    status: 'REVIEW_REQUIRED',
    adapterId,
    adapterVersion,
    startedAt: asIsoTimestamp(record.startedAt),
    sourceType: asRequiredString(record.sourceType),
    originalFilename: asRequiredString(record.originalFilename),
    mediaType: asRequiredString(record.mediaType),
    byteSize: asSafeInteger(record.byteSize),
    sourceModifiedAt: record.sourceModifiedAt === null ? null : asIsoTimestamp(record.sourceModifiedAt),
    recordCount: asSafeInteger(record.recordCount),
    candidateCount,
    completionState: record.completionState,
  }
}

function parseImportPreview(value: unknown): ImportPreviewDto {
  const record = asRecord(value)
  const source = asRecord(record.source)
  if (!Array.isArray(record.candidates) || typeof source.sourceType !== 'string' || typeof source.originalFilename !== 'string' || typeof source.mediaType !== 'string' || typeof source.sha256 !== 'string') throw new TypeError('import preview')
  return {
    summary: parseImportSummaryDto(record.summary),
    source: { sourceType: source.sourceType, originalFilename: source.originalFilename, mediaType: source.mediaType, byteSize: asSafeInteger(source.byteSize), sha256: source.sha256, ...parseAudience(source) },
    candidates: record.candidates.map(parsePreviewCandidate),
  }
}

function parsePreviewCandidate(value: unknown): PreviewCandidateDto {
  const record = asRecord(value)
  if ((record.direction !== 'IN' && record.direction !== 'OUT') || !['PENDING', 'READY', 'DUPLICATE', 'EXCLUDED'].includes(String(record.reviewStatus))) throw new TypeError('candidate')
  if (!Array.isArray(record.evidenceRoles) || !record.evidenceRoles.every((role) => typeof role === 'string') || !Array.isArray(record.issues) || !record.issues.every((issue) => typeof issue === 'string')) throw new TypeError('candidate details')
  const attribution = parseAttribution(record)
  const audience = parseAudience(record)
  if (typeof record.calculationTarget !== 'boolean') throw new TypeError('candidate calculation target')
  if (record.externalSource !== null && typeof record.externalSource !== 'undefined' && record.externalSource !== 'MONEY_FORWARD_ME') throw new TypeError('candidate external source')
  if (record.suggestedTransactionType !== null && typeof record.suggestedTransactionType !== 'undefined' && record.suggestedTransactionType !== 'TRANSFER') throw new TypeError('candidate suggested type')
  const externalFactHash = asNullableString(record.externalFactHash)
  if (externalFactHash !== null && !/^[0-9a-f]{64}$/.test(externalFactHash)) throw new TypeError('candidate fact hash')
  return {
    id: asRequiredString(record.id), accountId: asNullableString(record.accountId),
    occurredOn: asRequiredString(record.occurredOn), postedOn: asNullableString(record.postedOn),
    amountJpy: asSafeInteger(record.amountJpy), direction: record.direction,
    descriptionRaw: asNullableString(record.descriptionRaw), merchantRaw: asNullableString(record.merchantRaw),
    externalTransactionId: asNullableString(record.externalTransactionId),
    externalSource: record.externalSource === 'MONEY_FORWARD_ME' ? record.externalSource : null,
    externalFactHash, calculationTarget: record.calculationTarget,
    suggestedTransactionType: record.suggestedTransactionType === 'TRANSFER' ? record.suggestedTransactionType : null,
    institutionRaw: asNullableString(record.institutionRaw), categoryMajorRaw: asNullableString(record.categoryMajorRaw),
    categoryMinorRaw: asNullableString(record.categoryMinorRaw), memoRaw: asNullableString(record.memoRaw),
    extractionConfidenceBps: asNullableSafeInteger(record.extractionConfidenceBps),
    normalizationConfidenceBps: asNullableSafeInteger(record.normalizationConfidenceBps),
    ...attribution, ...audience,
    reviewStatus: record.reviewStatus as PreviewCandidateDto['reviewStatus'],
    evidenceCount: asSafeInteger(record.evidenceCount), evidenceRoles: record.evidenceRoles, issues: record.issues,
  }
}

function parseCommitSummary(value: unknown): CommitSummaryDto {
  const record = asRecord(value)
  if (typeof record.runId !== 'string') throw new TypeError('commit summary')
  return { runId: record.runId, postedCount: asSafeInteger(record.postedCount) }
}

function parseBackupSummary(value: unknown): BackupSummaryDto {
  const record = asRecord(value)
  if (record.formatVersion !== 2) throw new TypeError('backup version')
  return { formatVersion: record.formatVersion, entryCount: asSafeInteger(record.entryCount), plaintextBytes: asSafeInteger(record.plaintextBytes) }
}

function parseNullableBackupSummary(value: unknown): BackupSummaryDto | null {
  return value == null ? null : parseBackupSummary(value)
}

function parseExtractedDocument(value: unknown): ExtractedDocumentDto {
  const record = asRecord(value)
  if ((record.method !== 'EMBEDDED_TEXT' && record.method !== 'OCR') || typeof record.text !== 'string' || !Array.isArray(record.issues) || !record.issues.every((issue) => typeof issue === 'string')) throw new TypeError('extracted document')
  const confidenceBps = asSafeInteger(record.confidenceBps)
  if (confidenceBps > 10_000) throw new TypeError('confidence')
  return { method: record.method, text: record.text, confidenceBps, issues: record.issues }
}

const CARD_STATUSES: readonly CardReconciliationStatusDto[] = ['UNMATCHED', 'POSSIBLE_MATCH', 'FULLY_RECONCILED', 'PARTIALLY_RECONCILED', 'OVERPAID', 'UNDERPAID', 'MANUAL_OVERRIDE']

function parseCardSettlementPayment(value: unknown) {
  const record = asRecord(value)
  const matchScoreBps = asNullableSafeInteger(record.matchScoreBps)
  if (matchScoreBps != null && matchScoreBps > 10_000) throw new TypeError('card payment score')
  return {
    paymentId: asRequiredString(record.paymentId), bankTransactionId: asRequiredString(record.bankTransactionId),
    paymentAmountJpy: asSafeInteger(record.paymentAmountJpy), paymentOn: asIsoDate(record.paymentOn), matchScoreBps,
  }
}

function parseCardSettlement(value: unknown): CardSettlementDto {
    const record = asRecord(value)
    if (!CARD_STATUSES.includes(record.reconciliationStatus as CardReconciliationStatusDto)) throw new TypeError('card status')
    const matchScoreBps = asNullableSafeInteger(record.matchScoreBps)
    if (matchScoreBps != null && matchScoreBps > 10_000) throw new TypeError('card score')
    if (!Array.isArray(record.payments) || !Array.isArray(record.eligiblePayments)) throw new TypeError('card payments')
    const payments = record.payments.map(parseCardSettlementPayment)
    const eligiblePayments = record.eligiblePayments.map(parseCardSettlementPayment)
    const allPaymentIds = new Set<string>(); const allBankTransactionIds = new Set<string>()
    for (const collection of [payments, eligiblePayments]) collection.forEach((payment, index) => {
      if (allPaymentIds.has(payment.paymentId) || allBankTransactionIds.has(payment.bankTransactionId)) throw new TypeError('duplicate card payment')
      allPaymentIds.add(payment.paymentId); allBankTransactionIds.add(payment.bankTransactionId)
      if (index > 0) {
        const prior = collection[index - 1]
        if (prior.paymentOn > payment.paymentOn || (prior.paymentOn === payment.paymentOn && prior.paymentId >= payment.paymentId)) throw new TypeError('card payment order')
      }
    })
    const statementAmountJpy = asSafeInteger(record.statementAmountJpy)
    const periodStart = asIsoDate(record.periodStart)
    const periodEnd = asIsoDate(record.periodEnd)
    const paymentDueOn = asNullableIsoDate(record.paymentDueOn)
    if (periodStart > periodEnd || paymentDueOn != null && paymentDueOn < periodEnd) throw new TypeError('card statement dates')
    const paidAmountJpy = asSafeInteger(record.paidAmountJpy)
    const outstandingAmountJpy = asSafeInteger(record.outstandingAmountJpy)
    const overpaidAmountJpy = asSafeInteger(record.overpaidAmountJpy)
    if (paidAmountJpy !== payments.reduce((sum, payment) => sum + payment.paymentAmountJpy, 0)) throw new TypeError('card paid amount')
    if (outstandingAmountJpy !== Math.max(statementAmountJpy - paidAmountJpy, 0) || overpaidAmountJpy !== Math.max(paidAmountJpy - statementAmountJpy, 0)) throw new TypeError('card settlement balance')
    const expectedStatus: CardReconciliationStatusDto = paidAmountJpy === 0 ? 'UNMATCHED' : paidAmountJpy < statementAmountJpy ? 'PARTIALLY_RECONCILED' : paidAmountJpy === statementAmountJpy ? 'FULLY_RECONCILED' : 'OVERPAID'
    if (record.reconciliationStatus !== expectedStatus) throw new TypeError('card settlement status')
    return {
      id: asRequiredString(record.id), cardAccountId: asRequiredString(record.cardAccountId), cardName: asRequiredString(record.cardName),
      maskedIdentifier: asNullableString(record.maskedIdentifier), periodStart, periodEnd,
      paymentDueOn, statementAmountJpy,
      detailAmountJpy: asSafeSignedInteger(record.detailAmountJpy), lineCount: asSafeInteger(record.lineCount),
      paymentId: asNullableString(record.paymentId), bankTransactionId: asNullableString(record.bankTransactionId),
      paymentAmountJpy: asNullableSafeInteger(record.paymentAmountJpy), paymentOn: asNullableIsoDate(record.paymentOn),
      matchScoreBps, reconciliationStatus: record.reconciliationStatus as CardReconciliationStatusDto,
      paidAmountJpy, outstandingAmountJpy, overpaidAmountJpy, payments, eligiblePayments,
    }
}

function parseCardSettlements(value: unknown): readonly CardSettlementDto[] {
  if (!Array.isArray(value)) throw new TypeError('card settlements')
  return value.map(parseCardSettlement)
}

function parseCardMatchConfirmation(value: unknown): CardMatchConfirmationDto {
  const record = asRecord(value)
  if (record.reconciliationStatus !== 'FULLY_RECONCILED') throw new TypeError('card confirmation')
  return { statementId: asRequiredString(record.statementId), paymentId: asRequiredString(record.paymentId), reconciliationStatus: record.reconciliationStatus }
}

function asIsoDate(value: unknown): string {
  const result = asRequiredString(value)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(result)
  if (!match || match[1] === '0000') throw new TypeError('date')
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]); const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new TypeError('date')
  return result
}

function asNullableIsoDate(value: unknown): string | null {
  return value == null ? null : asIsoDate(value)
}

function parseCardSettlementBankMapping(value: unknown): CardSettlementBankMappingDto {
  const record = asRecord(value)
  return {
    householdId: asRequiredString(record.householdId), cardAccountId: asRequiredString(record.cardAccountId),
    cardAccountName: asRequiredString(record.cardAccountName), bankAccountId: asRequiredString(record.bankAccountId),
    bankAccountName: asRequiredString(record.bankAccountName), createdAt: asRequiredString(record.createdAt), updatedAt: asRequiredString(record.updatedAt),
  }
}

function parseCardSettlementBankMappings(value: unknown): readonly CardSettlementBankMappingDto[] {
  if (!Array.isArray(value)) throw new TypeError('card bank mappings')
  return value.map(parseCardSettlementBankMapping)
}

const COVERAGE_STATUSES = ['COVERED', 'SHORTFALL', 'OVERDUE'] as const

function parseCoverageStatement(value: unknown) {
  const record = asRecord(value)
  if (!COVERAGE_STATUSES.includes(record.status as typeof COVERAGE_STATUSES[number])) throw new TypeError('coverage status')
  return {
    statementId: asRequiredString(record.statementId), cardAccountId: asRequiredString(record.cardAccountId), cardAccountName: asRequiredString(record.cardAccountName),
    paymentDueOn: asIsoDate(record.paymentDueOn), statementAmountJpy: asSafeInteger(record.statementAmountJpy), paidAmountJpy: asSafeInteger(record.paidAmountJpy),
    outstandingAmountJpy: asSafeInteger(record.outstandingAmountJpy), projectedBankBalanceJpy: asSafeSignedInteger(record.projectedBankBalanceJpy),
    shortfallJpy: asSafeInteger(record.shortfallJpy), status: record.status as typeof COVERAGE_STATUSES[number],
  }
}

function parseUnmappedCardSettlement(value: unknown) {
  const record = asRecord(value)
  if (record.status !== 'UNMAPPED' && record.status !== 'OVERDUE') throw new TypeError('unmapped status')
  return {
    statementId: asRequiredString(record.statementId), cardAccountId: asRequiredString(record.cardAccountId), cardAccountName: asRequiredString(record.cardAccountName),
    paymentDueOn: asIsoDate(record.paymentDueOn), statementAmountJpy: asSafeInteger(record.statementAmountJpy), paidAmountJpy: asSafeInteger(record.paidAmountJpy),
    outstandingAmountJpy: asSafeInteger(record.outstandingAmountJpy), status: record.status as 'UNMAPPED' | 'OVERDUE',
  }
}

function parseMissingDueCardSettlement(value: unknown) {
  const record = asRecord(value)
  if (typeof record.mappingConfigured !== 'boolean') throw new TypeError('mapping configured')
  return {
    statementId: asRequiredString(record.statementId), cardAccountId: asRequiredString(record.cardAccountId), cardAccountName: asRequiredString(record.cardAccountName),
    statementAmountJpy: asSafeInteger(record.statementAmountJpy), paidAmountJpy: asSafeInteger(record.paidAmountJpy), outstandingAmountJpy: asSafeInteger(record.outstandingAmountJpy),
    mappingConfigured: record.mappingConfigured,
  }
}

function parseCardSettlementBalanceCoverage(value: unknown): CardSettlementBalanceCoverageDto {
  const record = asRecord(value)
  if (!Array.isArray(record.banks) || !Array.isArray(record.unmappedStatements) || !Array.isArray(record.missingDueStatements)) throw new TypeError('coverage collections')
  const asOf = asIsoDate(record.asOf); const historyFrom = asIsoDate(record.historyFrom); const horizonThrough = asIsoDate(record.horizonThrough)
  if (horizonThrough < asOf) throw new TypeError('coverage range')
  const horizonDays = asSafeInteger(record.horizonDays)
  if (horizonDays > 365) throw new TypeError('coverage horizon')
  const expectedHorizon = new Date(`${asOf}T00:00:00Z`); expectedHorizon.setUTCDate(expectedHorizon.getUTCDate() + horizonDays)
  if (expectedHorizon.toISOString().slice(0, 10) !== horizonThrough) throw new TypeError('coverage horizon')
  const statementIds = new Set<string>(); const bankIds = new Set<string>()
  const banks = record.banks.map((value) => {
    const bank = asRecord(value); if (!Array.isArray(bank.statements)) throw new TypeError('coverage statements')
    const bankAccountId = asRequiredString(bank.bankAccountId); if (bankIds.has(bankAccountId)) throw new TypeError('duplicate bank'); bankIds.add(bankAccountId)
    const balanceAsOfJpy = asSafeSignedInteger(bank.balanceAsOfJpy)
    const statements = bank.statements.map(parseCoverageStatement)
    statements.forEach((statement, index) => {
      if (statementIds.has(statement.statementId)) throw new TypeError('duplicate statement'); statementIds.add(statement.statementId)
      if (index > 0 && statements[index - 1].paymentDueOn > statement.paymentDueOn) throw new TypeError('statement order')
      if (statement.outstandingAmountJpy !== Math.max(statement.statementAmountJpy - statement.paidAmountJpy, 0)) throw new TypeError('outstanding amount')
      if (statement.shortfallJpy !== Math.max(-statement.projectedBankBalanceJpy, 0)) throw new TypeError('shortfall amount')
      const priorBalance = index === 0 ? balanceAsOfJpy : statements[index - 1].projectedBankBalanceJpy
      if (statement.projectedBankBalanceJpy !== priorBalance - statement.outstandingAmountJpy) throw new TypeError('projected balance step')
      const expectedStatus = statement.paymentDueOn < asOf ? 'OVERDUE' : statement.shortfallJpy > 0 ? 'SHORTFALL' : 'COVERED'
      if (statement.status !== expectedStatus) throw new TypeError('coverage status')
    })
    const projectedEndingBalanceJpy = asSafeSignedInteger(bank.projectedEndingBalanceJpy)
    const maxShortfallJpy = asSafeInteger(bank.maxShortfallJpy)
    if (projectedEndingBalanceJpy !== (statements.at(-1)?.projectedBankBalanceJpy ?? balanceAsOfJpy)) throw new TypeError('projected ending balance')
    if (maxShortfallJpy !== Math.max(0, ...statements.map((statement) => statement.shortfallJpy))) throw new TypeError('maximum shortfall')
    return {
      bankAccountId, bankAccountName: asRequiredString(bank.bankAccountName), balanceAsOfJpy, projectedEndingBalanceJpy, maxShortfallJpy, statements,
    }
  })
  const unmappedStatements = record.unmappedStatements.map(parseUnmappedCardSettlement)
  unmappedStatements.forEach((statement) => {
    if (statementIds.has(statement.statementId)) throw new TypeError('duplicate statement'); statementIds.add(statement.statementId)
    if (statement.outstandingAmountJpy !== Math.max(statement.statementAmountJpy - statement.paidAmountJpy, 0)) throw new TypeError('outstanding amount')
    if (statement.status !== (statement.paymentDueOn < asOf ? 'OVERDUE' : 'UNMAPPED')) throw new TypeError('unmapped status')
  })
  const missingDueStatements = record.missingDueStatements.map(parseMissingDueCardSettlement)
  missingDueStatements.forEach((statement) => {
    if (statementIds.has(statement.statementId)) throw new TypeError('duplicate statement'); statementIds.add(statement.statementId)
    if (statement.outstandingAmountJpy !== Math.max(statement.statementAmountJpy - statement.paidAmountJpy, 0)) throw new TypeError('outstanding amount')
  })
  const datedDueDates = [...banks.flatMap((bank) => bank.statements.map((statement) => statement.paymentDueOn)), ...unmappedStatements.map((statement) => statement.paymentDueOn)]
  const expectedHistoryFrom = datedDueDates.length > 0 ? [...datedDueDates].sort()[0] : asOf
  if (historyFrom !== expectedHistoryFrom) throw new TypeError('coverage history')
  return {
    asOf, historyFrom, horizonThrough, horizonDays, banks, unmappedStatements, missingDueStatements,
  }
}

function parseVoid(value: unknown): void {
  if (value !== null) throw new TypeError('void')
}

function parseReceiptMatchSuggestion(value: unknown): ReceiptMatchSuggestionDto {
  const record = asRecord(value)
  if (record.transactionType !== 'EXPENSE' && record.transactionType !== 'CARD_PURCHASE') throw new TypeError('receipt match type')
  if (!Array.isArray(record.reasons) || !record.reasons.every((reason) => typeof reason === 'string')) throw new TypeError('receipt match reasons')
  const dayDifference = asSafeInteger(record.dayDifference); const merchantSimilarityBps = asSafeInteger(record.merchantSimilarityBps); const scoreBps = asSafeInteger(record.scoreBps)
  if (dayDifference < 0 || dayDifference > 3 || merchantSimilarityBps < 0 || merchantSimilarityBps > 10000 || scoreBps < 0 || scoreBps > 10000) throw new TypeError('receipt match score')
  return {
    candidateId: asRequiredString(record.candidateId), transactionId: asRequiredString(record.transactionId), occurredOn: asIsoDate(record.occurredOn),
    payee: asNullableString(record.payee), description: asNullableString(record.description), transactionType: record.transactionType,
    amountJpy: asSafeInteger(record.amountJpy), dayDifference, merchantSimilarityBps, scoreBps, reasons: record.reasons,
  }
}

function parseReceiptMatchSuggestions(value: unknown): readonly ReceiptMatchSuggestionDto[] {
  if (!Array.isArray(value) || value.length > 10) throw new TypeError('receipt matches')
  const suggestions = value.map(parseReceiptMatchSuggestion)
  if (new Set(suggestions.map((item) => item.transactionId)).size !== suggestions.length) throw new TypeError('receipt match duplicate')
  if (suggestions.some((item, index) => index > 0 && suggestions[index - 1].scoreBps < item.scoreBps)) throw new TypeError('receipt match order')
  return suggestions
}

function parseReceiptMatchConfirmation(value: unknown): ReceiptMatchConfirmationDto {
  const record = asRecord(value)
  const evidenceCount = asSafeInteger(record.evidenceCount)
  if (record.resolutionStatus !== 'LINKED' || evidenceCount < 1 || (record.runStatus !== 'POSTED' && record.runStatus !== 'REVIEW_REQUIRED')) throw new TypeError('receipt match confirmation')
  return { runId: asRequiredString(record.runId), candidateId: asRequiredString(record.candidateId), transactionId: asRequiredString(record.transactionId), resolutionStatus: 'LINKED', evidenceCount, runStatus: record.runStatus }
}

function parseBudget(value: unknown): MonthlyCategoryBudgetDto {
  const record = asRecord(value)
  return {
    householdId: asRequiredString(record.householdId), month: asRequiredString(record.month),
    categoryAccountId: asRequiredString(record.categoryAccountId), categoryName: asRequiredString(record.categoryName),
    budgetJpy: asSafeInteger(record.budgetJpy), actualJpy: asSafeSignedInteger(record.actualJpy), remainingJpy: asSafeSignedInteger(record.remainingJpy),
  }
}

function parseBudgets(value: unknown): readonly MonthlyCategoryBudgetDto[] {
  if (!Array.isArray(value)) throw new TypeError('budgets')
  return value.map(parseBudget)
}

const GOAL_STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'] as const

function parseSavingsGoal(value: unknown): SavingsGoalDto {
  const record = asRecord(value)
  if (!GOAL_STATUSES.includes(record.status as typeof GOAL_STATUSES[number])) throw new TypeError('goal status')
  return {
    id: asRequiredString(record.id), householdId: asRequiredString(record.householdId), name: asRequiredString(record.name),
    targetJpy: asSafeInteger(record.targetJpy), savedJpy: asSafeInteger(record.savedJpy), targetDate: asRequiredString(record.targetDate),
    status: record.status as SavingsGoalDto['status'], createdAt: asRequiredString(record.createdAt), updatedAt: asRequiredString(record.updatedAt),
  }
}

function parseSavingsGoals(value: unknown): readonly SavingsGoalDto[] {
  if (!Array.isArray(value)) throw new TypeError('goals')
  return value.map(parseSavingsGoal)
}

function parseStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.length > 0)) throw new TypeError('string list')
  return value
}

function parseClassificationRule(value: unknown): ClassificationRuleDto {
  const record = asRecord(value)
  if (typeof record.isEnabled !== 'boolean') throw new TypeError('classification rule')
  return {
    id: asRequiredString(record.id), householdId: asRequiredString(record.householdId), name: asRequiredString(record.name),
    priority: asSafeInteger(record.priority), isEnabled: record.isEnabled,
    merchantContains: asNullableString(record.merchantContains), descriptionContains: asNullableString(record.descriptionContains),
    categoryAccountId: asRequiredString(record.categoryAccountId), categoryName: asRequiredString(record.categoryName),
    labels: parseStringList(record.labels), tags: parseStringList(record.tags),
    createdAt: asRequiredString(record.createdAt), updatedAt: asRequiredString(record.updatedAt),
  }
}

function parseClassificationRules(value: unknown): readonly ClassificationRuleDto[] {
  if (!Array.isArray(value)) throw new TypeError('classification rules')
  return value.map(parseClassificationRule)
}

function parseClassificationPreview(value: unknown): ClassificationPreviewDto {
  const record = asRecord(value)
  return { winningRuleId: asNullableString(record.winningRuleId), matches: parseClassificationRules(record.matches) }
}

function parseAppliedClassification(value: unknown): AppliedClassificationDto {
  const record = asRecord(value)
  return {
    transactionId: asRequiredString(record.transactionId), ruleId: asRequiredString(record.ruleId),
    categoryAccountId: asRequiredString(record.categoryAccountId), categoryName: asRequiredString(record.categoryName),
    labels: parseStringList(record.labels), tags: parseStringList(record.tags),
    transactionUpdatedAt: asRequiredString(record.transactionUpdatedAt),
  }
}

function parseDashboard(value: unknown): DashboardMonthlyTotalsDto {
  const record = asRecord(value)
  if (typeof record.month !== 'string' || typeof record.netWorthAsOf !== 'string' || (record.accountingBasis !== 'ACCRUAL' && record.accountingBasis !== 'CASH') || !Array.isArray(record.accrualTrend) || !Array.isArray(record.cashFlowTrend) || !Array.isArray(record.expenseCategories)) throw new TypeError('dashboard')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(record.month) || record.cashFlowTrend.length !== 6) throw new TypeError('dashboard cash flow trend')
  const requestedMonthOrdinal = Number(record.month.slice(0, 4)) * 12 + Number(record.month.slice(5)) - 1
  const cashFlowTrend = record.cashFlowTrend.map((item, index) => {
    const point = asRecord(item)
    const month = asRequiredString(point.month)
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new TypeError('cash flow month')
    const monthOrdinal = Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1
    if (monthOrdinal !== requestedMonthOrdinal - 5 + index) throw new TypeError('cash flow month sequence')
    const inflowJpy = asSafeInteger(point.inflowJpy)
    const outflowJpy = asSafeInteger(point.outflowJpy)
    const netCashFlowJpy = asSafeSignedInteger(point.netCashFlowJpy)
    if (netCashFlowJpy !== inflowJpy - outflowJpy) throw new TypeError('cash flow net')
    return { month, inflowJpy, outflowJpy, netCashFlowJpy }
  })
  return {
    month: record.month,
    accountingBasis: record.accountingBasis,
    incomeJpy: asSafeSignedInteger(record.incomeJpy),
    expenseJpy: asSafeSignedInteger(record.expenseJpy),
    savingsJpy: asSafeSignedInteger(record.savingsJpy),
    postedTransactionCount: asSafeInteger(record.postedTransactionCount),
    netWorthAsOf: record.netWorthAsOf,
    assetsJpy: asSafeSignedInteger(record.assetsJpy),
    liabilitiesJpy: asSafeSignedInteger(record.liabilitiesJpy),
    netWorthJpy: asSafeSignedInteger(record.netWorthJpy),
    accrualTrend: record.accrualTrend.map((item) => {
      const point = asRecord(item)
      return { month: asRequiredString(point.month), incomeJpy: asSafeSignedInteger(point.incomeJpy), expenseJpy: asSafeSignedInteger(point.expenseJpy) }
    }),
    cashFlowTrend,
    expenseCategories: record.expenseCategories.map((item) => {
      const category = asRecord(item)
      return { accountId: asRequiredString(category.accountId), name: asRequiredString(category.name), amountJpy: asSafeSignedInteger(category.amountJpy) }
    }),
  }
}

function parseDashboardPreferences(value: unknown): DashboardPreferencesDto {
  const record = asRecord(value)
  const templates = ['FINANCIAL_OVERVIEW', 'HOUSEHOLD_LEDGER', 'ASSETS_LIABILITIES', 'CARD_RECONCILIATION', 'CASH_FLOW'] as const
  const themes = ['SYSTEM', 'LIGHT', 'DARK'] as const
  const densities = ['COMFORTABLE', 'COMPACT'] as const
  if (!templates.includes(record.template as typeof templates[number])
    || !themes.includes(record.theme as typeof themes[number])
    || !densities.includes(record.density as typeof densities[number])) {
    throw new TypeError('dashboard preferences')
  }
  const templateLayouts = parseDashboardTemplateLayouts(record.templateLayouts)
  return {
    householdId: asRequiredString(record.householdId),
    template: record.template as DashboardPreferencesDto['template'],
    theme: record.theme as DashboardPreferencesDto['theme'],
    density: record.density as DashboardPreferencesDto['density'],
    templateLayouts,
    updatedAt: asIsoTimestamp(record.updatedAt),
  }
}

function parseDashboardTemplateLayouts(value: unknown): DashboardTemplateLayoutsDto {
  const record = asRecord(value)
  const templates = ['FINANCIAL_OVERVIEW', 'HOUSEHOLD_LEDGER', 'ASSETS_LIABILITIES', 'CARD_RECONCILIATION', 'CASH_FLOW'] as const satisfies readonly DashboardTemplateDto[]
  if (Object.keys(record).length !== templates.length || templates.some((template) => !Object.hasOwn(record, template))) throw new TypeError('dashboard template layouts')
  const parseLayout = (template: DashboardTemplateDto) => {
    const layout = asRecord(record[template])
    if (Object.keys(layout).length !== 2 || !Object.hasOwn(layout, 'widgetOrder') || !Object.hasOwn(layout, 'hiddenWidgets')) throw new TypeError('dashboard layout')
    const widgetOrder = parseDashboardWidgetIds(layout.widgetOrder, 4)
    const eligible: readonly DashboardWidgetIdDto[] = template === 'CASH_FLOW'
      ? ['TREND', 'RECENT', 'CARDS'] as const
      : ['TREND', 'SPENDING', 'RECENT', 'CARDS'] as const
    const hiddenWidgets = parseDashboardWidgetIds(layout.hiddenWidgets, eligible.length - 1)
    if (widgetOrder.length !== 4
      || (['TREND', 'SPENDING', 'RECENT', 'CARDS'] as const).some((widget) => !widgetOrder.includes(widget))
      || hiddenWidgets.some((widget) => !eligible.includes(widget as typeof eligible[number]))) throw new TypeError('dashboard layout domain')
    return { widgetOrder, hiddenWidgets }
  }
  return {
    FINANCIAL_OVERVIEW: parseLayout('FINANCIAL_OVERVIEW'),
    HOUSEHOLD_LEDGER: parseLayout('HOUSEHOLD_LEDGER'),
    ASSETS_LIABILITIES: parseLayout('ASSETS_LIABILITIES'),
    CARD_RECONCILIATION: parseLayout('CARD_RECONCILIATION'),
    CASH_FLOW: parseLayout('CASH_FLOW'),
  }
}

function parseDashboardWidgetIds(value: unknown, maximumLength: number): DashboardWidgetIdDto[] {
  const widgets = ['TREND', 'SPENDING', 'RECENT', 'CARDS'] as const
  if (!Array.isArray(value) || value.length > maximumLength) throw new TypeError('dashboard widgets')
  const parsed = value.map((item) => {
    if (typeof item !== 'string' || !widgets.includes(item as typeof widgets[number])) throw new TypeError('dashboard widget')
    return item as DashboardWidgetIdDto
  })
  if (new Set(parsed).size !== parsed.length) throw new TypeError('dashboard widgets')
  return parsed
}

function parseTransactionPage(value: unknown): TransactionPageDto {
  const record = asRecord(value)
  if (!Array.isArray(record.items)) throw new TypeError('transactions')
  return {
    items: record.items.map(parseTransactionRow),
    page: asSafeInteger(record.page),
    pageSize: asSafeInteger(record.pageSize),
    totalItems: asSafeInteger(record.totalItems),
    totalPages: asSafeInteger(record.totalPages),
  }
}

function parseTransactionRow(value: unknown): TransactionPageDto['items'][number] {
  const row = asRecord(value)
  if (typeof row.id !== 'string' || typeof row.occurredOn !== 'string' || typeof row.transactionType !== 'string' || typeof row.status !== 'string' || typeof row.calculationTarget !== 'boolean') throw new TypeError('transaction')
  const attribution = parseAttribution(row, true)
  const audience = parseAudience(row, true)
  return {
    id: row.id,
    occurredOn: row.occurredOn,
    postedOn: asNullableString(row.postedOn),
    transactionType: row.transactionType,
    payee: asNullableString(row.payee),
    description: asNullableString(row.description),
    amountJpy: asSafeSignedInteger(row.amountJpy),
    status: row.status,
    calculationTarget: row.calculationTarget,
    debitAccountId: asNullableString(row.debitAccountId),
    debitAccountName: asNullableString(row.debitAccountName),
    creditAccountId: asNullableString(row.creditAccountId),
    creditAccountName: asNullableString(row.creditAccountName),
    categoryAccountId: asNullableString(row.categoryAccountId),
    categoryName: asNullableString(row.categoryName),
    labels: parseTransactionLabels(row.labels),
    tags: parseStringList(row.tags),
    ...attribution, ...audience,
  }
}

function parseTransactionDetail(value: unknown): TransactionDetailDto {
  const record = asRecord(value)
  const allowedTypes = ['EXPENSE', 'INCOME', 'TRANSFER', 'CARD_PURCHASE', 'CARD_PAYMENT', 'REFUND', 'FEE', 'INTEREST', 'ADJUSTMENT']
  if (typeof record.id !== 'string' || typeof record.householdId !== 'string' || typeof record.occurredOn !== 'string' || typeof record.status !== 'string' || typeof record.createdAt !== 'string' || typeof record.updatedAt !== 'string' || typeof record.editable !== 'boolean' || typeof record.calculationTarget !== 'boolean' || typeof record.transactionType !== 'string' || !allowedTypes.includes(record.transactionType) || !Array.isArray(record.entries) || !Array.isArray(record.sourceEvidence)) throw new TypeError('transaction detail')
  const attribution = parseAttribution(record, true)
  const audience = parseAudience(record, true)
  return {
    id: record.id, householdId: record.householdId, occurredOn: record.occurredOn, postedOn: asNullableString(record.postedOn),
    transactionType: record.transactionType as TransactionDetailDto['transactionType'], payee: asNullableString(record.payee), description: asNullableString(record.description),
    ...attribution, ...audience,
    status: record.status, createdAt: record.createdAt, updatedAt: record.updatedAt, editable: record.editable, calculationTarget: record.calculationTarget,
    labels: parseTransactionLabels(record.labels), tags: parseStringList(record.tags),
    entries: record.entries.map((item) => { const entry = asRecord(item); if (entry.side !== 'DEBIT' && entry.side !== 'CREDIT') throw new TypeError('journal entry'); return { id: asRequiredString(entry.id), accountId: asRequiredString(entry.accountId), accountName: asRequiredString(entry.accountName), accountKind: asRequiredString(entry.accountKind), side: entry.side, amountJpy: asSafeSignedInteger(entry.amountJpy), lineNumber: asSafeInteger(entry.lineNumber) } }),
    sourceEvidence: record.sourceEvidence.map((item) => { const evidence = asRecord(item); return { sourceRecordId: asRequiredString(evidence.sourceRecordId), sourceDocumentId: asRequiredString(evidence.sourceDocumentId), sourceType: asRequiredString(evidence.sourceType), originalFilename: asRequiredString(evidence.originalFilename), mediaType: asRequiredString(evidence.mediaType), rowNumber: asSafeInteger(evidence.rowNumber), importedAt: asRequiredString(evidence.importedAt), evidenceRole: asRequiredString(evidence.evidenceRole), ...parseAudience(evidence, true) } }),
  }
}

const TRANSACTION_LABELS = ['SUBSCRIPTION', 'RECURRING', 'TAX_DEDUCTIBLE', 'REIMBURSABLE', 'UNUSUAL', 'SHARED_EXPENSE', 'PRIVATE_EXPENSE'] as const

function parseTransactionLabels(value: unknown): TransactionPageDto['items'][number]['labels'] {
  if (!Array.isArray(value) || !value.every((item) => TRANSACTION_LABELS.includes(item as typeof TRANSACTION_LABELS[number]))) throw new TypeError('transaction labels')
  return value as TransactionPageDto['items'][number]['labels']
}

function parseBulkUpdateTransactionMetadataResult(value: unknown): BulkUpdateTransactionMetadataResultDto {
  const record = asRecord(value)
  return { updatedCount: asSafeInteger(record.updatedCount) }
}

function parseSourceDocument(value: unknown): SourceDocumentViewDto {
  const record = asRecord(value)
  return {
    id: asRequiredString(record.id), householdId: asRequiredString(record.householdId), importRunId: asRequiredString(record.importRunId),
    sourceType: asRequiredString(record.sourceType), originalFilename: asRequiredString(record.originalFilename), mediaType: asRequiredString(record.mediaType),
    byteSize: asSafeInteger(record.byteSize), sha256: asRequiredString(record.sha256), sourceModifiedAt: asNullableString(record.sourceModifiedAt),
    importedAt: asRequiredString(record.importedAt), adapterId: asNullableString(record.adapterId), adapterVersion: asNullableString(record.adapterVersion),
    recordCount: asSafeInteger(record.recordCount), ...parseAudience(record, true),
  }
}

function parseAttribution(record: Record<string, unknown>): { attributionKind: AttributionKindDto; attributedMemberId: string | null }
function parseAttribution(record: Record<string, unknown>, withName: true): { attributionKind: AttributionKindDto; attributedMemberId: string | null; attributedMemberName: string | null }
function parseAttribution(record: Record<string, unknown>, withName = false): { attributionKind: AttributionKindDto; attributedMemberId: string | null; attributedMemberName?: string | null } {
  if (record.attributionKind !== 'HOUSEHOLD' && record.attributionKind !== 'MEMBER') throw new TypeError('attribution kind')
  if (!Object.hasOwn(record, 'attributedMemberId')) throw new TypeError('attributed member')
  const attributedMemberId = asNullableString(record.attributedMemberId)
  if ((record.attributionKind === 'HOUSEHOLD') !== (attributedMemberId === null)) throw new TypeError('attribution tuple')
  const attributionKind = record.attributionKind as AttributionKindDto
  if (!withName) return { attributionKind, attributedMemberId }
  if (!Object.hasOwn(record, 'attributedMemberName')) throw new TypeError('attributed member name')
  const attributedMemberName = asNullableString(record.attributedMemberName)
  if ((record.attributionKind === 'HOUSEHOLD') !== (attributedMemberName === null)) throw new TypeError('attribution name tuple')
  return { attributionKind, attributedMemberId, attributedMemberName }
}

function parseAudience(record: Record<string, unknown>): { audienceVisibility: AudienceVisibilityDto; audienceMemberId: string | null }
function parseAudience(record: Record<string, unknown>, withName: true): { audienceVisibility: AudienceVisibilityDto; audienceMemberId: string | null; audienceMemberName: string | null }
function parseAudience(record: Record<string, unknown>, withName = false): { audienceVisibility: AudienceVisibilityDto; audienceMemberId: string | null; audienceMemberName?: string | null } {
  if (record.audienceVisibility !== 'SHARED' && record.audienceVisibility !== 'PERSONAL') throw new TypeError('audience visibility')
  if (!Object.hasOwn(record, 'audienceMemberId')) throw new TypeError('audience member')
  const audienceMemberId = asNullableString(record.audienceMemberId)
  if ((record.audienceVisibility === 'SHARED') !== (audienceMemberId === null)) throw new TypeError('audience tuple')
  const audienceVisibility = record.audienceVisibility as AudienceVisibilityDto
  if (!withName) return { audienceVisibility, audienceMemberId }
  if (!Object.hasOwn(record, 'audienceMemberName')) throw new TypeError('audience member name')
  const audienceMemberName = asNullableString(record.audienceMemberName)
  if ((record.audienceVisibility === 'SHARED') !== (audienceMemberName === null)) throw new TypeError('audience name tuple')
  return { audienceVisibility, audienceMemberId, audienceMemberName }
}

function parseSourceRecord(value: unknown): SourceRecordViewDto {
  const record = asRecord(value)
  const payloadJson = asRequiredString(record.payloadJson)
  try { JSON.parse(payloadJson) } catch { throw new TypeError('source record payload') }
  return {
    id: asRequiredString(record.id), sourceDocumentId: asRequiredString(record.sourceDocumentId), rowNumber: asSafeInteger(record.rowNumber),
    recordHash: asRequiredString(record.recordHash), payloadJson, createdAt: asRequiredString(record.createdAt), evidenceRole: asNullableString(record.evidenceRole),
  }
}

function parseSourceRecords(value: unknown): readonly SourceRecordViewDto[] {
  if (!Array.isArray(value)) throw new TypeError('source records')
  return value.map(parseSourceRecord)
}

function parseSourceRecordPage(value: unknown): SourceRecordPageDto {
  const record = asRecord(value)
  return {
    items: parseSourceRecords(record.items), page: asSafeInteger(record.page), pageSize: asSafeInteger(record.pageSize),
    totalItems: asSafeInteger(record.totalItems), totalPages: asSafeInteger(record.totalPages),
  }
}

function parseWatchedFolder(value: unknown): WatchedFolderDto {
  const record = asRecord(value)
  if (typeof record.id !== 'string' || typeof record.householdId !== 'string' || typeof record.label !== 'string' || typeof record.displayName !== 'string' || typeof record.isEnabled !== 'boolean' || typeof record.createdAt !== 'string') throw new TypeError('watched folder')
  return { id: record.id, householdId: record.householdId, label: record.label, displayName: record.displayName, isEnabled: record.isEnabled, createdAt: record.createdAt }
}
function parseWatchedFolders(value: unknown): readonly WatchedFolderDto[] { if (!Array.isArray(value)) throw new TypeError('watched folders'); return value.map(parseWatchedFolder) }
function parseNullableWatchedFolder(value: unknown): WatchedFolderDto | null { return value === null ? null : parseWatchedFolder(value) }
function parseWatchedFileMetadata(value: unknown): WatchedFileMetadataDto { const record = asRecord(value); return { relativePath: asRequiredString(record.relativePath), fileName: asRequiredString(record.fileName), mediaType: asRequiredString(record.mediaType), byteSize: asSafeInteger(record.byteSize), modifiedUnixMs: record.modifiedUnixMs === null ? null : asSafeInteger(record.modifiedUnixMs) } }
function parseWatchedFolderScan(value: unknown) { const record = asRecord(value); if (!Array.isArray(record.files)) throw new TypeError('watched folder scan'); return { watchedFolderId: asRequiredString(record.watchedFolderId), files: record.files.map(parseWatchedFileMetadata) } }
function parseWatchedFile(value: unknown) { const record = asRecord(value); if (!Array.isArray(record.fileBytes) || record.fileBytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new TypeError('watched file'); return { ...parseWatchedFileMetadata(record), fileBytes: record.fileBytes as number[] } }

const WATCHED_FILE_INBOX_STATES = new Set<WatchedFileInboxStateDto>(['DISCOVERED', 'PROCESSING', 'READY', 'NEEDS_MAPPING', 'STAGED', 'FAILED', 'IGNORED', 'REMOVED'])
function parseWatchedFileInboxItem(value: unknown): WatchedFileInboxItemDto {
  const record = asRecord(value)
  if (!WATCHED_FILE_INBOX_STATES.has(record.state as WatchedFileInboxStateDto)) throw new TypeError('watched inbox state')
  const state = record.state as WatchedFileInboxStateDto
  const importRunId = asNullableString(record.importRunId)
  const lastErrorCode = asNullableString(record.lastErrorCode)
  const attemptCount = asSafeInteger(record.attemptCount)
  if (attemptCount > 5 || (state === 'STAGED') !== (importRunId !== null) || (state === 'FAILED') !== (lastErrorCode !== null)) throw new TypeError('watched inbox invariant')
  if (lastErrorCode !== null && !/^[A-Z][A-Z0-9_]{1,63}$/.test(lastErrorCode)) throw new TypeError('watched inbox error code')
  return {
    id: asCanonicalHash(record.id), householdId: asRequiredString(record.householdId), watchedFolderId: asRequiredString(record.watchedFolderId),
    watchedFolderLabel: asRequiredString(record.watchedFolderLabel), relativePath: asRequiredString(record.relativePath), fileName: asRequiredString(record.fileName),
    mediaType: asRequiredString(record.mediaType), byteSize: asSafeInteger(record.byteSize), modifiedUnixMs: asNullableSafeInteger(record.modifiedUnixMs),
    fingerprint: asCanonicalHash(record.fingerprint), state, attemptCount, importRunId, lastErrorCode,
    discoveredAt: asIsoTimestamp(record.discoveredAt), updatedAt: asIsoTimestamp(record.updatedAt),
  }
}
function parseWatchedFileInboxItems(value: unknown): readonly WatchedFileInboxItemDto[] {
  if (!Array.isArray(value)) throw new TypeError('watched inbox items')
  const items = value.map(parseWatchedFileInboxItem)
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new TypeError('duplicate watched inbox item')
  return items
}
function parseWatchedFileInboxCounts(value: unknown) {
  const record = asRecord(value)
  const keys = ['discovered', 'processing', 'ready', 'needsMapping', 'staged', 'failed', 'ignored', 'removed', 'actionable', 'total'] as const
  const counts = Object.fromEntries(keys.map((key) => [key, asSafeInteger(record[key])])) as unknown as import('./types').WatchedFileInboxCountsDto
  const sum = counts.discovered + counts.processing + counts.ready + counts.needsMapping + counts.staged + counts.failed + counts.ignored + counts.removed
  if (!Number.isSafeInteger(sum) || counts.total !== sum || counts.actionable !== counts.discovered + counts.ready + counts.needsMapping + counts.failed) throw new TypeError('watched inbox counts')
  return counts
}
function parseWatchedFileInboxClaim(value: unknown): WatchedFileInboxClaimDto {
  const record = asRecord(value)
  const items = parseWatchedFileInboxItems(record.items)
  if (items.length < 1 || items.length > 25 || items.some((item) => item.state !== 'PROCESSING')) throw new TypeError('watched inbox claim')
  return { leaseToken: asCanonicalHash(record.leaseToken), leaseExpiresAt: asIsoTimestamp(record.leaseExpiresAt), items }
}

function parseImportSummary(value: unknown): ImportRunCountsDto {
  const record = asRecord(value)
  const keys = ['totalRuns', 'discovered', 'extracting', 'reviewRequired', 'posted', 'failed', 'rolledBack', 'sourceDocuments', 'sourceRecords', 'pendingCandidates', 'readyCandidates'] as const
  const counts = Object.fromEntries(keys.map((key) => [key, asSafeInteger(record[key])])) as unknown as Omit<ImportRunCountsDto, 'latestSuccessfulImportAt' | 'latestSourceFilename' | 'latestSourceType' | 'distinctSourceTypes'>
  const latestSuccessfulImportAt = record.latestSuccessfulImportAt === null ? null : asIsoTimestamp(record.latestSuccessfulImportAt)
  const latestSourceFilename = asNullableString(record.latestSourceFilename)
  const latestSourceType = asNullableString(record.latestSourceType)
  if ((latestSuccessfulImportAt === null) !== (latestSourceFilename === null) || (latestSuccessfulImportAt === null) !== (latestSourceType === null)) throw new TypeError('import freshness')
  return { ...counts, latestSuccessfulImportAt, latestSourceFilename, latestSourceType, distinctSourceTypes: asSafeInteger(record.distinctSourceTypes) }
}

function parseBootstrap(value: unknown): AppBootstrapDto {
  const record = asRecord(value)
  if (typeof record.application !== 'string') throw new TypeError('application')

  return {
    application: record.application,
    database: parseDatabaseStatus(record.database),
  }
}

function parseHealth(value: unknown): AppHealthDto {
  const record = asRecord(value)
  if (record.status !== 'ok' && record.status !== 'degraded') throw new TypeError('status')

  return {
    status: record.status,
    database: parseDatabaseStatus(record.database),
  }
}

function parseStatus(value: unknown): AppStatusDto {
  const record = asRecord(value)
  if (record.integrity !== 'ok' && record.integrity !== 'failed') throw new TypeError('integrity')

  return {
    schemaVersion: asSafeInteger(record.schemaVersion),
    integrity: record.integrity,
  }
}

function parseDatabaseStatus(value: unknown): DatabaseStatusDto {
  const record = asRecord(value)
  if (typeof record.healthy !== 'boolean') throw new TypeError('healthy')

  return {
    healthy: record.healthy,
    schemaVersion: asSafeInteger(record.schemaVersion),
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('object')
  return value as Record<string, unknown>
}

function asSafeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('integer')
  return value
}

function asBoundedInteger(value: unknown, maximum: number): number {
  const integer = asSafeInteger(value)
  if (integer > maximum) throw new TypeError('bounded integer')
  return integer
}

function asSafeSignedInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('integer')
  return value
}

function asNullableString(value: unknown): string | null {
  if (value === null || typeof value === 'undefined') return null
  if (typeof value !== 'string') throw new TypeError('string')
  return value
}

function asNullableStrictString(value: unknown): string | null {
  if (value === null) return null
  return asRequiredString(value)
}

function asRequiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError('string')
  return value
}

function asCanonicalHash(value: unknown): string {
  const hash = asRequiredString(value)
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new TypeError('hash')
  return hash
}

function asIsoTimestamp(value: unknown): string {
  const timestamp = asRequiredString(value)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp) || Number.isNaN(Date.parse(timestamp))) throw new TypeError('timestamp')
  return timestamp
}

function asNullableSafeInteger(value: unknown): number | null {
  if (value === null || typeof value === 'undefined') return null
  return asSafeInteger(value)
}

export const platformClient = createPlatformClient()
