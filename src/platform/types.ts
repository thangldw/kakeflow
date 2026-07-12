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

export type HouseholdMemberStatusDto = 'ACTIVE' | 'ARCHIVED'
export interface HouseholdMemberDto {
  readonly id: string
  readonly householdId: string
  readonly displayName: string
  readonly relationshipLabel: string | null
  readonly status: HouseholdMemberStatusDto
  readonly sortOrder: number
  readonly createdAt: string
  readonly updatedAt: string
}
export interface CreateHouseholdMemberInputDto {
  readonly id: string
  readonly householdId: string
  readonly displayName: string
  readonly relationshipLabel: string | null
}
export interface UpdateHouseholdMemberInputDto {
  readonly householdId: string
  readonly memberId: string
  readonly displayName: string
  readonly relationshipLabel: string | null
  readonly sortOrder: number
}

export type AccountOwnershipKindDto = 'HOUSEHOLD' | 'MEMBER'
export type AccountVisibilityDto = 'SHARED' | 'PERSONAL'
export type AudienceVisibilityDto = AccountVisibilityDto
export type AttributionKindDto = 'HOUSEHOLD' | 'MEMBER'
export type AttributionScopeDto =
  | { readonly kind: 'ALL' }
  | { readonly kind: 'HOUSEHOLD_COMMON' }
  | { readonly kind: 'MEMBER'; readonly memberId: string }
export interface AccountDto {
  readonly id: string
  readonly name: string
  readonly accountKind: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'
  readonly accountSubtype: 'BANK' | 'CASH' | 'WALLET' | 'SECURITIES' | 'CREDIT_CARD' | 'RECEIVABLE' | 'OTHER'
  readonly currency: 'JPY'
  readonly ownershipKind: AccountOwnershipKindDto
  readonly ownerMemberId: string | null
  readonly ownerMemberName: string | null
  readonly visibility: AccountVisibilityDto
}
export interface CreateAccountInputDto { readonly id: string; readonly householdId: string; readonly name: string; readonly accountKind: AccountDto['accountKind']; readonly accountSubtype: AccountDto['accountSubtype']; readonly currency: 'JPY'; readonly ownershipKind: AccountOwnershipKindDto; readonly ownerMemberId: string | null; readonly visibility: AccountVisibilityDto }
export interface RenameAccountInputDto { readonly householdId: string; readonly accountId: string; readonly name: string }
export interface ArchiveAccountInputDto { readonly householdId: string; readonly accountId: string }
export interface UpdateAccountOwnershipInputDto { readonly householdId: string; readonly accountId: string; readonly ownershipKind: AccountOwnershipKindDto; readonly ownerMemberId: string | null; readonly visibility: AccountVisibilityDto }

export interface ImportSourceRecordDto { readonly id: string; readonly rowNumber: number; readonly recordHash: string; readonly payloadJson: string }
export interface ImportEvidenceDto { readonly sourceRecordId: string; readonly role: 'PRIMARY' | 'FUNDING_LEG' | 'REWARD_LEG' | 'CONTINUATION' | 'SUPPORTING' }
export interface NormalizedCandidateDto {
  readonly id: string; readonly accountId: string | null; readonly occurredOn: string; readonly postedOn: string | null
  readonly amountJpy: number; readonly direction: 'IN' | 'OUT'; readonly descriptionRaw: string | null
  readonly merchantRaw: string | null; readonly externalTransactionId: string | null
  readonly extractionConfidenceBps: number | null; readonly normalizationConfidenceBps: number | null
  readonly attributionKind: AttributionKindDto; readonly attributedMemberId: string | null
  readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null
  readonly reviewStatus: 'PENDING' | 'READY' | 'DUPLICATE' | 'EXCLUDED'; readonly evidence: readonly ImportEvidenceDto[]
}
export interface StartImportDto {
  readonly runId: string; readonly documentId: string; readonly householdId: string
  readonly sourceType: 'LOCAL_FOLDER' | 'MANUAL_UPLOAD' | 'CAMERA_SCAN' | 'OTHER'
  readonly originalFilename: string; readonly mediaType: string; readonly byteSize: number; readonly sha256: string
  readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null
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
  readonly source: { readonly sourceType: string; readonly originalFilename: string; readonly mediaType: string; readonly byteSize: number; readonly sha256: string; readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null }
  readonly candidates: readonly PreviewCandidateDto[]
}
export interface JournalEntryDecisionDto { readonly id: string; readonly accountId: string; readonly side: 'DEBIT' | 'CREDIT'; readonly amountJpy: number }
export interface PostingDecisionDto {
  readonly candidateId: string; readonly transactionId: string; readonly transactionType: string
  readonly payee: string | null; readonly description: string | null; readonly entries: readonly JournalEntryDecisionDto[]
  readonly attributionKind: AttributionKindDto; readonly attributedMemberId: string | null
  readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null
}
export interface CommitSummaryDto { readonly runId: string; readonly postedCount: number }
export interface BackupSummaryDto { readonly formatVersion: 2; readonly entryCount: number; readonly plaintextBytes: number }
export interface ExtractedRegionDto {
  readonly pageNumber: number
  readonly coordinateSpace: 'PIXELS' | 'PDF_POINTS' | 'UNLOCATED'
  readonly boundingBox: { readonly left: number; readonly top: number; readonly width: number; readonly height: number } | null
  readonly text: string
  readonly confidenceBps: number
  readonly provenance: 'PDF_EMBEDDED_TEXT' | 'TESSERACT_WORD' | string
}
export interface ExtractedDocumentDto {
  readonly method: 'EMBEDDED_TEXT' | 'OCR'
  readonly text: string
  readonly confidenceBps: number
  readonly issues: readonly string[]
  /** Optional while reading source payloads produced before the v0.5 evidence contract. */
  readonly regions?: readonly ExtractedRegionDto[]
}
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
  readonly accountGroupId?: string | null
  readonly attributionScope: AttributionScopeDto
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
  readonly accountGroupId?: string | null
  readonly attributionScope: AttributionScopeDto
  readonly accountingBasis: AccountingBasisDto
  readonly fromDate?: string | null
  readonly toDate?: string | null
  readonly search?: string | null
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
  readonly debitAccountId: string | null
  readonly debitAccountName: string | null
  readonly creditAccountId: string | null
  readonly creditAccountName: string | null
  readonly categoryAccountId: string | null
  readonly categoryName: string | null
  readonly attributionKind: AttributionKindDto
  readonly attributedMemberId: string | null
  readonly attributedMemberName: string | null
  readonly audienceVisibility: AudienceVisibilityDto
  readonly audienceMemberId: string | null
  readonly audienceMemberName: string | null
}

export type ManualTransactionTypeDto = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'CARD_PURCHASE' | 'CARD_PAYMENT' | 'REFUND' | 'FEE' | 'INTEREST' | 'ADJUSTMENT'
export interface ManualJournalEntryInputDto { readonly id: string; readonly accountId: string; readonly side: 'DEBIT' | 'CREDIT'; readonly amountJpy: number }
export interface CreateManualTransactionInputDto {
  readonly id: string; readonly householdId: string; readonly occurredOn: string; readonly postedOn: string | null
  readonly transactionType: ManualTransactionTypeDto; readonly payee: string | null; readonly description: string | null
  readonly attributionKind: AttributionKindDto; readonly attributedMemberId: string | null
  readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null
  readonly entries: readonly ManualJournalEntryInputDto[]
}
export interface TransactionJournalEntryDto { readonly id: string; readonly accountId: string; readonly accountName: string; readonly accountKind: string; readonly side: 'DEBIT' | 'CREDIT'; readonly amountJpy: number; readonly lineNumber: number }
export interface TransactionSourceEvidenceDto { readonly sourceRecordId: string; readonly sourceDocumentId: string; readonly sourceType: string; readonly originalFilename: string; readonly mediaType: string; readonly rowNumber: number; readonly importedAt: string; readonly evidenceRole: string; readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null; readonly audienceMemberName: string | null }
export interface TransactionDetailDto {
  readonly id: string; readonly householdId: string; readonly occurredOn: string; readonly postedOn: string | null
  readonly transactionType: ManualTransactionTypeDto; readonly payee: string | null; readonly description: string | null
  readonly attributionKind: AttributionKindDto; readonly attributedMemberId: string | null; readonly attributedMemberName: string | null
  readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null; readonly audienceMemberName: string | null
  readonly status: string; readonly createdAt: string; readonly updatedAt: string; readonly editable: boolean
  readonly entries: readonly TransactionJournalEntryDto[]; readonly sourceEvidence: readonly TransactionSourceEvidenceDto[]
}
export interface UpdatePostedTransactionInputDto extends Omit<CreateManualTransactionInputDto, 'id'> { readonly transactionId: string }
export interface SourceDocumentViewDto {
  readonly id: string; readonly householdId: string; readonly importRunId: string; readonly sourceType: string
  readonly originalFilename: string; readonly mediaType: string; readonly byteSize: number; readonly sha256: string
  readonly sourceModifiedAt: string | null; readonly importedAt: string; readonly adapterId: string | null
  readonly adapterVersion: string | null; readonly recordCount: number
  readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null; readonly audienceMemberName: string | null
}
export interface UpdateSourceDocumentAudienceInputDto { readonly householdId: string; readonly sourceDocumentId: string; readonly audienceVisibility: AudienceVisibilityDto; readonly audienceMemberId: string | null }
export interface SourceRecordViewDto {
  readonly id: string; readonly sourceDocumentId: string; readonly rowNumber: number; readonly recordHash: string
  readonly payloadJson: string; readonly createdAt: string; readonly evidenceRole: string | null
}
export interface SourceRecordPageRequestDto { readonly householdId: string; readonly sourceDocumentId: string; readonly page: number; readonly pageSize: number }
export interface SourceRecordPageDto {
  readonly items: readonly SourceRecordViewDto[]; readonly page: number; readonly pageSize: number
  readonly totalItems: number; readonly totalPages: number
}
export interface WatchedFolderDto { readonly id: string; readonly householdId: string; readonly label: string; readonly displayName: string; readonly isEnabled: boolean; readonly createdAt: string }
export interface WatchedFileMetadataDto { readonly relativePath: string; readonly fileName: string; readonly mediaType: string; readonly byteSize: number; readonly modifiedUnixMs: number | null }
export interface WatchedFolderScanDto { readonly watchedFolderId: string; readonly files: readonly WatchedFileMetadataDto[] }
export interface WatchedFileDto extends WatchedFileMetadataDto { readonly fileBytes: readonly number[] }

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

export interface MonthlyCategoryBudgetDto { readonly householdId: string; readonly month: string; readonly categoryAccountId: string; readonly categoryName: string; readonly budgetJpy: number; readonly actualJpy: number; readonly remainingJpy: number }
export interface UpsertMonthlyCategoryBudgetInputDto { readonly householdId: string; readonly month: string; readonly categoryAccountId: string; readonly budgetJpy: number }
export type SavingsGoalStatusDto = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'
export interface SavingsGoalDto { readonly id: string; readonly householdId: string; readonly name: string; readonly targetJpy: number; readonly savedJpy: number; readonly targetDate: string; readonly status: SavingsGoalStatusDto; readonly createdAt: string; readonly updatedAt: string }
export interface CreateSavingsGoalInputDto { readonly id: string; readonly householdId: string; readonly name: string; readonly targetJpy: number; readonly savedJpy: number; readonly targetDate: string; readonly status: SavingsGoalStatusDto }
export type UpdateSavingsGoalInputDto = CreateSavingsGoalInputDto

export interface ClassificationRuleDto {
  readonly id: string; readonly householdId: string; readonly name: string; readonly priority: number; readonly isEnabled: boolean
  readonly merchantContains: string | null; readonly descriptionContains: string | null
  readonly categoryAccountId: string; readonly categoryName: string; readonly labels: readonly string[]; readonly tags: readonly string[]
  readonly createdAt: string; readonly updatedAt: string
}
export interface CreateClassificationRuleInputDto {
  readonly id: string; readonly householdId: string; readonly name: string; readonly priority: number; readonly isEnabled: boolean
  readonly merchantContains: string | null; readonly descriptionContains: string | null; readonly categoryAccountId: string
  readonly labels: readonly string[]; readonly tags: readonly string[]
}
export type UpdateClassificationRuleInputDto = CreateClassificationRuleInputDto
export interface ClassificationPreviewInputDto { readonly householdId: string; readonly merchant: string | null; readonly description: string | null }
export interface ClassificationPreviewDto { readonly winningRuleId: string | null; readonly matches: readonly ClassificationRuleDto[] }
export interface ApplyClassificationRuleInputDto {
  readonly householdId: string; readonly transactionId: string; readonly ruleId: string; readonly expectedTransactionUpdatedAt: string
}
export interface AppliedClassificationDto {
  readonly transactionId: string; readonly ruleId: string; readonly categoryAccountId: string; readonly categoryName: string
  readonly labels: readonly string[]; readonly tags: readonly string[]; readonly transactionUpdatedAt: string
}

export type AppCommand =
  | 'app_bootstrap'
  | 'app_health'
  | 'app_status'
  | 'households_list'
  | 'household_create'
  | 'household_members_list'
  | 'household_member_create'
  | 'household_member_update'
  | 'household_member_archive'
  | 'accounts_list'
  | 'account_create'
  | 'account_rename'
  | 'account_archive'
  | 'account_ownership_update'
  | 'transactions_query'
  | 'transaction_manual_create'
  | 'transaction_detail_get'
  | 'transaction_update'
  | 'source_document_get'
  | 'source_document_audience_update'
  | 'source_document_records_query'
  | 'transaction_source_records_list'
  | 'watched_folders_list'
  | 'watched_folder_select'
  | 'watched_folder_remove'
  | 'watched_folder_scan'
  | 'watched_folder_file_read'
  | 'dashboard_query'
  | 'budgets_query'
  | 'budget_upsert'
  | 'savings_goals_list'
  | 'savings_goal_create'
  | 'savings_goal_update'
  | 'savings_goal_delete'
  | 'classification_rules_list'
  | 'classification_rule_create'
  | 'classification_rule_update'
  | 'classification_rule_delete'
  | 'classification_rules_preview'
  | 'classification_rule_apply'
  | 'import_summary'
  | 'import_start'
  | 'import_preview'
  | 'import_commit'
  | 'import_rollback'
  | 'backup_create'
  | 'backup_restore_stage'
  | 'app_restart_for_restore'
  | 'document_extract'
  | 'document_ocr'
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
  listHouseholdMembers(householdId: string): Promise<readonly HouseholdMemberDto[]>
  createHouseholdMember(input: CreateHouseholdMemberInputDto): Promise<HouseholdMemberDto>
  updateHouseholdMember(input: UpdateHouseholdMemberInputDto): Promise<HouseholdMemberDto>
  archiveHouseholdMember(householdId: string, memberId: string): Promise<void>
  listAccounts(householdId: string): Promise<readonly AccountDto[]>
  createAccount(input: CreateAccountInputDto): Promise<AccountDto>
  renameAccount(input: RenameAccountInputDto): Promise<AccountDto>
  archiveAccount(input: ArchiveAccountInputDto): Promise<void>
  updateAccountOwnership(input: UpdateAccountOwnershipInputDto): Promise<AccountDto>
  queryTransactions(request: TransactionPageRequestDto): Promise<TransactionPageDto>
  createManualTransaction(input: CreateManualTransactionInputDto): Promise<TransactionRowDto>
  getTransactionDetail(householdId: string, transactionId: string): Promise<TransactionDetailDto>
  updateTransaction(input: UpdatePostedTransactionInputDto): Promise<TransactionDetailDto>
  getSourceDocument(householdId: string, sourceDocumentId: string): Promise<SourceDocumentViewDto>
  updateSourceDocumentAudience(input: UpdateSourceDocumentAudienceInputDto): Promise<SourceDocumentViewDto>
  querySourceDocumentRecords(request: SourceRecordPageRequestDto): Promise<SourceRecordPageDto>
  listTransactionSourceRecords(householdId: string, transactionId: string): Promise<readonly SourceRecordViewDto[]>
  listWatchedFolders(householdId: string): Promise<readonly WatchedFolderDto[]>
  selectWatchedFolder(householdId: string, label: string): Promise<WatchedFolderDto | null>
  removeWatchedFolder(householdId: string, watchedFolderId: string): Promise<void>
  scanWatchedFolder(householdId: string, watchedFolderId: string): Promise<WatchedFolderScanDto>
  readWatchedFile(householdId: string, watchedFolderId: string, relativePath: string): Promise<WatchedFileDto>
  queryDashboard(request: DashboardRequestDto): Promise<DashboardMonthlyTotalsDto>
  listBudgets(householdId: string, month: string): Promise<readonly MonthlyCategoryBudgetDto[]>
  upsertBudget(input: UpsertMonthlyCategoryBudgetInputDto): Promise<MonthlyCategoryBudgetDto>
  listSavingsGoals(householdId: string): Promise<readonly SavingsGoalDto[]>
  createSavingsGoal(input: CreateSavingsGoalInputDto): Promise<SavingsGoalDto>
  updateSavingsGoal(input: UpdateSavingsGoalInputDto): Promise<SavingsGoalDto>
  deleteSavingsGoal(householdId: string, goalId: string): Promise<void>
  listClassificationRules(householdId: string): Promise<readonly ClassificationRuleDto[]>
  createClassificationRule(input: CreateClassificationRuleInputDto): Promise<ClassificationRuleDto>
  updateClassificationRule(input: UpdateClassificationRuleInputDto): Promise<ClassificationRuleDto>
  deleteClassificationRule(householdId: string, ruleId: string): Promise<void>
  previewClassificationRules(input: ClassificationPreviewInputDto): Promise<ClassificationPreviewDto>
  applyClassificationRule(input: ApplyClassificationRuleInputDto): Promise<AppliedClassificationDto>
  importSummary(householdId: string): Promise<ImportRunCountsDto>
  startImport(request: StartImportDto, fileBytes: Uint8Array): Promise<ImportSummaryDto>
  previewImport(runId: string): Promise<ImportPreviewDto>
  commitImport(runId: string, decisions: readonly PostingDecisionDto[]): Promise<CommitSummaryDto>
  rollbackImport(runId: string): Promise<void>
  createBackup(passphrase: string): Promise<BackupSummaryDto | null>
  stageBackupRestore(passphrase: string): Promise<BackupSummaryDto | null>
  restartForRestore(): Promise<void>
  extractDocument(fileBytes: Uint8Array, mediaType: string): Promise<ExtractedDocumentDto>
  ocrDocument(fileBytes: Uint8Array, mediaType: string): Promise<ExtractedDocumentDto>
  listCardSettlements(householdId: string): Promise<readonly CardSettlementDto[]>
  confirmCardMatch(householdId: string, statementId: string, paymentId: string): Promise<CardMatchConfirmationDto>
}
