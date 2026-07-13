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
  DatabaseStatusDto,
  ExtractedDocumentDto,
  HouseholdDto,
  HouseholdMemberDto,
  ImportPreviewDto,
  ImportRunCountsDto,
  ImportSummaryDto,
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
  SavingsGoalDto,
  AppliedClassificationDto,
  AttributionKindDto,
  AudienceVisibilityDto,
  ClassificationPreviewDto,
  ClassificationRuleDto,
  ReceiptMatchSuggestionDto,
  ReceiptMatchConfirmationDto,
  BulkUpdateTransactionMetadataResultDto,
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
  accrualTrend: Object.freeze([]), expenseCategories: Object.freeze([]),
})

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
      queryDashboard: async (request) => ({ month: request.month, accountingBasis: request.accountingBasis, incomeJpy: 0, expenseJpy: 0, savingsJpy: 0, postedTransactionCount: 0, ...EMPTY_DASHBOARD_ANALYTICS }),
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
      importSummary: async () => ({ totalRuns: 0, discovered: 0, extracting: 0, reviewRequired: 0, posted: 0, failed: 0, rolledBack: 0, sourceDocuments: 0, sourceRecords: 0, pendingCandidates: 0, readyCandidates: 0 }),
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
    queryDashboard: (request) => invokeValidated(invoke, 'dashboard_query', parseDashboard, { request }),
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
    const paidAmountJpy = asSafeInteger(record.paidAmountJpy)
    const outstandingAmountJpy = asSafeInteger(record.outstandingAmountJpy)
    const overpaidAmountJpy = asSafeInteger(record.overpaidAmountJpy)
    if (paidAmountJpy !== payments.reduce((sum, payment) => sum + payment.paymentAmountJpy, 0)) throw new TypeError('card paid amount')
    if (outstandingAmountJpy !== Math.max(statementAmountJpy - paidAmountJpy, 0) || overpaidAmountJpy !== Math.max(paidAmountJpy - statementAmountJpy, 0)) throw new TypeError('card settlement balance')
    const expectedStatus: CardReconciliationStatusDto = paidAmountJpy === 0 ? 'UNMATCHED' : paidAmountJpy < statementAmountJpy ? 'PARTIALLY_RECONCILED' : paidAmountJpy === statementAmountJpy ? 'FULLY_RECONCILED' : 'OVERPAID'
    if (record.reconciliationStatus !== expectedStatus) throw new TypeError('card settlement status')
    return {
      id: asRequiredString(record.id), cardAccountId: asRequiredString(record.cardAccountId), cardName: asRequiredString(record.cardName),
      maskedIdentifier: asNullableString(record.maskedIdentifier), periodStart: asIsoDate(record.periodStart), periodEnd: asIsoDate(record.periodEnd),
      paymentDueOn: asNullableIsoDate(record.paymentDueOn), statementAmountJpy,
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
  if (typeof record.month !== 'string' || typeof record.netWorthAsOf !== 'string' || (record.accountingBasis !== 'ACCRUAL' && record.accountingBasis !== 'CASH') || !Array.isArray(record.accrualTrend) || !Array.isArray(record.expenseCategories)) throw new TypeError('dashboard')
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
    expenseCategories: record.expenseCategories.map((item) => {
      const category = asRecord(item)
      return { accountId: asRequiredString(category.accountId), name: asRequiredString(category.name), amountJpy: asSafeSignedInteger(category.amountJpy) }
    }),
  }
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

function parseImportSummary(value: unknown): ImportRunCountsDto {
  const record = asRecord(value)
  const keys = ['totalRuns', 'discovered', 'extracting', 'reviewRequired', 'posted', 'failed', 'rolledBack', 'sourceDocuments', 'sourceRecords', 'pendingCandidates', 'readyCandidates'] as const
  return Object.fromEntries(keys.map((key) => [key, asSafeInteger(record[key])])) as unknown as ImportRunCountsDto
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

function asSafeSignedInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('integer')
  return value
}

function asNullableString(value: unknown): string | null {
  if (value === null || typeof value === 'undefined') return null
  if (typeof value !== 'string') throw new TypeError('string')
  return value
}

function asRequiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError('string')
  return value
}

function asNullableSafeInteger(value: unknown): number | null {
  if (value === null || typeof value === 'undefined') return null
  return asSafeInteger(value)
}

export const platformClient = createPlatformClient()
