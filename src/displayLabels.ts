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

const DIRECTION_LABELS = { IN: '入金', OUT: '出金' } as const

const SOURCE_TYPE_LABELS: Readonly<Record<string, string>> = {
  LOCAL_FOLDER: 'ローカルフォルダー', ICLOUD_PICKER: 'iCloud Drive', GOOGLE_DRIVE: 'Google Drive',
  GMAIL: 'Gmail', MANUAL_UPLOAD: '手動アップロード', CAMERA_SCAN: 'カメラ撮影', OTHER: 'その他',
}

const EVIDENCE_ROLE_LABELS: Readonly<Record<string, string>> = {
  PRIMARY: '主要証跡', FUNDING_LEG: '資金側証跡', REWARD_LEG: 'ポイント側証跡',
  CONTINUATION: '継続行', SUPPORTING: '補助証跡',
}

const BROKERAGE_EVENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  BUY: '買付', SELL: '売却', DIVIDEND: '配当', FEE: '手数料', TAX: '税金', DEPOSIT: '入金', WITHDRAWAL: '出金',
  SPLIT: '株式分割', REVERSE_SPLIT: '株式併合', MERGER: '合併', SPIN_OFF: 'スピンオフ',
  RIGHTS_SUBSCRIPTION: '新株予約権行使', CASH_IN_LIEU: '端株現金交付',
}

const MEMBER_ROLE_LABELS: Readonly<Record<string, string>> = {
  OWNER: '所有者', MEMBER: 'メンバー',
}

export const DISPLAY_LABEL_SOURCES = [...new Set([
  ...Object.values(CANONICAL_ACCOUNT_NAMES), ...Object.values(ACCOUNT_KIND_LABELS),
  ...Object.values(ACCOUNT_SUBTYPE_LABELS), ...Object.values(TRANSACTION_TYPE_LABELS),
  ...Object.values(DIRECTION_LABELS), ...Object.values(SOURCE_TYPE_LABELS), ...Object.values(EVIDENCE_ROLE_LABELS),
  ...Object.values(BROKERAGE_EVENT_TYPE_LABELS),
  ...Object.values(MEMBER_ROLE_LABELS),
])]

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

export function directionLabel(direction: string, text: Translate): string {
  return text(DIRECTION_LABELS[direction as keyof typeof DIRECTION_LABELS] ?? direction)
}

export function sourceTypeLabel(sourceType: string, text: Translate): string {
  return text(SOURCE_TYPE_LABELS[sourceType] ?? sourceType)
}

export function evidenceRoleLabel(role: string, text: Translate): string {
  return text(EVIDENCE_ROLE_LABELS[role] ?? role)
}

export function brokerageEventTypeLabel(type: string, text: Translate): string {
  return text(BROKERAGE_EVENT_TYPE_LABELS[type] ?? type)
}

export function memberRoleLabel(role: string, text: Translate): string {
  return text(MEMBER_ROLE_LABELS[role] ?? role)
}
