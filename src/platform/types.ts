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
  | 'transactions_query'
  | 'dashboard_query'
  | 'import_summary'

export type Invoke = <T>(command: AppCommand, args?: Record<string, unknown>) => Promise<T>

export interface PlatformClient {
  readonly runtime: 'tauri' | 'web'
  bootstrap(): Promise<AppBootstrapDto>
  health(): Promise<AppHealthDto>
  status(): Promise<AppStatusDto>
  listHouseholds(): Promise<readonly HouseholdDto[]>
  createHousehold(input: CreateHouseholdInputDto): Promise<HouseholdDto>
  queryTransactions(request: TransactionPageRequestDto): Promise<TransactionPageDto>
  queryDashboard(request: DashboardRequestDto): Promise<DashboardMonthlyTotalsDto>
  importSummary(householdId: string): Promise<ImportRunCountsDto>
}
