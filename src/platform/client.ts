import { invoke as tauriInvoke } from '@tauri-apps/api/core'

import type {
  AppBootstrapDto,
  AppCommand,
  AppHealthDto,
  AppStatusDto,
  AccountDto,
  CommitSummaryDto,
  DashboardMonthlyTotalsDto,
  DatabaseStatusDto,
  HouseholdDto,
  ImportPreviewDto,
  ImportRunCountsDto,
  ImportSummaryDto,
  Invoke,
  PlatformClient,
  PreviewCandidateDto,
  TransactionPageDto,
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
      queryTransactions: async (request) => ({ items: [], page: request.page, pageSize: request.pageSize, totalItems: 0, totalPages: 0 }),
      queryDashboard: async (request) => ({ month: request.month, accountingBasis: request.accountingBasis, incomeJpy: 0, expenseJpy: 0, savingsJpy: 0, postedTransactionCount: 0 }),
      importSummary: async () => ({ totalRuns: 0, discovered: 0, extracting: 0, reviewRequired: 0, posted: 0, failed: 0, rolledBack: 0, sourceDocuments: 0, sourceRecords: 0, pendingCandidates: 0, readyCandidates: 0 }),
      startImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'import_start') },
      previewImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'import_preview') },
      commitImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'import_commit') },
      rollbackImport: async () => { throw new PlatformIpcError('COMMAND_FAILED', 'import_rollback') },
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
    queryTransactions: (request) => invokeValidated(invoke, 'transactions_query', parseTransactionPage, { request }),
    queryDashboard: (request) => invokeValidated(invoke, 'dashboard_query', parseDashboard, { request }),
    importSummary: (householdId) => invokeValidated(invoke, 'import_summary', parseImportSummary, { householdId }),
    startImport: (request, fileBytes) => invokeValidated(invoke, 'import_start', parseImportSummaryDto, { request: { import: request, fileBytes: Array.from(fileBytes) } }),
    previewImport: (runId) => invokeValidated(invoke, 'import_preview', parseImportPreview, { runId }),
    commitImport: (runId, decisions) => invokeValidated(invoke, 'import_commit', parseCommitSummary, { runId, decisions }),
    rollbackImport: async (runId) => { await invokeValidated(invoke, 'import_rollback', parseVoid, { runId }) },
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
  return value.map((item) => {
    const record = asRecord(item)
    if (typeof record.id !== 'string' || typeof record.name !== 'string' || typeof record.accountKind !== 'string' || typeof record.accountSubtype !== 'string' || record.currency !== 'JPY') throw new TypeError('account')
    return record as unknown as AccountDto
  })
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
    candidates: record.candidates as unknown as PreviewCandidateDto[],
  }
}

function parseCommitSummary(value: unknown): CommitSummaryDto {
  const record = asRecord(value)
  if (typeof record.runId !== 'string') throw new TypeError('commit summary')
  return { runId: record.runId, postedCount: asSafeInteger(record.postedCount) }
}

function parseVoid(value: unknown): void {
  if (value !== null) throw new TypeError('void')
}

function parseDashboard(value: unknown): DashboardMonthlyTotalsDto {
  const record = asRecord(value)
  if (typeof record.month !== 'string' || (record.accountingBasis !== 'ACCRUAL' && record.accountingBasis !== 'CASH')) throw new TypeError('dashboard')
  return {
    month: record.month,
    accountingBasis: record.accountingBasis,
    incomeJpy: asSafeSignedInteger(record.incomeJpy),
    expenseJpy: asSafeSignedInteger(record.expenseJpy),
    savingsJpy: asSafeSignedInteger(record.savingsJpy),
    postedTransactionCount: asSafeInteger(record.postedTransactionCount),
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

export const platformClient = createPlatformClient()
