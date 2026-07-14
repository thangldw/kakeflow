import { normalizeHeader, rowObject, tokenizeCsv, type CsvRow } from '../csv'
import { normalizeJapaneseText, parseJapaneseAmount, parseJapaneseDate } from '../normalize'
import type { BrokerageEventCandidate, BrokerageEventLegCandidate, ImportAdapter, ParseIssue } from '../types'

const FIRST_SUPPORTED_TRADE_DATE = '2026-02-16'

// Monex publishes these detail-screen field names, but not a literal CSV byte
// schema. This screen-derived allowlist is intentionally exact. NFKC permits
// the published full-width punctuation without widening the contract.
const REQUIRED_HEADERS = [
  'ティッカー+銘柄名(または通貨名)',
  '受渡日',
  '約定日',
  '取引種別',
  '売買',
  '口座区分',
  '取引通貨',
  '約定数量[株]',
  '約定値段[ドル]',
  '約定金額[ドル]',
  '約定金額[円]',
  '受渡金額[ドル]',
  '受渡金額[円]',
  '税計算用受渡金額[円]',
  '手数料(税込)[ドル]',
  '為替レート',
] as const

function normalizedHeaders(row: CsvRow): string[] {
  return row.fields.map(normalizeHeader)
}

function findHeader(rows: readonly CsvRow[]): number {
  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const headers = normalizedHeaders(rows[index])
    if (headers.length === REQUIRED_HEADERS.length && REQUIRED_HEADERS.every((header, headerIndex) => headers[headerIndex] === header)) return index
  }
  return -1
}

function amount(raw: string): number | null {
  const parsed = parseJapaneseAmount(raw)
  return parsed != null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function positiveAmount(raw: string): number | null {
  const parsed = amount(raw)
  return parsed != null && parsed > 0 ? parsed : null
}

function parseSecurity(raw: string): { code: string; name: string } | null {
  const normalized = normalizeJapaneseText(raw)
  const match = normalized.match(/^([A-Z][A-Z0-9./-]{0,9})\s+(.+)$/i)
  if (!match) return null
  const code = match[1].toUpperCase()
  const name = match[2].trim()
  return name ? { code, name } : null
}

function buildLegs(
  eventType: 'BUY' | 'SELL',
  security: { code: string; name: string },
  quantity: number,
  gross: number,
  fee: number,
  settlement: number,
): { legs: BrokerageEventLegCandidate[]; difference: number } {
  const legs: BrokerageEventLegCandidate[] = eventType === 'BUY'
    ? [
      { kind: 'SECURITY', signedAmount: gross, currency: 'USD', instrumentCode: security.code, instrumentName: security.name, signedQuantity: quantity, description: 'Monex U.S. spot security acquired' },
      { kind: 'CASH', signedAmount: -settlement, currency: 'USD', description: 'Monex U.S. spot trade cash settlement' },
    ]
    : [
      { kind: 'SECURITY', signedAmount: -gross, currency: 'USD', instrumentCode: security.code, instrumentName: security.name, signedQuantity: -quantity, description: 'Monex U.S. spot security disposed' },
      { kind: 'CASH', signedAmount: settlement, currency: 'USD', description: 'Monex U.S. spot trade cash settlement' },
    ]
  if (fee > 0) legs.push({ kind: 'INVESTMENT_EXPENSE', signedAmount: fee, currency: 'USD', description: 'Monex source commission including tax' })
  const difference = legs.reduce((sum, leg) => sum + leg.signedAmount, 0)
  if (Math.abs(difference) >= 0.000001) {
    legs.push({ kind: 'ADJUSTMENT', signedAmount: -difference, currency: 'USD', description: 'Monex source settlement difference' })
  }
  return { legs, difference }
}

function rowIssue(code: string, message: string, row: CsvRow, column?: string): ParseIssue {
  return { code, message, severity: 'error', row: row.sourceRow, ...(column ? { column } : {}) }
}

export const monexUsStockTradeHistoryAdapter: ImportAdapter<BrokerageEventCandidate> = {
  id: 'monex-us-stock-trade-history-v1',
  detect(input) {
    const csv = tokenizeCsv(input.text)
    const headerIndex = findHeader(csv.rows)
    if (headerIndex < 0) return { adapterId: this.id, score: 0, reasons: ['Complete post-renewal Monex U.S.-stock history field family not found'] }
    return { adapterId: this.id, score: 1, reasons: ['Complete post-renewal Monex U.S.-stock history field family matched'] }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text)
    const issues: ParseIssue[] = [...csv.issues]
    const headerIndex = findHeader(csv.rows)
    if (headerIndex < 0) {
      return { adapterId: this.id, records: [], issues: [...issues, { code: 'MONEX_US_HEADER_MISSING', message: 'The complete post-renewal Monex U.S.-stock history fields were not found.', severity: 'error' }], metadata: {} }
    }
    const headerRow = csv.rows[headerIndex]
    const headers = normalizedHeaders(headerRow)
    const records: BrokerageEventCandidate[] = []

    for (const row of csv.rows.slice(headerIndex + 1)) {
      if (row.fields.length !== REQUIRED_HEADERS.length) {
        issues.push(rowIssue('MONEX_US_ROW_SPARSE', `Monex row must contain exactly ${REQUIRED_HEADERS.length} fields.`, row))
        continue
      }
      const values = rowObject(headers, row)
      const rawTradeType = normalizeJapaneseText(values['取引種別'] ?? '').replace(/\s+/g, '')
      if (/信用/.test(rawTradeType)) {
        issues.push(rowIssue('MONEX_US_MARGIN_UNSUPPORTED', 'Monex U.S. margin/credit activity is not supported.', row, '取引種別'))
        continue
      }
      if (rawTradeType !== '現物') {
        issues.push(rowIssue('MONEX_US_EVENT_UNSUPPORTED', `Only Monex U.S. spot activity is supported: ${rawTradeType || '(empty)'}`, row, '取引種別'))
        continue
      }
      const rawSide = normalizeJapaneseText(values['売買'] ?? '').replace(/\s+/g, '')
      const eventType = rawSide === '買' ? 'BUY' : rawSide === '売' ? 'SELL' : null
      if (!eventType) {
        issues.push(rowIssue('MONEX_US_SIDE_UNSUPPORTED', `Monex spot side must be exactly 買 or 売: ${rawSide || '(empty)'}`, row, '売買'))
        continue
      }
      const accountType = normalizeJapaneseText(values['口座区分'] ?? '').replace(/\s+/g, '')
      if (!['一般', '特定', 'NISA'].includes(accountType)) {
        issues.push(rowIssue('MONEX_US_ACCOUNT_UNSUPPORTED', `Monex account must be 一般, 特定, or NISA: ${accountType || '(empty)'}`, row, '口座区分'))
        continue
      }
      const rawCurrency = normalizeJapaneseText(values['取引通貨'] ?? '').toUpperCase().replace(/\s+/g, '')
      if (rawCurrency === '円' || rawCurrency === 'JPY' || rawCurrency === '日本円') {
        issues.push(rowIssue('MONEX_US_JPY_SETTLEMENT_UNSUPPORTED', 'Yen-settled Monex U.S. trades require a dual-currency ledger contract and are not supported by this adapter.', row, '取引通貨'))
        continue
      }
      if (rawCurrency !== 'USD' && rawCurrency !== '米ドル') {
        issues.push(rowIssue('MONEX_US_CURRENCY_UNSUPPORTED', `Monex transaction currency must be USD or 米ドル: ${rawCurrency || '(empty)'}`, row, '取引通貨'))
        continue
      }

      const tradeDate = parseJapaneseDate(values['約定日'] ?? '')
      const settlementDate = parseJapaneseDate(values['受渡日'] ?? '')
      const security = parseSecurity(values['ティッカー+銘柄名(または通貨名)'] ?? '')
      const quantity = positiveAmount(values['約定数量[株]'] ?? '')
      const unitPrice = positiveAmount(values['約定値段[ドル]'] ?? '')
      const gross = positiveAmount(values['約定金額[ドル]'] ?? '')
      const settlement = positiveAmount(values['受渡金額[ドル]'] ?? '')
      const fee = amount(values['手数料(税込)[ドル]'] ?? '')
      const grossJpy = positiveAmount(values['約定金額[円]'] ?? '')
      const settlementJpy = positiveAmount(values['受渡金額[円]'] ?? '')
      const taxBasisJpy = positiveAmount(values['税計算用受渡金額[円]'] ?? '')
      const exchangeRate = positiveAmount(values['為替レート'] ?? '')
      if (!tradeDate || !settlementDate || tradeDate < FIRST_SUPPORTED_TRADE_DATE || settlementDate < tradeDate || !security || quantity == null || unitPrice == null || gross == null || settlement == null || fee == null || grossJpy == null || settlementJpy == null || taxBasisJpy == null || exchangeRate == null) {
        issues.push(rowIssue('MONEX_US_ROW_INVALID', 'Monex spot row requires post-2026-02-16 dates, ticker and name, positive source amounts in both displayed currencies, a non-negative USD fee, and a positive source FX rate.', row))
        continue
      }

      const built = buildLegs(eventType, security, quantity, gross, fee, settlement)
      if (Math.abs(built.difference) >= 0.000001) {
        issues.push({ code: 'MONEX_US_SETTLEMENT_MISMATCH', message: `Source USD settlement differs from source gross and fee by ${built.difference} USD; an auditable adjustment was added.`, severity: 'warning', row: row.sourceRow, column: '受渡金額[ドル]' })
      }
      records.push({
        kind: 'brokerage-event', lineage: row, accountHint: input.accountHint, eventType,
        tradeDate, settlementDate, instrumentCode: security.code, instrumentName: security.name,
        accountType, currency: 'USD', quantity, unitPrice, grossAmount: gross, feeAmount: fee,
        // 税計算用受渡金額[円] is a tax-basis amount, not a source tax charge.
        taxAmount: 0, settlementAmount: settlement, legs: built.legs,
        reconciliationStatus: Math.abs(built.difference) < 0.000001 ? 'BALANCED' : 'ADJUSTED',
        reconciliationDifference: built.difference, affectsHouseholdExpense: false,
        rawTransactionType: `${rawTradeType} ${rawSide}`,
      })
    }

    return {
      adapterId: this.id, records, issues,
      metadata: {
        ledgerKind: 'INVESTMENT', provider: 'MONEX_SECURITIES', marketScope: 'US', currencyScope: 'USD_SETTLEMENT_ONLY',
        sourceContract: 'SCREEN_DERIVED_POST_RENEWAL_2026_02', validationBasis: 'SYNTHETIC_FIXTURE',
        headerRow: headerRow.sourceRow, delimiter: csv.delimiter,
      },
    }
  },
}
