import type { PostingDecisionDto } from '../../platform'

const MIN_POSTING_ENTRIES = 2
const MAX_POSTING_ENTRIES = 128

export interface ReceiptSplitReviewItem {
  /** Stable review-row identifier. It is not persisted as a journal-entry identifier. */
  readonly id: string
  readonly description: string
  readonly amountJpy: number
  /** Falls back to the existing purchase-side debit account when omitted. */
  readonly expenseAccountId: string | null
}

export type ReceiptSplitReconciliationStatus = 'EXACT' | 'DELTA' | 'NO_ITEMS'

export interface ReceiptSplitReconciliation {
  readonly status: ReceiptSplitReconciliationStatus
  readonly candidateAmountJpy: number
  readonly itemTotalJpy: number | null
  /** Reviewed item total minus the candidate total. Null means no usable item total exists. */
  readonly deltaJpy: number | null
  readonly itemsAreValid: boolean
}

export type PostingDecisionValidationCode =
  | 'INVALID_CANDIDATE_AMOUNT'
  | 'INVALID_DECISION_ID'
  | 'CANDIDATE_ID_MISMATCH'
  | 'INVALID_TRANSACTION_TYPE'
  | 'INVALID_ENTRY_COUNT'
  | 'INVALID_ENTRY_ID'
  | 'DUPLICATE_ENTRY_ID'
  | 'INVALID_ACCOUNT_ID'
  | 'UNKNOWN_ACCOUNT_ID'
  | 'INVALID_ENTRY_AMOUNT'
  | 'UNBALANCED_TOTAL'
  | 'CANDIDATE_TOTAL_MISMATCH'

export interface PostingDecisionValidation {
  readonly valid: boolean
  readonly codes: readonly PostingDecisionValidationCode[]
}

export interface PostingDecisionValidationOptions {
  readonly candidateAmountJpy: number
  readonly accountIds: ReadonlySet<string>
  readonly expectedCandidateId?: string
}

export interface ExactReceiptItemSplitInput extends PostingDecisionValidationOptions {
  readonly direction: 'IN' | 'OUT'
  readonly decision: PostingDecisionDto
  readonly items: readonly ReceiptSplitReviewItem[]
  readonly nextEntryId: () => string
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0
}

function positiveJpy(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function pushUnique<T>(values: T[], value: T): void {
  if (!values.includes(value)) values.push(value)
}

/**
 * Reconciles already-sanitized receipt review rows against the canonical candidate total.
 * Invalid or overflowing item amounts never qualify as an exact reconciliation.
 */
export function reconcileReceiptSplit(
  candidateAmountJpy: number,
  items: readonly ReceiptSplitReviewItem[],
): ReceiptSplitReconciliation {
  if (items.length === 0) {
    return {
      status: 'NO_ITEMS',
      candidateAmountJpy,
      itemTotalJpy: null,
      deltaJpy: null,
      itemsAreValid: true,
    }
  }

  let itemTotalJpy = 0
  const seenIds = new Set<string>()
  let itemsAreValid = true
  for (const item of items) {
    if (!nonEmpty(item.id) || seenIds.has(item.id) || !nonEmpty(item.description) || !positiveJpy(item.amountJpy)) {
      itemsAreValid = false
    }
    seenIds.add(item.id)
    if (!positiveJpy(item.amountJpy) || !Number.isSafeInteger(itemTotalJpy + item.amountJpy)) {
      itemsAreValid = false
      continue
    }
    itemTotalJpy += item.amountJpy
  }

  if (!itemsAreValid || !positiveJpy(candidateAmountJpy)) {
    return { status: 'DELTA', candidateAmountJpy, itemTotalJpy: null, deltaJpy: null, itemsAreValid: false }
  }
  const deltaJpy = itemTotalJpy - candidateAmountJpy
  return {
    status: deltaJpy === 0 ? 'EXACT' : 'DELTA',
    candidateAmountJpy,
    itemTotalJpy,
    deltaJpy,
    itemsAreValid: true,
  }
}

/** Client-side mirror of the native posting invariants used before commit. */
export function validatePostingDecision(
  decision: PostingDecisionDto,
  options: PostingDecisionValidationOptions,
): PostingDecisionValidation {
  const codes: PostingDecisionValidationCode[] = []
  if (!positiveJpy(options.candidateAmountJpy)) pushUnique(codes, 'INVALID_CANDIDATE_AMOUNT')
  if (!nonEmpty(decision.candidateId) || !nonEmpty(decision.transactionId)) pushUnique(codes, 'INVALID_DECISION_ID')
  if (options.expectedCandidateId !== undefined && decision.candidateId !== options.expectedCandidateId) pushUnique(codes, 'CANDIDATE_ID_MISMATCH')
  if (!nonEmpty(decision.transactionType)) pushUnique(codes, 'INVALID_TRANSACTION_TYPE')
  if (decision.entries.length < MIN_POSTING_ENTRIES || decision.entries.length > MAX_POSTING_ENTRIES) pushUnique(codes, 'INVALID_ENTRY_COUNT')

  const entryIds = new Set<string>()
  let debitTotal = 0
  let creditTotal = 0
  let totalsAreSafe = true
  for (const entry of decision.entries) {
    if (!nonEmpty(entry.id)) pushUnique(codes, 'INVALID_ENTRY_ID')
    else if (entryIds.has(entry.id)) pushUnique(codes, 'DUPLICATE_ENTRY_ID')
    entryIds.add(entry.id)

    if (!nonEmpty(entry.accountId)) pushUnique(codes, 'INVALID_ACCOUNT_ID')
    else if (!options.accountIds.has(entry.accountId)) pushUnique(codes, 'UNKNOWN_ACCOUNT_ID')
    if (!positiveJpy(entry.amountJpy)) {
      pushUnique(codes, 'INVALID_ENTRY_AMOUNT')
      totalsAreSafe = false
      continue
    }
    if (entry.side === 'DEBIT') debitTotal += entry.amountJpy
    else if (entry.side === 'CREDIT') creditTotal += entry.amountJpy
    else totalsAreSafe = false
    if (!Number.isSafeInteger(debitTotal) || !Number.isSafeInteger(creditTotal)) totalsAreSafe = false
  }
  if (!totalsAreSafe || debitTotal !== creditTotal) pushUnique(codes, 'UNBALANCED_TOTAL')
  if (!totalsAreSafe || debitTotal !== options.candidateAmountJpy || creditTotal !== options.candidateAmountJpy) {
    pushUnique(codes, 'CANDIDATE_TOTAL_MISMATCH')
  }
  return { valid: codes.length === 0, codes }
}

/**
 * Converts an exact OUT purchase into item-level expense debits while retaining the
 * original payment-side credit entry. Returns null for every ambiguous shape.
 */
export function createExactReceiptItemSplit(input: ExactReceiptItemSplitInput): PostingDecisionDto | null {
  if (input.direction !== 'OUT' || !['EXPENSE', 'CARD_PURCHASE'].includes(input.decision.transactionType)) return null
  if (input.items.length < 2 || input.items.length + 1 > MAX_POSTING_ENTRIES) return null
  if (!validatePostingDecision(input.decision, input).valid) return null
  if (reconcileReceiptSplit(input.candidateAmountJpy, input.items).status !== 'EXACT') return null

  const paymentEntries = input.decision.entries.filter((entry) => entry.side === 'CREDIT')
  const purchaseEntries = input.decision.entries.filter((entry) => entry.side === 'DEBIT')
  if (paymentEntries.length !== 1 || purchaseEntries.length !== 1) return null
  const defaultExpenseAccountId = purchaseEntries[0].accountId

  const usedEntryIds = new Set(input.decision.entries.map((entry) => entry.id))
  const itemEntries = input.items.map((item) => {
    const accountId = item.expenseAccountId?.trim() || defaultExpenseAccountId
    if (!input.accountIds.has(accountId)) return null
    const id = input.nextEntryId().trim()
    if (!id || usedEntryIds.has(id)) return null
    usedEntryIds.add(id)
    return { id, accountId, side: 'DEBIT' as const, amountJpy: item.amountJpy }
  })
  if (itemEntries.some((entry) => entry === null)) return null

  const splitDecision: PostingDecisionDto = {
    ...input.decision,
    entries: [...itemEntries.filter((entry): entry is NonNullable<typeof entry> => entry !== null), paymentEntries[0]],
  }
  return validatePostingDecision(splitDecision, input).valid ? splitDecision : null
}
