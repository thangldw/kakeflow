import { localize } from '../../i18n'
import type { LocalCategorySuggestion } from '../classification/localCategorySuggestion'
import type { AccountDto, ClassificationRuleDto, PostingDecisionDto, PreviewCandidateDto } from '../../platform/types'

export function suggestedPosting(candidate: PreviewCandidateDto, accounts: readonly AccountDto[], householdId: string): PostingDecisionDto {
  const source = accounts.find((account) => account.id === candidate.accountId)
  if (!source) throw new Error('Candidate source account is missing')
  const expenseAccount = accounts.find((account) => account.id === `${householdId}-other-expense` && account.accountKind === 'EXPENSE')
  const incomeAccount = accounts.find((account) => account.id === `${householdId}-income` && account.accountKind === 'INCOME')
  const text = `${candidate.merchantRaw ?? ''} ${candidate.descriptionRaw ?? ''}`
  const cardAccounts = accounts.filter((account) => account.accountKind === 'LIABILITY' && account.accountSubtype === 'CREDIT_CARD')
  const cardAccount = /(?:楽天|RAKUTEN)/i.test(text)
    ? cardAccounts.find((account) => /Rakuten/i.test(account.name))
    : /(?:AMAZON|SMBC|三井住友)/i.test(text)
      ? cardAccounts.find((account) => /Amazon/i.test(account.name))
      : cardAccounts.find((account) => account.id.endsWith('-card')) ?? cardAccounts[0]
  const looksLikeCardPayment = source.accountSubtype === 'BANK' && /(カード|CARD|JCB|AMEX|アメックス)/i.test(text)
  const looksLikeRefund = /(返金|返品|REFUND|REVERSAL)/i.test(text)
  let transactionType: string
  let debitAccount: AccountDto | undefined
  let creditAccount: AccountDto | undefined
  if (candidate.suggestedTransactionType === 'TRANSFER') {
    transactionType = 'TRANSFER'
    const counterpart = accounts.find((account) => account.id !== source.id && (account.accountKind === 'ASSET' || account.accountKind === 'LIABILITY'))
    if (candidate.direction === 'OUT') { debitAccount = counterpart; creditAccount = source }
    else { debitAccount = source; creditAccount = counterpart }
  } else if (looksLikeCardPayment && candidate.direction === 'OUT') {
    transactionType = 'CARD_PAYMENT'; debitAccount = cardAccount; creditAccount = source
  } else if (candidate.direction === 'OUT') {
    transactionType = source.accountSubtype === 'CREDIT_CARD' ? 'CARD_PURCHASE' : 'EXPENSE'
    debitAccount = expenseAccount; creditAccount = source
  } else if (looksLikeRefund) {
    transactionType = 'REFUND'; debitAccount = source; creditAccount = expenseAccount
  } else {
    transactionType = 'INCOME'; debitAccount = source; creditAccount = incomeAccount
  }
  if (!debitAccount || !creditAccount) throw new Error('Required ledger account is missing')
  return {
    candidateId: candidate.id,
    transactionId: globalThis.crypto.randomUUID(),
    transactionType,
    payee: candidate.merchantRaw,
    description: candidate.descriptionRaw,
    calculationTarget: candidate.suggestedTransactionType === 'TRANSFER' ? false : candidate.calculationTarget,
    attributionKind: candidate.attributionKind,
    attributedMemberId: candidate.attributedMemberId,
    audienceVisibility: candidate.audienceVisibility,
    audienceMemberId: candidate.audienceMemberId,
    duplicateResolution: candidate.duplicateMatch?.decision && candidate.duplicateMatch.decision !== 'UNRESOLVED' ? candidate.duplicateMatch.decision : undefined,
    entries: [
      { id: globalThis.crypto.randomUUID(), accountId: debitAccount.id, side: 'DEBIT', amountJpy: candidate.amountJpy },
      { id: globalThis.crypto.randomUUID(), accountId: creditAccount.id, side: 'CREDIT', amountJpy: candidate.amountJpy },
    ],
  }
}

export interface PostingDraft {
  readonly approved: boolean
  readonly decision: PostingDecisionDto
  readonly error: string | null
  readonly touched: boolean
}

export function matchingClassificationRule(rules: readonly ClassificationRuleDto[], merchant: string | null, description: string | null): ClassificationRuleDto | null {
  const contains = (value: string | null, needle: string | null) => needle === null || Boolean(value?.toLocaleLowerCase().includes(needle.toLocaleLowerCase()))
  return [...rules]
    .filter((rule) => rule.isEnabled && contains(merchant, rule.merchantContains) && contains(description, rule.descriptionContains))
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))[0] ?? null
}

export function eligibleClassificationDecision(decision: PostingDecisionDto, accounts: readonly AccountDto[]): boolean {
  if (!['EXPENSE', 'CARD_PURCHASE', 'REFUND'].includes(decision.transactionType)) return false
  const expenseEntries = decision.entries.filter((entry) => accounts.find((account) => account.id === entry.accountId)?.accountKind === 'EXPENSE')
  const expectedSide = decision.transactionType === 'REFUND' ? 'CREDIT' : 'DEBIT'
  return expenseEntries.length === 1 && expenseEntries[0].side === expectedSide
}

export function applyClassificationRuleToDecision(decision: PostingDecisionDto, rule: ClassificationRuleDto, accounts: readonly AccountDto[]): PostingDecisionDto | null {
  if (!eligibleClassificationDecision(decision, accounts) || !accounts.some((account) => account.id === rule.categoryAccountId && account.accountKind === 'EXPENSE')) return null
  const expenseEntries = decision.entries.filter((entry) => accounts.find((account) => account.id === entry.accountId)?.accountKind === 'EXPENSE')
  if (expenseEntries.length !== 1) return null
  return {
    ...decision,
    entries: decision.entries.map((entry) => entry.id === expenseEntries[0].id ? { ...entry, accountId: rule.categoryAccountId } : entry),
    classificationRuleId: rule.id,
    expectedClassificationRuleUpdatedAt: rule.updatedAt,
  }
}

export function applyLocalCategorySuggestionToDecision(decision: PostingDecisionDto, suggestion: LocalCategorySuggestion, accounts: readonly AccountDto[]): PostingDecisionDto | null {
  if (!eligibleClassificationDecision(decision, accounts) || !accounts.some((account) => account.id === suggestion.categoryAccountId && account.accountKind === 'EXPENSE')) return null
  const expenseEntries = decision.entries.filter((entry) => accounts.find((account) => account.id === entry.accountId)?.accountKind === 'EXPENSE')
  if (expenseEntries.length !== 1) return null
  return clearClassificationProvenance({
    ...decision,
    entries: decision.entries.map((entry) => entry.id === expenseEntries[0].id ? { ...entry, accountId: suggestion.categoryAccountId } : entry),
  })
}

export function clearClassificationProvenance(decision: PostingDecisionDto): PostingDecisionDto {
  const { classificationRuleId: _ruleId, expectedClassificationRuleUpdatedAt: _updatedAt, ...manualDecision } = decision
  void _ruleId; void _updatedAt
  return manualDecision
}

export function decisionUsesCategory(decision: PostingDecisionDto, categoryAccountId: string, accounts: readonly AccountDto[]): boolean {
  const expectedSide = decision.transactionType === 'REFUND' ? 'CREDIT' : 'DEBIT'
  return decision.entries.some((entry) => entry.side === expectedSide && entry.accountId === categoryAccountId && accounts.find((account) => account.id === entry.accountId)?.accountKind === 'EXPENSE')
}

export function initialPostingDraft(candidate: PreviewCandidateDto, accounts: readonly AccountDto[], householdId: string): PostingDraft {
  try {
    return { approved: false, decision: suggestedPosting(candidate, accounts, householdId), error: null, touched: false }
  } catch {
    return {
      approved: false,
      touched: false,
      error: localize("取込先または相手勘定が見つかりません。口座設定を確認するか、このインポートを取り消してください。"),
      decision: {
        candidateId: candidate.id,
        transactionId: globalThis.crypto.randomUUID(),
        transactionType: candidate.suggestedTransactionType ?? 'EXPENSE',
        payee: candidate.merchantRaw,
        description: candidate.descriptionRaw,
        calculationTarget: candidate.calculationTarget,
        attributionKind: candidate.attributionKind,
        attributedMemberId: candidate.attributedMemberId,
        audienceVisibility: candidate.audienceVisibility,
        audienceMemberId: candidate.audienceMemberId,
        duplicateResolution: candidate.duplicateMatch?.decision && candidate.duplicateMatch.decision !== 'UNRESOLVED' ? candidate.duplicateMatch.decision : undefined,
        entries: [
          { id: globalThis.crypto.randomUUID(), accountId: '', side: 'DEBIT', amountJpy: candidate.amountJpy },
          { id: globalThis.crypto.randomUUID(), accountId: '', side: 'CREDIT', amountJpy: candidate.amountJpy },
        ],
      },
    }
  }
}
