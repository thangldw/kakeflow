export interface DatabaseStatusDto {
  readonly healthy: boolean
  readonly schemaVersion: number
}

export interface AppBootstrapDto {
  readonly application: string
  readonly database: DatabaseStatusDto
}

export interface AppHealthDto {
  readonly status: 'ok' | 'degraded'
  readonly database: DatabaseStatusDto
}

export interface AppStatusDto {
  readonly schemaVersion: number
  readonly integrity: 'ok' | 'failed'
}

export interface HouseholdDto {
  readonly id: string
  readonly name: string
  readonly baseCurrency: 'JPY'
  readonly createdAt: string
}

export interface CreateHouseholdInputDto {
  readonly id: string
  readonly name: string
}

export interface AccountDto {
  readonly id: string
  readonly name: string
  readonly accountKind: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'
  readonly accountSubtype: 'BANK' | 'CASH' | 'WALLET' | 'SECURITIES' | 'CREDIT_CARD' | 'RECEIVABLE' | 'OTHER'
  readonly currency: 'JPY'
}

export interface ImportSourceRecordDto { readonly id: string; readonly rowNumber: number; readonly recordHash: string; readonly payloadJson: string }
export interface ImportEvidenceDto { readonly sourceRecordId: string; readonly role: 'PRIMARY' | 'FUNDING_LEG' | 'REWARD_LEG' | 'CONTINUATION' | 'SUPPORTING' }
export interface NormalizedCandidateDto {
  readonly id: string; readonly accountId: string | null; readonly occurredOn: string; readonly postedOn: string | null
  readonly amountJpy: number; readonly direction: 'IN' | 'OUT'; readonly descriptionRaw: string | null
  readonly merchantRaw: string | null; readonly externalTransactionId: string | null
  readonly extractionConfidenceBps: number | null; readonly normalizationConfidenceBps: number | null
  readonly reviewStatus: 'PENDING' | 'READY' | 'DUPLICATE' | 'EXCLUDED'; readonly evidence: readonly ImportEvidenceDto[]
}
export interface StartImportDto {
  readonly runId: string; readonly documentId: string; readonly householdId: string
  readonly sourceType: 'LOCAL_FOLDER' | 'MANUAL_UPLOAD' | 'CAMERA_SCAN' | 'OTHER'
  readonly originalFilename: string; readonly mediaType: string; readonly byteSize: number; readonly sha256: string
  readonly sourceModifiedAt: string | null; readonly adapterId: string | null; readonly adapterVersion: string | null
  readonly records: readonly ImportSourceRecordDto[]; readonly candidates: readonly NormalizedCandidateDto[]
  readonly cardStatements: readonly StartImportCardStatementDto[]
}
export interface StartImportCardStatementDto {
  readonly id: string; readonly cardAccountId: string; readonly issuer: string
  readonly periodStart: string; readonly periodEnd: string; readonly paymentDueOn: string | null
  readonly statementAmountJpy: number
  readonly lines: readonly { readonly candidateId: string; readonly statementLineNumber: number; readonly billedAmountJpy: number }[]
}
export interface ImportSummaryDto { readonly runId: string; readonly documentId: string; readonly status: string; readonly recordCount: number; readonly candidateCount: number; readonly reusedExisting: boolean }
export interface PreviewCandidateDto extends Omit<NormalizedCandidateDto, 'evidence'> { readonly evidenceCount: number; readonly evidenceRoles: readonly string[]; readonly issues: readonly string[] }
export interface ImportPreviewDto {
  readonly summary: ImportSummaryDto
  readonly source: { readonly sourceType: string; readonly originalFilename: string; readonly mediaType: string; readonly byteSize: number; readonly sha256: string }
  readonly candidates: readonly PreviewCandidateDto[]
}
export interface JournalEntryDecisionDto { readonly id: string; readonly accountId: string; readonly side: 'DEBIT' | 'CREDIT'; readonly amountJpy: number }
export interface PostingDecisionDto {
  readonly candidateId: string; readonly transactionId: string; readonly transactionType: string
  readonly payee: string | null; readonly description: string | null; readonly entries: readonly JournalEntryDecisionDto[]
}
export interface CommitSummaryDto { readonly runId: string; readonly postedCount: number }
export interface BackupSummaryDto { readonly entryCount: number; readonly plaintextBytes: number }
export interface ExtractedDocumentDto { readonly method: 'EMBEDDED_TEXT' | 'OCR'; readonly text: string; readonly confidenceBps: number; readonly issues: readonly string[] }
export type CardReconciliationStatusDto = 'UNMATCHED' | 'POSSIBLE_MATCH' | 'FULLY_RECONCILED' | 'PARTIALLY_RECONCILED' | 'OVERPAID' | 'UNDERPAID' | 'MANUAL_OVERRIDE'
export interface CardSettlementDto {
  readonly id: string; readonly cardAccountId: string; readonly cardName: string; readonly maskedIdentifier: string | null
  readonly periodStart: string; readonly periodEnd: string; readonly paymentDueOn: string | null
  readonly statementAmountJpy: number; readonly detailAmountJpy: number; readonly lineCount: number
  readonly paymentId: string | null; readonly bankTransactionId: string | null; readonly paymentAmountJpy: number | null
  readonly paymentOn: string | null; readonly matchScoreBps: number | null; readonly reconciliationStatus: CardReconciliationStatusDto
}
export interface CardMatchConfirmationDto { readonly statementId: string; readonly paymentId: string; readonly reconciliationStatus: 'FULLY_RECONCILED' }

export type AccountingBasisDto = 'ACCRUAL' | 'CASH'

export interface DashboardRequestDto {
  readonly householdId: string
  readonly month: string
  readonly accountingBasis: AccountingBasisDto
}

export interface DashboardMonthlyTotalsDto {
  readonly month: string
  readonly accountingBasis: AccountingBasisDto
  readonly incomeJpy: number
  readonly expenseJpy: number
  readonly savingsJpy: number
  readonly postedTransactionCount: number
  readonly netWorthAsOf: string
  readonly assetsJpy: number
  readonly liabilitiesJpy: number
  readonly netWorthJpy: number
  readonly accrualTrend: readonly DashboardAccrualTrendPointDto[]
  readonly expenseCategories: readonly DashboardExpenseCategoryDto[]
}

export interface DashboardAccrualTrendPointDto {
  readonly month: string
  readonly incomeJpy: number
  readonly expenseJpy: number
}

export interface DashboardExpenseCategoryDto {
  readonly accountId: string
  readonly name: string
  readonly amountJpy: number
}

export interface TransactionPageRequestDto {
  readonly householdId: string
  readonly accountingBasis: AccountingBasisDto
  readonly fromDate?: string | null
  readonly toDate?: string | null
  readonly page: number
  readonly pageSize: number
}

export interface TransactionRowDto {
  readonly id: string
  readonly occurredOn: string
  readonly postedOn: string | null
  readonly transactionType: string
  readonly payee: string | null
  readonly description: string | null
  readonly amountJpy: number
  readonly status: string
}

export interface TransactionPageDto {
  readonly items: readonly TransactionRowDto[]
  readonly page: number
  readonly pageSize: number
  readonly totalItems: number
  readonly totalPages: number
}

export interface ImportRunCountsDto {
  readonly totalRuns: number
  readonly discovered: number
  readonly extracting: number
  readonly reviewRequired: number
  readonly posted: number
  readonly failed: number
  readonly rolledBack: number
  readonly sourceDocuments: number
  readonly sourceRecords: number
  readonly pendingCandidates: number
  readonly readyCandidates: number
}

export type AppCommand =
  | 'app_bootstrap'
  | 'app_health'
  | 'app_status'
  | 'households_list'
  | 'household_create'
  | 'accounts_list'
  | 'transactions_query'
  | 'dashboard_query'
  | 'import_summary'
  | 'import_start'
  | 'import_preview'
  | 'import_commit'
  | 'import_rollback'
  | 'backup_create'
  | 'document_extract'
  | 'cards_list'
  | 'card_match_confirm'

export type Invoke = <T>(command: AppCommand, args?: Record<string, unknown>) => Promise<T>

export interface PlatformClient {
  readonly runtime: 'tauri' | 'web'
  bootstrap(): Promise<AppBootstrapDto>
  health(): Promise<AppHealthDto>
  status(): Promise<AppStatusDto>
  listHouseholds(): Promise<readonly HouseholdDto[]>
  createHousehold(input: CreateHouseholdInputDto): Promise<HouseholdDto>
  listAccounts(householdId: string): Promise<readonly AccountDto[]>
  queryTransactions(request: TransactionPageRequestDto): Promise<TransactionPageDto>
  queryDashboard(request: DashboardRequestDto): Promise<DashboardMonthlyTotalsDto>
  importSummary(householdId: string): Promise<ImportRunCountsDto>
  startImport(request: StartImportDto, fileBytes: Uint8Array): Promise<ImportSummaryDto>
  previewImport(runId: string): Promise<ImportPreviewDto>
  commitImport(runId: string, decisions: readonly PostingDecisionDto[]): Promise<CommitSummaryDto>
  rollbackImport(runId: string): Promise<void>
  createBackup(archivePath: string, passphrase: string): Promise<BackupSummaryDto>
  extractDocument(fileBytes: Uint8Array, mediaType: string): Promise<ExtractedDocumentDto>
  listCardSettlements(householdId: string): Promise<readonly CardSettlementDto[]>
  confirmCardMatch(householdId: string, statementId: string, paymentId: string): Promise<CardMatchConfirmationDto>
}
