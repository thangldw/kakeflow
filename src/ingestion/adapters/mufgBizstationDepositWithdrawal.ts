import { normalizeHeader, tokenizeCsv } from '../csv'
import { normalizeJapaneseText, parseJapaneseAmount, parseJapaneseDate } from '../normalize'
import type { BankTransactionCandidate, ImportAdapter, ParseIssue } from '../types'

const HEADERS = [
  '金融機関コード', '金融機関名', '支店コード', '支店名', '科目', '口座番号', '口座名',
  '取引日', '入払区分', '取引区分', '取引金額', '内他店券金額', '手形・小切手区分',
  '手形・小切手番号', '振込依頼人番号', '振込依頼人名', '仕向金融機関名',
  '仕向支店名', '摘要', 'EDI情報',
] as const

const NORMALIZED_HEADERS = HEADERS.map(normalizeHeader)
const CARD_PAYMENT = /(カード|CARD|JCB|AMEX|アメックス)/i
const MUFG_KANA = 'ミツビシユエフジエイ'
const SUPPORTED_REIWA_YEAR = 8

function normalized(value: string | undefined): string {
  return normalizeJapaneseText(value ?? '')
}

function exactHeader(fields: readonly string[]): boolean {
  return fields.length === NORMALIZED_HEADERS.length
    && fields.map(normalizeHeader).every((field, index) => field === NORMALIZED_HEADERS[index])
}

function fixedDigits(value: string | undefined, width: number): string | null {
  const normalizedValue = (value ?? '').normalize('NFKC').trim()
  return new RegExp(`^\\d{${width}}$`).test(normalizedValue) ? normalizedValue : null
}

function positiveJpy(value: string | undefined): number | null {
  const normalizedValue = (value ?? '').normalize('NFKC').trim()
  const parsed = parseJapaneseAmount(normalizedValue)
  return /^\d{12}$/.test(normalizedValue) && parsed != null && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function nonNegativeJpy(value: string | undefined): number | null {
  const normalizedValue = (value ?? '').normalize('NFKC').trim()
  const parsed = parseJapaneseAmount(normalizedValue)
  return /^\d{12}$/.test(normalizedValue) && parsed != null && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

/**
 * The official field is an era-less six-digit Japanese-calendar date. V1 only
 * accepts the unambiguous Reiwa window covered when this adapter shipped.
 */
function supportedReiwaDate(value: string | undefined): string | null {
  const compact = fixedDigits(value, 6)
  if (!compact) return null
  const eraYear = Number(compact.slice(0, 2))
  if (eraYear < 1 || eraYear > SUPPORTED_REIWA_YEAR) return null
  return parseJapaneseDate(`${2018 + eraYear}-${compact.slice(2, 4)}-${compact.slice(4, 6)}`)
}

function sourceDescription(fields: readonly string[]): { description: string; detail: string } {
  const description = normalized(fields[18]) || normalized(fields[15]) || normalized(fields[9])
  const detail = [fields[15], fields[16], fields[17], fields[19]].map(normalized).filter(Boolean).join(' / ')
  return { description, detail }
}

export const mufgBizstationDepositWithdrawalAdapter: ImportAdapter<BankTransactionCandidate> = {
  id: 'mufg-bizstation-deposit-withdrawal-v1',
  detect(input) {
    const header = tokenizeCsv(input.text).rows[0]
    const detail = tokenizeCsv(input.text).rows[1]
    const matched = header != null && exactHeader(header.fields)
      && detail?.fields.length === HEADERS.length
      && detail.fields[0] === '0005'
    return {
      adapterId: this.id,
      score: matched ? 1 : 0,
      reasons: [matched ? 'Exact MUFG BizSTATION deposit/withdrawal header and institution code matched' : 'Exact MUFG BizSTATION deposit/withdrawal structure not found'],
    }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text)
    const issues: ParseIssue[] = [...csv.issues]
    if (!exactHeader(csv.rows[0]?.fields ?? [])) {
      return {
        adapterId: this.id,
        records: [],
        issues: [...issues, { code: 'MUFG_BIZSTATION_DW_HEADER_INVALID', message: 'Exact MUFG BizSTATION deposit/withdrawal header was not found.', severity: 'error' }],
        metadata: {},
      }
    }

    const records: BankTransactionCandidate[] = []
    let accountFingerprint: string | null = null
    for (const row of csv.rows.slice(1)) {
      if (row.fields.length !== HEADERS.length) {
        issues.push({ code: 'MUFG_BIZSTATION_DW_ROW_WIDTH_INVALID', message: 'Every detail record must contain exactly twenty fields.', severity: 'error', row: row.sourceRow })
        continue
      }

      const bankCode = fixedDigits(row.fields[0], 4)
      const branchCode = fixedDigits(row.fields[2], 3)
      const accountType = fixedDigits(row.fields[4], 1)
      const accountNumber = fixedDigits(row.fields[5], 10)
      const bankName = normalized(row.fields[1]).replaceAll('-', '')
      if (bankCode !== '0005' || bankName !== MUFG_KANA) {
        issues.push({ code: 'MUFG_BIZSTATION_DW_INSTITUTION_INVALID', message: 'The official MUFG institution code and name are required.', severity: 'error', row: row.sourceRow })
      }
      if (!branchCode || !accountNumber || !['1', '2'].includes(accountType ?? '')) {
        issues.push({ code: 'MUFG_BIZSTATION_DW_ACCOUNT_INVALID', message: 'Branch, account type, or padded account number is invalid.', severity: 'error', row: row.sourceRow })
      }
      const nextFingerprint = branchCode && accountType && accountNumber ? `${branchCode}:${accountType}:${accountNumber}` : null
      if (nextFingerprint && accountFingerprint && nextFingerprint !== accountFingerprint) {
        issues.push({ code: 'MUFG_BIZSTATION_DW_ACCOUNT_MIXED', message: 'One export must not mix multiple source accounts.', severity: 'error', row: row.sourceRow })
      } else if (nextFingerprint) accountFingerprint = nextFingerprint

      const transactionDate = supportedReiwaDate(row.fields[7])
      if (!transactionDate) {
        issues.push({
          code: 'MUFG_BIZSTATION_DW_DATE_UNSUPPORTED',
          message: 'The era-less transaction date is invalid or outside the explicitly supported Reiwa 1-8 window.',
          severity: 'error', row: row.sourceRow, column: '取引日',
        })
      }
      const direction = fixedDigits(row.fields[8], 1)
      if (!['1', '2'].includes(direction ?? '')) {
        issues.push({ code: 'MUFG_BIZSTATION_DW_DIRECTION_INVALID', message: 'Deposit/payment classification must be 1 or 2.', severity: 'error', row: row.sourceRow, column: '入払区分' })
      }
      const transactionClass = fixedDigits(row.fields[9], 2)
      if (!['10', '11', '12', '13', '14', '18', '19'].includes(transactionClass ?? '')) {
        issues.push({ code: 'MUFG_BIZSTATION_DW_CLASS_INVALID', message: 'The transaction classification is not part of the official code set.', severity: 'error', row: row.sourceRow, column: '取引区分' })
      }
      const amount = positiveJpy(row.fields[10])
      const otherBankInstrumentAmount = nonNegativeJpy(row.fields[11])
      if (amount == null || otherBankInstrumentAmount == null || (otherBankInstrumentAmount ?? 0) > (amount ?? 0)) {
        issues.push({ code: 'MUFG_BIZSTATION_DW_AMOUNT_INVALID', message: 'Transaction and other-bank instrument amounts must be padded safe-integer JPY values.', severity: 'error', row: row.sourceRow })
      }
      const { description, detail } = sourceDescription(row.fields)
      records.push({
        kind: 'bank-transaction', lineage: row,
        ...(input.accountHint ? { accountHint: input.accountHint } : {}),
        transactionDate,
        description,
        descriptionDetail: detail,
        outgoingAmount: direction === '2' ? amount : null,
        incomingAmount: direction === '1' ? amount : null,
        balance: null,
        memo: '', fundsAvailabilityCode: '', debitCreditCode: direction ?? '',
        suggestedType: direction === '2' && CARD_PAYMENT.test(description) ? 'CARD_PAYMENT' : 'UNKNOWN',
      })
    }

    if (records.length === 0) issues.push({ code: 'MUFG_BIZSTATION_DW_DETAILS_MISSING', message: 'At least one detail record is required.', severity: 'error' })
    return {
      adapterId: this.id,
      records,
      issues,
      metadata: {
        institution: 'MUFG_BANK', product: 'BIZSTATION_DEPOSIT_WITHDRAWAL', delimiter: csv.delimiter,
        sourceEncoding: 'SHIFT_JIS', sourceDateCalendar: 'JAPANESE_ERA', supportedReiwaThrough: SUPPORTED_REIWA_YEAR,
        accountType: csv.rows[1]?.fields[4] === '1' ? '普通預金' : csv.rows[1]?.fields[4] === '2' ? '当座預金' : null,
        durableTransactionIdAvailable: false, balanceAvailable: false,
      },
    }
  },
}
