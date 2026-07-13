import { normalizeHeader, rowObject, tokenizeCsv, type CsvRow } from '../csv'
import { normalizeJapaneseText, parseJapaneseAmount, parseJapaneseDate } from '../normalize'
import type { BrokerageEventCandidate, BrokerageEventLegCandidate, ImportAdapter, ParseIssue } from '../types'

const REQUIRED_HEADERS = [
  '約定日', '銘柄', '口座', '取引', '売買', '数量', '単価', '手数料', '税金', '諸費用', '税区分', '受渡金額',
] as const

const MARKETS = [
  'ジャパンネクストPTS', 'JAXPTS', 'TOSTNET', '市場外', '東証', '名証', '福証', '札証', 'JAX', 'JNX', 'PTS',
] as const

function normalizedHeaders(row: CsvRow): string[] {
  return row.fields.map(normalizeHeader)
}

function findHeader(rows: readonly CsvRow[]): number {
  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const headers = normalizedHeaders(rows[index])
    if (REQUIRED_HEADERS.every((header) => headers.includes(header))) return index
  }
  return -1
}

function amount(raw: string): number | null {
  const parsed = parseJapaneseAmount(raw)
  return parsed != null && Number.isFinite(parsed) && parsed >= 0 ? Math.abs(parsed) : null
}

function positiveAmount(raw: string): number | null {
  const parsed = amount(raw)
  return parsed != null && parsed > 0 ? parsed : null
}

function classifySpot(rawTrade: string, rawSide: string): 'BUY' | 'SELL' | 'UNSUPPORTED_MARGIN' | null {
  const trade = normalizeJapaneseText(rawTrade).replace(/\s+/g, '')
  const side = normalizeJapaneseText(rawSide).replace(/\s+/g, '')
  if (/信用|現引|現渡/.test(trade) || /信用|売埋|買埋/.test(side)) return 'UNSUPPORTED_MARGIN'
  if (trade !== '現物' && trade !== '現物(単元未満)' && trade !== '現物（単元未満）') return null
  if (side === '買付' || side === '買') return 'BUY'
  if (side === '売付' || side === '売') return 'SELL'
  return null
}

interface Security {
  code: string
  name: string
  market: string
}

function removeToken(text: string, token: string): string {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(escaped, 'ig'), ' ').replace(/[()（）]/g, ' ').replace(/\s+/g, ' ').trim()
}

function parseSecurity(raw: string): Security | null {
  const normalized = normalizeJapaneseText(raw)
  const code = normalized.match(/(?:^|[\s(（])([0-9][0-9A-Z]{3})(?=$|[\s)）])/i)?.[1]
  if (!code) return null
  const upper = normalized.toUpperCase()
  const market = MARKETS.find((candidate) => upper.includes(candidate)) ?? ''
  let name = removeToken(normalized, code)
  if (market) name = removeToken(name, market)
  return name ? { code: code.toUpperCase(), name, market } : null
}

function buildLegs(
  eventType: 'BUY' | 'SELL',
  security: Security,
  quantity: number,
  gross: number,
  fee: number,
  tax: number,
  settlement: number,
): { legs: BrokerageEventLegCandidate[]; difference: number } {
  const legs: BrokerageEventLegCandidate[] = eventType === 'BUY'
    ? [
      { kind: 'SECURITY', signedAmount: gross, currency: 'JPY', instrumentCode: security.code, instrumentName: security.name, signedQuantity: quantity, description: 'Rakuten domestic spot security acquired' },
      { kind: 'CASH', signedAmount: -settlement, currency: 'JPY', description: 'Rakuten domestic spot trade cash settlement' },
    ]
    : [
      { kind: 'SECURITY', signedAmount: -gross, currency: 'JPY', instrumentCode: security.code, instrumentName: security.name, signedQuantity: -quantity, description: 'Rakuten domestic spot security disposed' },
      { kind: 'CASH', signedAmount: settlement, currency: 'JPY', description: 'Rakuten domestic spot trade cash settlement' },
    ]
  if (fee > 0) legs.push({ kind: 'INVESTMENT_EXPENSE', signedAmount: fee, currency: 'JPY', description: 'Rakuten source fee and other expenses' })
  if (tax > 0) legs.push({ kind: 'INVESTMENT_TAX', signedAmount: tax, currency: 'JPY', description: 'Rakuten source tax' })
  const difference = legs.reduce((sum, leg) => sum + leg.signedAmount, 0)
  if (Math.abs(difference) >= 0.000001) {
    legs.push({ kind: 'ADJUSTMENT', signedAmount: -difference, currency: 'JPY', description: 'Rakuten source settlement difference' })
  }
  return { legs, difference }
}

export const rakutenSecuritiesDomesticTradeHistoryAdapter: ImportAdapter<BrokerageEventCandidate> = {
  id: 'rakuten-securities-domestic-trade-history-v1',
  detect(input) {
    const csv = tokenizeCsv(input.text)
    const headerIndex = findHeader(csv.rows)
    if (headerIndex < 0) return { adapterId: this.id, score: 0, reasons: ['Exact Rakuten Securities domestic trade-history field family not found'] }
    return { adapterId: this.id, score: 1, reasons: ['Exact Rakuten Securities domestic trade-history field family matched'] }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text)
    const issues: ParseIssue[] = [...csv.issues]
    const headerIndex = findHeader(csv.rows)
    if (headerIndex < 0) {
      return { adapterId: this.id, records: [], issues: [...issues, { code: 'RAKUTEN_SECURITIES_HEADER_MISSING', message: 'Exact Rakuten Securities domestic trade-history fields were not found.', severity: 'error' }], metadata: {} }
    }
    const headerRow = csv.rows[headerIndex]
    const headers = normalizedHeaders(headerRow)
    const records: BrokerageEventCandidate[] = []
    for (const row of csv.rows.slice(headerIndex + 1)) {
      const values = rowObject(headers, row)
      if (Object.values(values).every((item) => !item.trim())) continue
      const rawTrade = normalizeJapaneseText(values['取引'] ?? '')
      const rawSide = normalizeJapaneseText(values['売買'] ?? '')
      const eventType = classifySpot(rawTrade, rawSide)
      if (eventType === 'UNSUPPORTED_MARGIN') {
        issues.push({ code: 'RAKUTEN_SECURITIES_MARGIN_UNSUPPORTED', message: `Rakuten margin, delivery, or receipt trade is not supported: ${rawTrade} ${rawSide}`.trim(), severity: 'error', row: row.sourceRow })
        continue
      }
      if (!eventType) {
        issues.push({ code: 'RAKUTEN_SECURITIES_TRADE_UNSUPPORTED', message: `Only explicit Rakuten spot buy/sell trades are supported: ${rawTrade} ${rawSide}`.trim(), severity: 'warning', row: row.sourceRow })
        continue
      }
      const tradeDate = parseJapaneseDate(values['約定日'] ?? '')
      const security = parseSecurity(values['銘柄'] ?? '')
      const quantity = positiveAmount(values['数量'] ?? '')
      const unitPrice = positiveAmount(values['単価'] ?? '')
      const commission = amount(values['手数料'] ?? '')
      const tax = amount(values['税金'] ?? '')
      const otherExpense = amount(values['諸費用'] ?? '')
      const settlement = positiveAmount(values['受渡金額'] ?? '')
      if (!tradeDate || !security || quantity == null || unitPrice == null || commission == null || tax == null || otherExpense == null || settlement == null) {
        issues.push({ code: 'RAKUTEN_SECURITIES_VALUE_INVALID', message: 'Rakuten spot trade requires an unambiguous date, security, positive quantity/unit price/settlement, and non-negative fee, tax, and other-expense fields.', severity: 'warning', row: row.sourceRow })
        continue
      }
      const gross = quantity * unitPrice
      const fee = commission + otherExpense
      if (![gross, fee, tax, settlement].every(Number.isSafeInteger)) {
        issues.push({ code: 'RAKUTEN_SECURITIES_VALUE_INVALID', message: 'Rakuten domestic JPY values must resolve to safe integers.', severity: 'warning', row: row.sourceRow })
        continue
      }
      const built = buildLegs(eventType, security, quantity, gross, fee, tax, settlement)
      if (Math.abs(built.difference) >= 0.000001) {
        issues.push({ code: 'RAKUTEN_SECURITIES_SETTLEMENT_MISMATCH', message: `Settlement differs from quantity × unit price and source costs by ${built.difference} JPY.`, severity: 'warning', row: row.sourceRow, column: '受渡金額' })
      }
      records.push({
        kind: 'brokerage-event', lineage: row, accountHint: input.accountHint, eventType,
        tradeDate, settlementDate: null, instrumentCode: security.code, instrumentName: security.name,
        ...(security.market ? { market: security.market } : {}),
        accountType: normalizeJapaneseText(values['口座'] ?? ''), currency: 'JPY', quantity, unitPrice,
        grossAmount: gross, feeAmount: fee, taxAmount: tax, settlementAmount: settlement,
        legs: built.legs, reconciliationStatus: Math.abs(built.difference) < 0.000001 ? 'BALANCED' : 'ADJUSTED',
        reconciliationDifference: built.difference, affectsHouseholdExpense: false,
        rawTransactionType: `${rawTrade} ${rawSide}`.trim(),
      })
    }
    return { adapterId: this.id, records, issues, metadata: { ledgerKind: 'INVESTMENT', provider: 'RAKUTEN_SECURITIES', marketScope: 'DOMESTIC', headerRow: headerRow.sourceRow, delimiter: csv.delimiter } }
  },
}
