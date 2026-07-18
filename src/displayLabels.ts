import type { AccountDto } from './platform'

type Translate = (source: string) => string

const CANONICAL_ACCOUNT_NAMES: Readonly<Record<string, string>> = {
  bank: '銀行', cash: '現金', wallet: 'ウォレット', card: 'クレジットカード',
  'rakuten-card': '楽天カード', 'amazon-card': 'Amazon Mastercard', income: '収入',
  groceries: '食費', housing: '住宅', utilities: '水道・光熱費', transport: '交通費',
  healthcare: '健康・医療', entertainment: '趣味・娯楽', 'household-goods': '日用品',
  'clothing-beauty': '衣服・美容', 'special-expense': '特別な支出', social: '交際費',
  automobile: '自動車', insurance: '保険', 'taxes-social-security': '税・社会保障',
  education: '教養・教育', communication: '通信費', 'other-expense': 'その他',
}

const ACCOUNT_KIND_LABELS: Readonly<Record<AccountDto['accountKind'], string>> = {
  ASSET: '資産', LIABILITY: '負債', EQUITY: '純資産', INCOME: '収入', EXPENSE: '支出',
}

const ACCOUNT_SUBTYPE_LABELS: Readonly<Record<AccountDto['accountSubtype'], string>> = {
  BANK: '銀行', CASH: '現金', WALLET: 'ウォレット', SECURITIES: '証券',
  CREDIT_CARD: 'クレジットカード', RECEIVABLE: '未収金', OTHER: 'その他',
}

const TRANSACTION_TYPE_LABELS: Readonly<Record<string, string>> = {
  EXPENSE: '支出', INCOME: '収入', TRANSFER: '振替', CARD_PURCHASE: 'カード利用',
  CARD_PAYMENT: 'カード支払', REFUND: '返金', FEE: '手数料', INTEREST: '利息', ADJUSTMENT: '調整',
}

export function canonicalAccountName(account: Pick<AccountDto, 'id' | 'name'>, text: Translate): string {
  const suffix = Object.keys(CANONICAL_ACCOUNT_NAMES)
    .sort((left, right) => right.length - left.length)
    .find((candidate) => account.id.endsWith(`-${candidate}`))
  return text(suffix ? CANONICAL_ACCOUNT_NAMES[suffix] : account.name)
}

export function accountKindLabel(kind: AccountDto['accountKind'], text: Translate): string {
  return text(ACCOUNT_KIND_LABELS[kind])
}

export function accountSubtypeLabel(subtype: AccountDto['accountSubtype'], text: Translate): string {
  return text(ACCOUNT_SUBTYPE_LABELS[subtype])
}

export function transactionTypeLabel(type: string, text: Translate): string {
  return text(TRANSACTION_TYPE_LABELS[type] ?? type)
}
