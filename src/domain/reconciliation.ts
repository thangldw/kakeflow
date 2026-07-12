import type { CardPaymentReconciliationStatus, CardStatement, EntityId, IsoDate, JpyAmount } from './types'

export interface BankDebitForReconciliation {
  transactionId: EntityId
  bankAccountId: EntityId
  occurredOn: IsoDate
  amount: JpyAmount
  description: string
}

export interface CardBankRelationship {
  cardAccountId: EntityId
  bankAccountId: EntityId
}

export interface ReconciliationResult {
  statementId: EntityId
  bankTransactionId: EntityId
  score: number
  status: CardPaymentReconciliationStatus
  amountDifference: JpyAmount
  daysFromDueDate: number
  reasons: readonly string[]
}

function dateToEpochDay(date: IsoDate): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new RangeError(`Expected ISO date YYYY-MM-DD, received ${date}`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const epoch = Date.UTC(year, month - 1, day)
  const parsed = new Date(epoch)
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new RangeError(`Invalid calendar date ${date}`)
  }
  return epoch / 86_400_000
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/[\s\-_・.,，．]/g, '')
}

function issuerMatches(description: string, issuerName: string): boolean {
  const haystack = normalize(description)
  const needle = normalize(issuerName)
  if (needle.length >= 2 && haystack.includes(needle)) return true

  // Bank ledgers often use katakana or a billing-company name while card
  // statements use the consumer-facing issuer. Keep these aliases explicit and
  // deterministic instead of relying on opaque fuzzy matching.
  const issuerAliases: Readonly<Record<string, readonly string[]>> = {
    楽天カード: ['ラクテンカード', 'ラクテンカードサービス', '楽天カードサービス'],
    amazonmastercard: ['amazon', 'アマゾン', 'ミツイスミトモカード'],
    三井住友カード: ['ミツイスミトモカード', 'smbcカード', 'smbccard'],
    jcb: ['ジェーシービー', 'jcb'],
    americanexpress: ['アメリカンエキスプレス', 'amex'],
  }

  return Object.entries(issuerAliases).some(([canonical, aliases]) =>
    (needle.includes(normalize(canonical)) || normalize(canonical).includes(needle)) &&
    aliases.some((alias) => haystack.includes(normalize(alias))),
  )
}

/**
 * Scores one statement/debit pair. Score weights are intentionally stable and
 * explainable: amount 50, configured account relationship 20, issuer text 15,
 * and due-date proximity 15. No fuzzy/ML behavior is used.
 */
export function reconcileCardStatementToBankDebit(
  statement: CardStatement,
  debit: BankDebitForReconciliation,
  relationships: readonly CardBankRelationship[] = [],
): ReconciliationResult {
  let score = 0
  const reasons: string[] = []
  const amountDifference = (debit.amount - statement.amountDue) as JpyAmount
  const exactAmount = amountDifference === 0

  if (exactAmount) {
    score += 50
    reasons.push('Exact statement amount (+50)')
  }

  const knownRelationship = relationships.some(
    ({ cardAccountId, bankAccountId }) =>
      cardAccountId === statement.cardAccountId && bankAccountId === debit.bankAccountId,
  )
  if (knownRelationship) {
    score += 20
    reasons.push('Configured bank-to-card relationship (+20)')
  }

  if (issuerMatches(debit.description, statement.issuerName)) {
    score += 15
    reasons.push('Bank description contains normalized issuer name (+15)')
  }

  const daysFromDueDate = Math.abs(dateToEpochDay(debit.occurredOn) - dateToEpochDay(statement.dueDate))
  if (daysFromDueDate <= 3) {
    score += 15
    reasons.push('Debit is within 3 days of due date (+15)')
  } else if (daysFromDueDate <= 7) {
    score += 10
    reasons.push('Debit is within 7 days of due date (+10)')
  } else if (daysFromDueDate <= 14) {
    score += 5
    reasons.push('Debit is within 14 days of due date (+5)')
  }

  let status: CardPaymentReconciliationStatus = 'UNMATCHED'
  if (exactAmount && score >= 90) status = 'FULLY_RECONCILED'
  else if (exactAmount && score >= 70) status = 'POSSIBLE_MATCH'
  else if (!exactAmount && score >= 35) status = amountDifference < 0 ? 'UNDERPAID' : 'OVERPAID'

  return {
    statementId: statement.id,
    bankTransactionId: debit.transactionId,
    score,
    status,
    amountDifference,
    daysFromDueDate,
    reasons,
  }
}

/** Stable best-match selection: score desc, date distance asc, transaction id asc. */
export function findBestBankDebitMatch(
  statement: CardStatement,
  debits: readonly BankDebitForReconciliation[],
  relationships: readonly CardBankRelationship[] = [],
): ReconciliationResult | undefined {
  return debits
    .map((debit) => reconcileCardStatementToBankDebit(statement, debit, relationships))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.daysFromDueDate - b.daysFromDueDate ||
        a.bankTransactionId.localeCompare(b.bankTransactionId),
    )[0]
}
