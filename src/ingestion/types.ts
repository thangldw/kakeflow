export type AdapterId =
  | 'japanese-bank-ledger-v1'
  | 'paypay-history-v1'
  | 'amazon-mastercard-statement-v1'
  | 'rakuten-enavi-v1'

export type ParseIssueSeverity = 'warning' | 'error'

export interface ParseIssue {
  code: string
  message: string
  severity: ParseIssueSeverity
  row?: number
  column?: string
}

export interface SourceLineage {
  sourceRow: number
  sourceRowEnd: number
  rawFields: readonly string[]
}

export interface ImportInput {
  /** Text must already be decoded. Use decodeCsvBytes when starting with bytes. */
  text: string
  filename?: string
  accountHint?: string
}

export interface DetectionResult {
  adapterId: AdapterId
  score: number
  reasons: readonly string[]
}

export interface ParsedImport<T> {
  adapterId: AdapterId
  records: readonly T[]
  issues: readonly ParseIssue[]
  metadata: Readonly<Record<string, unknown>>
}

export interface ImportAdapter<T> {
  readonly id: AdapterId
  detect(input: ImportInput): DetectionResult
  parse(input: ImportInput): ParsedImport<T>
}

export interface BankTransactionCandidate {
  kind: 'bank-transaction'
  lineage: SourceLineage
  accountHint?: string
  transactionDate: string | null
  description: string
  descriptionDetail: string
  outgoingAmount: number | null
  incomingAmount: number | null
  balance: number | null
  memo: string
  fundsAvailabilityCode: string
  debitCreditCode: string
  suggestedType: 'CARD_PAYMENT' | 'TRANSFER' | 'UNKNOWN'
}

export interface WalletFundingLegCandidate {
  method: string
  amount: number
  currency: 'JPY'
}

export interface WalletEventLegCandidate {
  lineage: SourceLineage
  transactionType: string
  outgoingAmount: number | null
  incomingAmount: number | null
  paymentOption: string
  funding: readonly WalletFundingLegCandidate[]
}

export interface WalletEventCandidate {
  kind: 'wallet-event'
  transactionId: string
  occurredAt: string | null
  counterparty: string
  eventType: string
  legs: readonly WalletEventLegCandidate[]
  totalOutgoing: number
  totalIncoming: number
}

export interface CardTransactionCandidate {
  kind: 'card-transaction'
  lineage: SourceLineage
  usageDate: string | null
  merchant: string
  userName: string
  paymentMethod: string
  billingAmount: number | null
  feeOrInterest: number | null
  originalAmount?: number
  originalCurrency?: string
  exchangeRate?: number
  isRefund: boolean
  rawExtra: Readonly<Record<string, string>>
}

export interface CardStatementCandidate {
  kind: 'card-statement'
  issuer: 'AMAZON_MASTERCARD' | 'RAKUTEN_CARD'
  holderName?: string
  maskedCardNumber?: string
  productName?: string
  statementMonth?: string
  statementTotal: number | null
  transactions: readonly CardTransactionCandidate[]
}
