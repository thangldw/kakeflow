import type { AdapterId } from '../../ingestion'
import type { AccountDto } from '../../platform/types'
import type { ImportPreview } from './importService'

export type StandardImportAccountRequirement = {
  kind: 'ASSET' | 'LIABILITY'
  subtype: 'BANK' | 'WALLET' | 'CREDIT_CARD'
  kindLabel: '銀行口座' | 'ウォレット口座' | 'カード口座'
  message: string
}

export const STANDARD_IMPORT_ACCOUNT_REQUIREMENTS: Partial<Record<AdapterId, StandardImportAccountRequirement>> = {
  'mizuho-business-web-statement-v1': { kind: 'ASSET', subtype: 'BANK', kindLabel: '銀行口座', message: 'みずほビジネスWEB 入出金明細CSVの取込先銀行口座を選択してください。' },
  'resona-web-meisai-plus-v1': { kind: 'ASSET', subtype: 'BANK', kindLabel: '銀行口座', message: 'りそな銀行 Web入出金明細PLUS CSVの取込先銀行口座を選択してください。' },
  'personal-japanese-bank-ledger-v2': { kind: 'ASSET', subtype: 'BANK', kindLabel: '銀行口座', message: '銀行CSVの取込先銀行口座を選択してください。' },
  'japanese-bank-ledger-v1': { kind: 'ASSET', subtype: 'BANK', kindLabel: '銀行口座', message: '銀行CSVの取込先銀行口座を選択してください。' },
  'ofx-bank-statement-v1': { kind: 'ASSET', subtype: 'BANK', kindLabel: '銀行口座', message: 'OFX/QFX明細の取込先銀行口座を選択してください。' },
  'qif-bank-v1': { kind: 'ASSET', subtype: 'BANK', kindLabel: '銀行口座', message: 'QIF明細の取込先銀行口座を選択してください。' },
  'mufg-bizstation-all-details-v1': { kind: 'ASSET', subtype: 'BANK', kindLabel: '銀行口座', message: '三菱UFJ銀行 BizSTATION CSVの取込先銀行口座を選択してください。' },
  'mufg-bizstation-deposit-withdrawal-v1': { kind: 'ASSET', subtype: 'BANK', kindLabel: '銀行口座', message: '三菱UFJ銀行 BizSTATION 入出金明細CSVの取込先銀行口座を選択してください。' },
  'paypay-history-v2': { kind: 'ASSET', subtype: 'WALLET', kindLabel: 'ウォレット口座', message: 'PayPay履歴の取込先ウォレット口座を選択してください。' },
  'paypay-history-v1': { kind: 'ASSET', subtype: 'WALLET', kindLabel: 'ウォレット口座', message: 'PayPay履歴の取込先ウォレット口座を選択してください。' },
  'rakuten-enavi-v1': { kind: 'LIABILITY', subtype: 'CREDIT_CARD', kindLabel: 'カード口座', message: '楽天カード明細の取込先カード口座を選択してください。' },
  'amazon-mastercard-statement-v1': { kind: 'LIABILITY', subtype: 'CREDIT_CARD', kindLabel: 'カード口座', message: 'Amazon Mastercard明細の取込先カード口座を選択してください。' },
  'jcb-myjcb-statement-v1': { kind: 'LIABILITY', subtype: 'CREDIT_CARD', kindLabel: 'カード口座', message: 'JCB明細の取込先カード口座を選択してください。' },
  'smbc-vpass-statement-v1': { kind: 'LIABILITY', subtype: 'CREDIT_CARD', kindLabel: 'カード口座', message: '三井住友カード（Vpass）明細の取込先カード口座を選択してください。' },
  'aeon-card-finalized-statement-v1': { kind: 'LIABILITY', subtype: 'CREDIT_CARD', kindLabel: 'カード口座', message: 'イオンカード確定明細の取込先カード口座を選択してください。' },
  'paypay-card-finalized-statement-v1': { kind: 'LIABILITY', subtype: 'CREDIT_CARD', kindLabel: 'カード口座', message: 'PayPayカード確定明細の取込先カード口座を選択してください。' },
}

export function builtInAdapterVersion(adapterId: AdapterId): string {
  return adapterId === 'personal-japanese-bank-ledger-v2' || adapterId === 'paypay-history-v2' ? '2' : '1'
}

export type DedicatedBrokerageImportConfig = {
  readonly title: string
  readonly description: string
  readonly accountHint: string
  readonly missingAccountMessage: string
}

export const DEDICATED_BROKERAGE_IMPORTS: Readonly<Record<string, DedicatedBrokerageImportConfig>> = {
  'sbi-securities-trade-history-v1': {
    title: 'SBI証券 取引履歴CSV',
    description: '取引履歴を保存する証券口座を原本ごとに明示します。家計簿の取引台帳へは自動反映しません。',
    accountHint: 'SBI証券の口座を推測または自動作成しません。',
    missingAccountMessage: 'SBI証券取引履歴の取込先証券口座を選択してください。',
  },
  'rakuten-securities-domestic-trade-history-v1': {
    title: '楽天証券 国内株式 取引履歴CSV',
    description: '国内株式の取引履歴を保存する証券口座を原本ごとに明示します。家計簿の取引台帳へは自動反映しません。',
    accountHint: '楽天証券の口座を推測または自動作成しません。',
    missingAccountMessage: '楽天証券取引履歴の取込先証券口座を選択してください。',
  },
  'monex-us-stock-trade-history-v1': {
    title: 'マネックス証券 米国株 取引履歴CSV',
    description: '米ドル決済の現物売買を保存する証券口座を原本ごとに明示します。家計簿の取引台帳へは自動反映しません。',
    accountHint: 'マネックス証券の口座を推測または自動作成せず、円決済・信用取引も取り込みません。',
    missingAccountMessage: 'マネックス証券取引履歴の取込先証券口座を選択してください。',
  },
}

export function dedicatedBrokerageImport(adapterId: AdapterId | undefined): DedicatedBrokerageImportConfig | undefined {
  return adapterId ? DEDICATED_BROKERAGE_IMPORTS[adapterId] : undefined
}

export function isBrokerageTransactionAdapter(adapterId: AdapterId | undefined): boolean {
  return adapterId === 'japanese-brokerage-transactions-v1' || dedicatedBrokerageImport(adapterId) != null
}

export function hasCompatibleStandardImportAccount(adapterId: AdapterId | undefined, accounts: readonly AccountDto[]): boolean {
  if (!adapterId) return true
  const requirement = STANDARD_IMPORT_ACCOUNT_REQUIREMENTS[adapterId]
  return !requirement || accounts.some((account) => account.accountKind === requirement.kind && account.accountSubtype === requirement.subtype)
}

export function moneyForwardInstitutions(item: ImportPreview): readonly string[] {
  if (item.detectedAdapterId !== 'money-forward-me-household-ledger-v1' || !item.parsed) return []
  const institutions = item.parsed.records.flatMap((record) => {
    if (typeof record !== 'object' || record === null) return []
    const candidate = record as { kind?: unknown; institution?: unknown }
    return candidate.kind === 'money-forward-household-transaction' && typeof candidate.institution === 'string' && candidate.institution ? [candidate.institution] : []
  })
  return [...new Set(institutions)]
}

export function eligibleMoneyForwardAccounts(accounts: readonly AccountDto[]): readonly AccountDto[] {
  return accounts.filter((account) => account.accountKind === 'ASSET' || account.accountKind === 'LIABILITY')
}

export function importAccountDescriptionId(item: ImportPreview, accounts: readonly AccountDto[]): string | undefined {
  if (!hasCompatibleStandardImportAccount(item.detectedAdapterId, accounts)) return `standard-account-empty-${item.id}`
  if (item.detectedAdapterId === 'money-forward-me-household-ledger-v1' && eligibleMoneyForwardAccounts(accounts).length === 0) return `money-forward-account-empty-${item.id}`
  return undefined
}

export function hasCompleteMoneyForwardMapping(item: ImportPreview, mappings: Readonly<Record<string, string>> | undefined, accounts: readonly AccountDto[]): boolean {
  const institutions = moneyForwardInstitutions(item)
  if (institutions.length === 0 || !mappings || Object.keys(mappings).length !== institutions.length) return false
  return institutions.every((institution) => {
    const account = eligibleMoneyForwardAccounts(accounts).find((candidate) => candidate.id === mappings[institution])
    return account?.accountKind === 'ASSET' || account?.accountKind === 'LIABILITY'
  })
}
