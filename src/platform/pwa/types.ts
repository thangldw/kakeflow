export type AccountKind = 'ASSET' | 'LIABILITY' | 'INCOME' | 'EXPENSE'
export type TransactionType =
  | 'EXPENSE'
  | 'INCOME'
  | 'TRANSFER'
  | 'CARD_PURCHASE'
  | 'CARD_PAYMENT'
  | 'REFUND'
  | 'FEE'
  | 'INTEREST'
  | 'ADJUSTMENT'
export type EntrySide = 'DEBIT' | 'CREDIT'
export type AccountSubtype = 'BANK' | 'CASH' | 'WALLET' | 'CREDIT_CARD' | 'OTHER'
export type SavingsGoalStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED'

export interface Household {
  readonly id: string
  readonly name: string
  readonly baseCurrency: 'JPY'
}

export interface Account {
  readonly id: string
  readonly householdId: string
  readonly name: string
  readonly kind: AccountKind
  readonly currency: 'JPY'
  readonly subtype?: AccountSubtype
}

export interface PostingEntry {
  readonly id: string
  readonly accountId: string
  readonly side: EntrySide
  readonly amountJpy: number
}

export interface ReceiptFieldProvenance {
  readonly field: string
  readonly page: number
  readonly region: readonly [number, number, number, number]
}

export interface SourceRecord {
  readonly id: string
  readonly householdId: string
  readonly originalFilename: string
  readonly mediaType: string
  readonly byteSize: number
  readonly sha256: string
  readonly provenance: readonly ReceiptFieldProvenance[]
}

export interface ReceiptCandidate {
  readonly id: string
  readonly householdId: string
  readonly sourceId: string
  readonly occurredOn: string
  readonly payee: string
  readonly amountJpy: number
  readonly ocrConfidenceBps: number
  readonly status: 'CANDIDATE' | 'POSTED'
  readonly explicitlyApproved: boolean
  readonly transactionId: string | null
}

export interface Transaction {
  readonly id: string
  readonly householdId: string
  readonly candidateId: string
  readonly occurredOn: string
  readonly transactionType: TransactionType
  readonly payee: string
  readonly amountJpy: number
  readonly entries: readonly PostingEntry[]
  readonly canonicalPostingHash: string
}

export interface TransactionProvenance {
  readonly transactionId: string
  readonly manual: boolean
  readonly sourceId: string | null
  readonly candidateId: string | null
}

export interface TransactionDetail extends Transaction {
  readonly provenance: TransactionProvenance
}

export interface SourceEvidence {
  readonly source: SourceRecord
  readonly bytes: Uint8Array
}

export interface DashboardSummary {
  readonly householdId: string
  readonly incomeJpy: number
  readonly expenseJpy: number
  readonly netJpy: number
  readonly transactionCount: number
}

export interface CreateHouseholdInput {
  readonly id: string
  readonly name: string
}

export interface CreateAccountInput {
  readonly id: string
  readonly householdId: string
  readonly name: string
  readonly kind: AccountKind
  readonly subtype?: AccountSubtype
}

export interface ManualTransactionInput {
  readonly id: string
  readonly householdId: string
  readonly occurredOn: string
  readonly transactionType: TransactionType
  readonly payee: string
  readonly amountJpy: number
  readonly entries: readonly PostingEntry[]
}

export interface StageReceiptInput {
  readonly sourceId?: string
  readonly candidateId?: string
  readonly householdId: string
  readonly originalFilename: string
  readonly mediaType: string
  readonly bytes: Uint8Array
  readonly occurredOn: string
  readonly payee: string
  readonly amountJpy: number
  readonly ocrConfidenceBps: number
  readonly provenance: readonly ReceiptFieldProvenance[]
}

export interface ApproveCandidateInput {
  readonly candidateId: string
  readonly transactionId: string
  readonly transactionType: TransactionType
  readonly entries: readonly PostingEntry[]
}

export interface Budget {
  readonly householdId: string
  /** Calendar month `YYYY-MM`. */
  readonly month: string
  readonly categoryAccountId: string
  readonly budgetJpy: number
}

export type UpsertBudgetInput = Budget

export interface MonthlyBudgetRow extends Budget {
  readonly categoryName: string
  readonly actualJpy: number
  /** `budgetJpy - actualJpy`; negative when the month is over budget. */
  readonly remainingJpy: number
}

export interface SavingsGoal {
  readonly id: string
  readonly householdId: string
  readonly name: string
  readonly targetJpy: number
  readonly savedJpy: number
  /** Calendar date `YYYY-MM-DD`. */
  readonly targetDate: string
  readonly status: SavingsGoalStatus
  readonly createdAt: string
  readonly updatedAt: string
}

export interface SaveSavingsGoalInput {
  readonly id: string
  readonly householdId: string
  readonly name: string
  readonly targetJpy: number
  readonly savedJpy: number
  readonly targetDate: string
  readonly status?: SavingsGoal['status']
}

export interface MonthlyExpenseCategory {
  readonly accountId: string
  readonly name: string
  readonly amountJpy: number
}

export interface MonthlyDashboard {
  readonly householdId: string
  readonly month: string
  readonly incomeJpy: number
  readonly expenseJpy: number
  readonly expenseCategories: readonly MonthlyExpenseCategory[]
}
