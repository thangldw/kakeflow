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
  DashboardMonthlyTotalsDto,
  DatabaseStatusDto,
  ExtractedDocumentDto,
  HouseholdDto,
  ImportPreviewDto,
  ImportRunCountsDto,
  ImportSummaryDto,
  Invoke,
  MonthlyCategoryBudgetDto,
  PlatformClient,
  PreviewCandidateDto,
  TransactionPageDto,
  SavingsGoalDto,
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
      listAccounts: async () => [],
      createAccount: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'account_create') },
      renameAccount: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'account_rename') },
      archiveAccount: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'account_archive') },
      queryTransactions: async (request) => ({ items: [], page: request.page, pageSize: request.pageSize, totalItems: 0, totalPages: 0 }),
      queryDashboard: async (request) => ({ month: request.month, accountingBasis: request.accountingBasis, incomeJpy: 0, expenseJpy: 0, savingsJpy: 0, postedTransactionCount: 0, ...EMPTY_DASHBOARD_ANALYTICS }),
      listBudgets: async () => [],
      upsertBudget: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'budget_upsert') },
      listSavingsGoals: async () => [],
      createSavingsGoal: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'savings_goal_create') },
      updateSavingsGoal: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'savings_goal_update') },
      deleteSavingsGoal: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'savings_goal_delete') },
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
    }
  }

  return {
    runtime,
    bootstrap: () => invokeValidated(invoke, 'app_bootstrap', parseBootstrap),
    health: () => invokeValidated(invoke, 'app_health', parseHealth),
    status: () => invokeValidated(invoke, 'app_status', parseStatus),
    listHouseholds: () => invokeValidated(invoke, 'households_list', parseHouseholds),
    createHousehold: (input) => invokeValidated(invoke, 'household_create', parseHousehold, { input }),
    listAccounts: (householdId) => invokeValidated(invoke, 'accounts_list', parseAccounts, { householdId }),
    createAccount: (input) => invokeValidated(invoke, 'account_create', parseAccount, { input }),
    renameAccount: (input) => invokeValidated(invoke, 'account_rename', parseAccount, { input }),
    archiveAccount: async (input) => { await invokeValidated(invoke, 'account_archive', parseVoid, { input }) },
    queryTransactions: (request) => invokeValidated(invoke, 'transactions_query', parseTransactionPage, { request }),
    queryDashboard: (request) => invokeValidated(invoke, 'dashboard_query', parseDashboard, { request }),
    listBudgets: (householdId, month) => invokeValidated(invoke, 'budgets_query', parseBudgets, { householdId, month }),
    upsertBudget: (input) => invokeValidated(invoke, 'budget_upsert', parseBudget, { input }),
    listSavingsGoals: (householdId) => invokeValidated(invoke, 'savings_goals_list', parseSavingsGoals, { householdId }),
    createSavingsGoal: (input) => invokeValidated(invoke, 'savings_goal_create', parseSavingsGoal, { input }),
    updateSavingsGoal: (input) => invokeValidated(invoke, 'savings_goal_update', parseSavingsGoal, { input }),
    deleteSavingsGoal: async (householdId, goalId) => { await invokeValidated(invoke, 'savings_goal_delete', parseVoid, { householdId, goalId }) },
    importSummary: (householdId) => invokeValidated(invoke, 'import_summary', parseImportSummary, { householdId }),
    startImport: (request, fileBytes) => invokeValidated(invoke, 'import_start', parseImportSummaryDto, { request: { import: request, fileBytes: Array.from(fileBytes) } }),
    previewImport: (runId) => invokeValidated(invoke, 'import_preview', parseImportPreview, { runId }),
    commitImport: (runId, decisions) => invokeValidated(invoke, 'import_commit', parseCommitSummary, { runId, decisions }),
    rollbackImport: async (runId) => { await invokeValidated(invoke, 'import_rollback', parseVoid, { runId }) },
    createBackup: (archivePath, passphrase) => invokeValidated(invoke, 'backup_create', parseBackupSummary, { archivePath, passphrase }),
    stageBackupRestore: (passphrase) => invokeValidated(invoke, 'backup_restore_stage', parseNullableBackupSummary, { passphrase }),
    restartForRestore: async () => { await invokeValidated(invoke, 'app_restart_for_restore', parseVoid) },
    extractDocument: (fileBytes, mediaType) => invokeValidated(invoke, 'document_extract', parseExtractedDocument, { fileBytes: Array.from(fileBytes), mediaType }),
    ocrDocument: (fileBytes, mediaType) => invokeValidated(invoke, 'document_ocr', parseExtractedDocument, { fileBytes: Array.from(fileBytes), mediaType }),
    listCardSettlements: (householdId) => invokeValidated(invoke, 'cards_list', parseCardSettlements, { householdId }),
    confirmCardMatch: (householdId, statementId, paymentId) => invokeValidated(invoke, 'card_match_confirm', parseCardMatchConfirmation, { householdId, statementId, paymentId }),
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

function parseAccounts(value: unknown): readonly AccountDto[] {
  if (!Array.isArray(value)) throw new TypeError('accounts')
  return value.map(parseAccount)
}

function parseAccount(value: unknown): AccountDto {
  const record = asRecord(value)
  const accountKinds = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const
  const accountSubtypes = ['BANK', 'CASH', 'WALLET', 'SECURITIES', 'CREDIT_CARD', 'RECEIVABLE', 'OTHER'] as const
  if (!accountKinds.includes(record.accountKind as typeof accountKinds[number]) || !accountSubtypes.includes(record.accountSubtype as typeof accountSubtypes[number]) || record.currency !== 'JPY') throw new TypeError('account')
  return {
    id: asRequiredString(record.id), name: asRequiredString(record.name),
    accountKind: record.accountKind as AccountDto['accountKind'],
    accountSubtype: record.accountSubtype as AccountDto['accountSubtype'], currency: 'JPY',
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
    source: { sourceType: source.sourceType, originalFilename: source.originalFilename, mediaType: source.mediaType, byteSize: asSafeInteger(source.byteSize), sha256: source.sha256 },
    candidates: record.candidates.map(parsePreviewCandidate),
  }
}

function parsePreviewCandidate(value: unknown): PreviewCandidateDto {
  const record = asRecord(value)
  if ((record.direction !== 'IN' && record.direction !== 'OUT') || !['PENDING', 'READY', 'DUPLICATE', 'EXCLUDED'].includes(String(record.reviewStatus))) throw new TypeError('candidate')
  if (!Array.isArray(record.evidenceRoles) || !record.evidenceRoles.every((role) => typeof role === 'string') || !Array.isArray(record.issues) || !record.issues.every((issue) => typeof issue === 'string')) throw new TypeError('candidate details')
  return {
    id: asRequiredString(record.id), accountId: asNullableString(record.accountId),
    occurredOn: asRequiredString(record.occurredOn), postedOn: asNullableString(record.postedOn),
    amountJpy: asSafeInteger(record.amountJpy), direction: record.direction,
    descriptionRaw: asNullableString(record.descriptionRaw), merchantRaw: asNullableString(record.merchantRaw),
    externalTransactionId: asNullableString(record.externalTransactionId),
    extractionConfidenceBps: asNullableSafeInteger(record.extractionConfidenceBps),
    normalizationConfidenceBps: asNullableSafeInteger(record.normalizationConfidenceBps),
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

function parseCardSettlements(value: unknown): readonly CardSettlementDto[] {
  if (!Array.isArray(value)) throw new TypeError('card settlements')
  return value.map((item) => {
    const record = asRecord(item)
    if (!CARD_STATUSES.includes(record.reconciliationStatus as CardReconciliationStatusDto)) throw new TypeError('card status')
    const matchScoreBps = asNullableSafeInteger(record.matchScoreBps)
    if (matchScoreBps != null && matchScoreBps > 10_000) throw new TypeError('card score')
    return {
      id: asRequiredString(record.id), cardAccountId: asRequiredString(record.cardAccountId), cardName: asRequiredString(record.cardName),
      maskedIdentifier: asNullableString(record.maskedIdentifier), periodStart: asRequiredString(record.periodStart), periodEnd: asRequiredString(record.periodEnd),
      paymentDueOn: asNullableString(record.paymentDueOn), statementAmountJpy: asSafeInteger(record.statementAmountJpy),
      detailAmountJpy: asSafeSignedInteger(record.detailAmountJpy), lineCount: asSafeInteger(record.lineCount),
      paymentId: asNullableString(record.paymentId), bankTransactionId: asNullableString(record.bankTransactionId),
      paymentAmountJpy: asNullableSafeInteger(record.paymentAmountJpy), paymentOn: asNullableString(record.paymentOn),
      matchScoreBps, reconciliationStatus: record.reconciliationStatus as CardReconciliationStatusDto,
    }
  })
}

function parseCardMatchConfirmation(value: unknown): CardMatchConfirmationDto {
  const record = asRecord(value)
  if (record.reconciliationStatus !== 'FULLY_RECONCILED') throw new TypeError('card confirmation')
  return { statementId: asRequiredString(record.statementId), paymentId: asRequiredString(record.paymentId), reconciliationStatus: record.reconciliationStatus }
}

function parseVoid(value: unknown): void {
  if (value !== null) throw new TypeError('void')
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
    items: record.items.map((item) => {
      const row = asRecord(item)
      if (typeof row.id !== 'string' || typeof row.occurredOn !== 'string' || typeof row.transactionType !== 'string' || typeof row.status !== 'string') throw new TypeError('transaction')
      return {
        id: row.id,
        occurredOn: row.occurredOn,
        postedOn: asNullableString(row.postedOn),
        transactionType: row.transactionType,
        payee: asNullableString(row.payee),
        description: asNullableString(row.description),
        amountJpy: asSafeSignedInteger(row.amountJpy),
        status: row.status,
      }
    }),
    page: asSafeInteger(record.page),
    pageSize: asSafeInteger(record.pageSize),
    totalItems: asSafeInteger(record.totalItems),
    totalPages: asSafeInteger(record.totalPages),
  }
}

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
