import type { TransactionRowDto } from '../../platform/types'
import type { Transaction } from '../../types'

type TransactionPresentation = Pick<Transaction, 'category' | 'icon' | 'accountingEffect'> & {
  readonly label: string
  readonly sign: 'positive' | 'negative' | 'preserve'
}

const PRESENTATION_BY_TYPE: Readonly<Record<string, TransactionPresentation>> = {
  EXPENSE: { label: '支出', category: '支出', icon: 'subscription', accountingEffect: 'ACCRUAL_AND_CASH', sign: 'negative' },
  INCOME: { label: '収入', category: '収入', icon: 'income', accountingEffect: 'ACCRUAL_AND_CASH', sign: 'positive' },
  TRANSFER: { label: '資金移動', category: '資金移動', icon: 'subscription', accountingEffect: 'ACCRUAL_AND_CASH', sign: 'preserve' },
  CARD_PURCHASE: { label: 'カード利用', category: 'カード利用', icon: 'subscription', accountingEffect: 'ACCRUAL_ONLY', sign: 'negative' },
  CARD_PAYMENT: { label: 'カード支払い', category: '資金移動', icon: 'subscription', accountingEffect: 'CASH_ONLY', sign: 'negative' },
  REFUND: { label: '返金', category: '返金', icon: 'income', accountingEffect: 'ACCRUAL_AND_CASH', sign: 'positive' },
  FEE: { label: '手数料', category: '手数料', icon: 'subscription', accountingEffect: 'ACCRUAL_AND_CASH', sign: 'negative' },
  INTEREST: { label: '利息', category: '利息', icon: 'subscription', accountingEffect: 'ACCRUAL_AND_CASH', sign: 'negative' },
  ADJUSTMENT: { label: '調整', category: '調整', icon: 'subscription', accountingEffect: 'ACCRUAL_AND_CASH', sign: 'preserve' },
}

const UNKNOWN_PRESENTATION: TransactionPresentation = {
  label: '取引',
  category: 'その他',
  icon: 'subscription',
  accountingEffect: 'ACCRUAL_AND_CASH',
  sign: 'preserve',
}

function nonBlank(value: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function formatJapaneseDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return isoDate

  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(Number(match[1]), month - 1, day))
  if (parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return isoDate
  return `${month}月${day}日`
}

function signedAmount(amount: number, sign: TransactionPresentation['sign']): number {
  if (sign === 'positive') return Math.abs(amount)
  if (sign === 'negative') return -Math.abs(amount)
  return amount
}

export function toTransactionViewModel(row: TransactionRowDto): Transaction {
  const type = row.transactionType.trim().toUpperCase()
  const presentation = PRESENTATION_BY_TYPE[type] ?? UNKNOWN_PRESENTATION
  const payee = nonBlank(row.payee)
  const description = nonBlank(row.description)

  return {
    id: row.id,
    date: formatJapaneseDate(row.occurredOn),
    merchant: payee ?? description ?? presentation.label,
    detail: description ?? presentation.label,
    category: nonBlank(row.categoryName) ?? presentation.category,
    account: [nonBlank(row.creditAccountName), nonBlank(row.debitAccountName)].filter(Boolean).join(' → ') || '口座情報なし',
    amount: signedAmount(row.amountJpy, presentation.sign),
    status: row.status.trim().toUpperCase() === 'POSTED' ? 'confirmed' : 'review',
    icon: presentation.icon,
    accountingEffect: presentation.accountingEffect,
    attributionLabel: row.attributionKind === 'HOUSEHOLD' ? '世帯共通' : row.attributedMemberName ?? 'メンバー',
    audienceLabel: row.audienceVisibility === 'SHARED' ? '共有' : `個人・${row.audienceMemberName ?? 'メンバー'}`,
    calculationTarget: row.calculationTarget,
  }
}
