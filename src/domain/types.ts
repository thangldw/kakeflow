/** Canonical, persistence-agnostic types for KakeFlow's household ledger. */

export type EntityId = string
export type IsoDate = string
export type IsoDateTime = string
export type Currency = 'JPY'

/**
 * JPY has no fractional minor unit. Amounts are always integers and are never
 * floating-point values. Use `jpy` at input boundaries to enforce that rule.
 */
export type JpyAmount = number & { readonly __brand: 'JpyAmount' }

export function jpy(value: number): JpyAmount {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`JPY amount must be a safe integer, received ${value}`)
  }
  return value as JpyAmount
}

export type AccountKind = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'
export type AccountSubtype =
  | 'BANK'
  | 'CASH'
  | 'WALLET'
  | 'SECURITIES'
  | 'CREDIT_CARD'
  | 'RECEIVABLE'
  | 'OTHER'

export interface Account {
  id: EntityId
  householdId: EntityId
  name: string
  kind: AccountKind
  subtype: AccountSubtype
  currency: Currency
  institutionId?: EntityId
  maskedNumber?: string
  archivedAt?: IsoDateTime
}

export type SourceType =
  | 'MANUAL_UPLOAD'
  | 'WATCHED_FOLDER'
  | 'GOOGLE_DRIVE'
  | 'ICLOUD_PICKER'
  | 'CAMERA_SCAN'
  | 'EMAIL_ATTACHMENT'
  | 'MOBILE_SHARE'

export type SourceDocumentStatus =
  | 'DISCOVERED'
  | 'DOWNLOADED'
  | 'EXTRACTING'
  | 'EXTRACTED'
  | 'NORMALIZED'
  | 'MATCHED'
  | 'REVIEW_REQUIRED'
  | 'POSTED'
  | 'FAILED'

export interface SourceDocument {
  id: EntityId
  householdId: EntityId
  sourceType: SourceType
  provider?: string
  originalFilename: string
  mimeType: string
  sizeBytes: number
  sha256: string
  storageUri: string
  importedAt: IsoDateTime
  sourceModifiedAt?: IsoDateTime
  parserVersion?: string
  status: SourceDocumentStatus
  previousVersionId?: EntityId
}

/** Immutable row, page region, or OCR block from an original document. */
export interface SourceRecord {
  id: EntityId
  sourceDocumentId: EntityId
  ordinal: number
  raw: Readonly<Record<string, unknown>>
  rawText?: string
  pageNumber?: number
  rowHash: string
  extractionConfidence?: number
}

export type MoneyDirection = 'IN' | 'OUT'

export interface TransactionCandidate {
  id: EntityId
  householdId: EntityId
  sourceRecordIds: readonly EntityId[]
  accountHintId?: EntityId
  occurredOn: IsoDate
  postedOn?: IsoDate
  amount: JpyAmount
  direction: MoneyDirection
  descriptionRaw: string
  merchantRaw?: string
  paymentMethodHint?: string
  externalTransactionId?: string
  extractionConfidence: number
  normalizationConfidence: number
}

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

export type TransactionStatus = 'DRAFT' | 'POSTED' | 'VOIDED'

export interface LedgerEntry {
  id: EntityId
  transactionId: EntityId
  accountId: EntityId
  debit: JpyAmount
  credit: JpyAmount
  memo?: string
}

export interface Transaction {
  id: EntityId
  householdId: EntityId
  type: TransactionType
  status: TransactionStatus
  occurredOn: IsoDate
  postedOn?: IsoDate
  description: string
  merchantId?: EntityId
  categoryId?: EntityId
  sourceRecordIds: readonly EntityId[]
  entries: readonly LedgerEntry[]
  createdAt: IsoDateTime
  createdBy: EntityId
}

export interface CardStatement {
  id: EntityId
  householdId: EntityId
  cardAccountId: EntityId
  periodStart: IsoDate
  periodEnd: IsoDate
  dueDate: IsoDate
  amountDue: JpyAmount
  currency: Currency
  issuerName: string
  sourceDocumentId?: EntityId
}

export type CardPaymentReconciliationStatus =
  | 'UNMATCHED'
  | 'POSSIBLE_MATCH'
  | 'FULLY_RECONCILED'
  | 'PARTIALLY_RECONCILED'
  | 'OVERPAID'
  | 'UNDERPAID'
  | 'MANUAL_OVERRIDE'

export interface CardPayment {
  id: EntityId
  householdId: EntityId
  statementId: EntityId
  cardAccountId: EntityId
  bankAccountId: EntityId
  bankTransactionId: EntityId
  paidOn: IsoDate
  amount: JpyAmount
  reconciliationStatus: CardPaymentReconciliationStatus
  score: number
}

export type ImportRunStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'REVIEW_REQUIRED'
  | 'COMMITTED'
  | 'ROLLED_BACK'
  | 'FAILED'

export interface ImportRun {
  id: EntityId
  householdId: EntityId
  sourceDocumentIds: readonly EntityId[]
  adapterId: string
  adapterVersion: string
  startedAt: IsoDateTime
  completedAt?: IsoDateTime
  status: ImportRunStatus
  discoveredCount: number
  candidateCount: number
  committedCount: number
  errorCount: number
}
