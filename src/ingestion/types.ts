export type AdapterId =
  | 'mizuho-business-web-statement-v1'
  | 'resona-web-meisai-plus-v1'
  | 'personal-japanese-bank-ledger-v2'
  | 'japanese-bank-ledger-v1'
  | 'mufg-bizstation-all-details-v1'
  | 'mufg-bizstation-deposit-withdrawal-v1'
  | 'yucho-direct-ledger-v1'
  | 'paypay-history-v2'
  | 'paypay-history-v1'
  | 'amazon-mastercard-statement-v1'
  | 'rakuten-enavi-v1'
  | 'jcb-myjcb-statement-v1'
  | 'smbc-vpass-statement-v1'
  | 'aeon-card-finalized-statement-v1'
  | 'paypay-card-finalized-statement-v1'
  | 'securities-asset-snapshot-v1'
  | 'sbi-securities-trade-history-v1'
  | 'rakuten-securities-domestic-trade-history-v1'
  | 'monex-us-stock-trade-history-v1'
  | 'japanese-brokerage-transactions-v1'
  | 'money-forward-me-asset-trend-v1'
  | 'money-forward-me-household-ledger-v1'
  | 'custom-delimited-v1'

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
  /** Named part inside an immutable container source, such as an email attachment. */
  sourcePart?: string
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
  externalTransactionId?: string
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

/** A row from Money Forward ME's documented ten-column household-ledger export. */
export interface MoneyForwardHouseholdTransactionCandidate {
  kind: 'money-forward-household-transaction'
  lineage: SourceLineage
  sourceFields: Readonly<Record<string, string>>
  calculationTarget: boolean
  transactionDate: string | null
  content: string
  signedAmountJpy: number | null
  institution: string
  majorCategory: string
  minorCategory: string
  memo: string
  isTransfer: boolean
  externalTransactionId: string
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
  issuer: 'AMAZON_MASTERCARD' | 'RAKUTEN_CARD' | 'JCB' | 'SMBC_CARD' | 'AEON_CARD' | 'PAYPAY_CARD'
  holderName?: string
  maskedCardNumber?: string
  productName?: string
  statementMonth?: string
  /** Exact source-provided payment date. Adapters must never infer this value. */
  paymentDueOn?: string
  statementTotal: number | null
  transactions: readonly CardTransactionCandidate[]
}

export interface PortfolioAssetClassCandidate {
  lineage: SourceLineage
  name: string
  marketValueJpy: number
  unrealizedPnlJpy: number | null
}

export interface PositionSnapshotCandidate {
  kind: 'position-snapshot'
  lineage: SourceLineage
  productType: string
  accountType: string
  instrumentCode: string
  instrumentName: string
  quantity: number | null
  averageCost: number | null
  marketPrice: number | null
  marketValueJpy: number | null
  unrealizedPnlJpy: number | null
  realizedPnlJpy: number | null
  currency: string
}

export interface FxRateSnapshotCandidate {
  kind: 'fx-rate-snapshot'
  lineage: SourceLineage
  baseCurrency: string
  quoteCurrency: 'JPY'
  rate: number
}

/** A point-in-time brokerage account view. It must never be posted as a transaction. */
export interface PortfolioSnapshotCandidate {
  kind: 'portfolio-snapshot'
  lineage: SourceLineage
  accountHint?: string
  asOf: string | null
  marketValueJpy: number | null
  cashValueJpy: number | null
  unrealizedPnlJpy: number | null
  realizedPnlJpy: number | null
  assetClasses: readonly PortfolioAssetClassCandidate[]
  positions: readonly PositionSnapshotCandidate[]
  fxRates: readonly FxRateSnapshotCandidate[]
}

export type AggregateAssetClass =
  | 'DEPOSITS_CASH_CRYPTO'
  | 'LISTED_STOCKS'
  | 'INVESTMENT_TRUSTS'
  | 'BONDS'
  | 'FX'
  | 'INSURANCE'
  | 'REAL_ESTATE'
  | 'PENSIONS'
  | 'POINTS'
  | 'OTHER_ASSETS'

export interface AggregateAssetClassSnapshotCandidate {
  assetClass: AggregateAssetClass
  officialHeader: string
  valueJpy: number
}

/**
 * Aggregate asset history exported by a household finance service. This is
 * neither an account balance nor a portfolio position and must not be added to
 * account-level balances without an explicit reconciliation policy.
 */
export interface AggregateAssetSnapshotCandidate {
  kind: 'aggregate-asset-snapshot'
  lineage: SourceLineage
  asOf: string
  totalAssetsJpy: number
  assetClasses: readonly AggregateAssetClassSnapshotCandidate[]
}

export type BrokerageEventType =
  | 'BUY'
  | 'SELL'
  | 'DIVIDEND'
  | 'FEE'
  | 'TAX'
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'SPLIT'
  | 'REVERSE_SPLIT'
  | 'MERGER'
  | 'SPIN_OFF'
  | 'RIGHTS_SUBSCRIPTION'
  | 'CASH_IN_LIEU'

export type BrokerageLegKind =
  | 'SECURITY'
  | 'CASH'
  | 'INVESTMENT_INCOME'
  | 'INVESTMENT_EXPENSE'
  | 'INVESTMENT_TAX'
  | 'TRANSFER'
  | 'ADJUSTMENT'

/**
 * Signed monetary values follow ledger convention: debit/asset increase is
 * positive, credit/asset decrease is negative. Every event must sum to zero.
 */
export interface BrokerageEventLegCandidate {
  kind: BrokerageLegKind
  signedAmount: number
  currency: string
  instrumentCode?: string
  instrumentName?: string
  signedQuantity?: number
  description: string
}

/**
 * Canonical brokerage activity. These events belong to the investment ledger
 * and must not be included in household income or expense metrics.
 */
export interface BrokerageEventCandidate {
  kind: 'brokerage-event'
  lineage: SourceLineage
  accountHint?: string
  eventType: BrokerageEventType
  tradeDate: string | null
  settlementDate: string | null
  instrumentCode: string
  instrumentName: string
  /** Exchange/market parsed from a provider's combined security field, when present. */
  market?: string
  accountType: string
  currency: string
  quantity: number | null
  unitPrice: number | null
  grossAmount: number
  feeAmount: number
  taxAmount: number
  settlementAmount: number
  legs: readonly BrokerageEventLegCandidate[]
  reconciliationStatus: 'BALANCED' | 'ADJUSTED'
  reconciliationDifference: number
  affectsHouseholdExpense: false
  rawTransactionType: string
  corporateActionRatio?: number
  targetInstrumentCode?: string
  targetInstrumentName?: string
  targetCurrency?: string
  costBasisAllocationRatio?: number
  subscriptionAmount?: number
  cashInLieuAmount?: number
  cashInLieuQuantity?: number
  mergerCashAmount?: number
  mergerCashCurrency?: string
  mergerStockCostBasisRatio?: number
  sourceToTargetFxRate?: number
  sourceToCashFxRate?: number
}
