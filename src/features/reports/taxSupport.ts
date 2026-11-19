/**
 * Tax-return support for Japanese households (確定申告): lists the posted transactions of a year that
 * look like medical expenses (医療費控除) or donations (ふるさと納税 / 寄附金控除), and builds a CSV to hand
 * to the tax office forms or an accountant.
 *
 * Everything here is a CANDIDATE list for the user to confirm, never a filed figure: whether an expense
 * qualifies depends on rules the ledger cannot see (insurance reimbursements, cosmetic treatment, ...).
 */

export interface TaxTransaction {
  readonly id: string
  readonly occurredOn: string
  readonly transactionType: string
  readonly payee: string | null
  readonly description: string | null
  readonly amountJpy: number
  readonly status: string
  readonly calculationTarget: boolean
  readonly categoryName: string | null
}

export type TaxItemKind = 'MEDICAL' | 'FURUSATO' | 'DONATION'

export interface TaxItem {
  readonly kind: TaxItemKind
  readonly transactionId: string
  readonly occurredOn: string
  readonly payee: string
  readonly description: string
  /** Positive for an expense, negative for a refund. */
  readonly amountJpy: number
}

export interface TaxSupportReport {
  readonly year: string
  readonly medical: readonly TaxItem[]
  readonly furusato: readonly TaxItem[]
  readonly donations: readonly TaxItem[]
  readonly medicalTotalJpy: number
  readonly furusatoTotalJpy: number
  readonly donationTotalJpy: number
  /** Only when the annual income was given: the 医療費控除 reference amount. Null otherwise. */
  readonly medicalDeductionJpy: number | null
}

const SPENDING_TYPES = new Set(['EXPENSE', 'CARD_PURCHASE', 'FEE'])
const REFUND_TYPE = 'REFUND'
const MEDICAL_CATEGORY = /医療|健康|medical|y tế/iu
const MEDICAL_TEXT = /病院|医院|クリニック|診療|薬局|調剤|歯科|整骨|接骨|入院|ドラッグ処方|pharmacy|hospital|clinic/iu
// Over-the-counter drugs and cosmetics at a drugstore are not medical expenses; only prescriptions are.
const FURUSATO_TEXT = /ふるさと納税|ふるさとチョイス|さとふる|ふるなび|楽天ふるさと|ふるさとプレミアム|furusato/iu
const DONATION_TEXT = /寄附|寄付|募金|赤十字|ユニセフ|共同募金|donation/iu

/** The 医療費控除 threshold: the smaller of ¥100,000 and 5% of the total income. */
export function medicalDeductionJpy(totalMedicalJpy: number, annualIncomeJpy: number): number {
  const threshold = Math.min(100_000, Math.floor(annualIncomeJpy * 0.05))
  return Math.min(2_000_000, Math.max(0, totalMedicalJpy - threshold))
}

function classify(transaction: TaxTransaction): TaxItemKind | null {
  const text = `${transaction.payee ?? ''} ${transaction.description ?? ''}`
  if (FURUSATO_TEXT.test(text)) return 'FURUSATO'
  if (DONATION_TEXT.test(text) || (transaction.categoryName != null && /寄附|寄付/u.test(transaction.categoryName))) return 'DONATION'
  if ((transaction.categoryName != null && MEDICAL_CATEGORY.test(transaction.categoryName)) || MEDICAL_TEXT.test(text)) return 'MEDICAL'
  return null
}

/**
 * Builds the candidate lists for `year` (e.g. "2026"). Only posted, calculation-target transactions count;
 * refunds of a matching item reduce its total. Items are ordered by date then id.
 */
export function buildTaxSupportReport(
  transactions: readonly TaxTransaction[],
  year: string,
  annualIncomeJpy?: number | null,
): TaxSupportReport {
  const items: TaxItem[] = []
  for (const transaction of transactions) {
    if (!transaction.occurredOn.startsWith(`${year}-`)) continue
    if (!transaction.calculationTarget || transaction.status !== 'POSTED') continue
    const isRefund = transaction.transactionType === REFUND_TYPE
    if (!isRefund && !SPENDING_TYPES.has(transaction.transactionType)) continue
    const kind = classify(transaction)
    if (!kind) continue
    items.push({
      kind,
      transactionId: transaction.id,
      occurredOn: transaction.occurredOn,
      payee: transaction.payee ?? '',
      description: transaction.description ?? '',
      amountJpy: isRefund ? -Math.abs(transaction.amountJpy) : Math.abs(transaction.amountJpy),
    })
  }
  items.sort((left, right) => left.occurredOn.localeCompare(right.occurredOn) || left.transactionId.localeCompare(right.transactionId))
  const of = (kind: TaxItemKind) => items.filter((item) => item.kind === kind)
  const total = (list: readonly TaxItem[]) => list.reduce((sum, item) => sum + item.amountJpy, 0)
  const medical = of('MEDICAL')
  const medicalTotalJpy = total(medical)
  return {
    year,
    medical,
    furusato: of('FURUSATO'),
    donations: of('DONATION'),
    medicalTotalJpy,
    furusatoTotalJpy: total(of('FURUSATO')),
    donationTotalJpy: total(of('DONATION')),
    medicalDeductionJpy: annualIncomeJpy != null && annualIncomeJpy > 0 ? medicalDeductionJpy(medicalTotalJpy, annualIncomeJpy) : null,
  }
}

const KIND_LABEL: Record<TaxItemKind, string> = { MEDICAL: '医療費', FURUSATO: 'ふるさと納税', DONATION: '寄附金' }

/** Neutralizes spreadsheet formulas in user-controlled text. */
function safeCell(value: string): string {
  const flat = value.replace(/[\r\n]+/gu, ' ')
  const guarded = /^[=+\-@\t]/u.test(flat) ? `'${flat}` : flat
  return /[",]/u.test(guarded) ? `"${guarded.replace(/"/gu, '""')}"` : guarded
}

/** A UTF-8 CSV with BOM (so Excel reads Japanese), one row per candidate plus a subtotal row per kind. */
export function taxSupportCsv(report: TaxSupportReport): string {
  const rows: string[] = [['区分', '日付', '支払先', '内容', '金額(円)', '取引ID'].join(',')]
  const groups: ReadonlyArray<readonly [TaxItemKind, readonly TaxItem[], number]> = [
    ['MEDICAL', report.medical, report.medicalTotalJpy],
    ['FURUSATO', report.furusato, report.furusatoTotalJpy],
    ['DONATION', report.donations, report.donationTotalJpy],
  ]
  for (const [kind, list, total] of groups) {
    for (const item of list) {
      rows.push([KIND_LABEL[kind], item.occurredOn, safeCell(item.payee), safeCell(item.description), String(item.amountJpy), safeCell(item.transactionId)].join(','))
    }
    rows.push([`${KIND_LABEL[kind]} 合計`, '', '', '', String(total), ''].join(','))
  }
  if (report.medicalDeductionJpy != null) rows.push(['医療費控除額（参考）', '', '', '', String(report.medicalDeductionJpy), ''].join(','))
  rows.push('"※ 申告の候補です。保険金などで補填された額や対象外の支出は、申告前に確認してください。"')
  return `\uFEFF${rows.join('\r\n')}\r\n`
}
