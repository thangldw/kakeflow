import { normalizeHeader, rowObject, tokenizeCsv, type CsvRow } from '../csv'
import { normalizeJapaneseText, parseJapaneseAmount, parseJapaneseDate } from '../normalize'
import type { BrokerageEventCandidate, BrokerageEventLegCandidate, ImportAdapter, ParseIssue } from '../types'

const SETTLEMENT_HEADERS = ['受渡金額/決済損益', '受渡金額'] as const
const OPTIONAL_CURRENCY_HEADERS = ['決済通貨', '通貨'] as const

const DOMESTIC_HEADERS = ['約定日', '銘柄', '取引', '預り', '約定数量', '約定単価', '受渡日'] as const
const FOREIGN_HEADERS = ['国内約定日', '銘柄', '商品区分', '注文種別', '取引', '預り区分', '約定数量', '約定単価', '国内受渡日'] as const

type Layout = 'DOMESTIC' | 'FOREIGN'

const DOMESTIC_MARKETS = ['東証', '名証', '福証', '札証', 'JNX', 'JAPANNEXT', 'PTS', 'OSE'] as const
const FOREIGN_MARKETS = ['NYSE ARCA', 'NYSEAMERICAN', 'NASDAQ', 'NYSE', 'AMEX', 'OTC', 'HKEX', 'KOSPI', 'KOSDAQ', 'SGX', 'SET', 'BURSA', 'HOSE', 'HNX', 'IDX'] as const

function normalizedHeaders(row: CsvRow): string[] {
  return row.fields.map(normalizeHeader)
}

function includesAll(headers: readonly string[], required: readonly string[]): boolean {
  return required.every((header) => headers.includes(header))
}

function settlementHeader(headers: readonly string[]): string | null {
  return SETTLEMENT_HEADERS.find((header) => headers.includes(header)) ?? null
}

function detectLayout(rows: readonly CsvRow[]): { headerIndex: number; layout: Layout } | null {
  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const headers = normalizedHeaders(rows[index])
    if (!settlementHeader(headers)) continue
    if (includesAll(headers, FOREIGN_HEADERS)) return { headerIndex: index, layout: 'FOREIGN' }
    if (includesAll(headers, DOMESTIC_HEADERS)) return { headerIndex: index, layout: 'DOMESTIC' }
  }
  return null
}

function value(values: Readonly<Record<string, string>>, ...headers: readonly string[]): string {
  for (const header of headers) {
    if ((values[header] ?? '').trim()) return values[header]
  }
  return ''
}

function positiveAmount(raw: string): number | null {
  const parsed = parseJapaneseAmount(raw)
  return parsed != null && Number.isFinite(parsed) && Math.abs(parsed) > 0 ? Math.abs(parsed) : null
}

function classifySpot(rawTransaction: string, orderType: string): 'BUY' | 'SELL' | 'UNSUPPORTED_MARGIN' | null {
  const transaction = normalizeJapaneseText(rawTransaction)
  const order = normalizeJapaneseText(orderType)
  const combined = `${order} ${transaction}`
  if (/信用|信買|信売|制度信用|一般信用|返済|現引|現渡/.test(combined)) return 'UNSUPPORTED_MARGIN'
  if (transaction === '株式現物買' || transaction === '現買') return 'BUY'
  if (transaction === '株式現物売' || transaction === '現売') return 'SELL'
  if (/現物/.test(order) && transaction === '買付') return 'BUY'
  if (/現物/.test(order) && transaction === '売却') return 'SELL'
  return null
}

interface ParsedSecurity {
  code: string
  name: string
  market: string
}

function removeToken(text: string, token: string): string {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(escaped, 'i'), ' ').replace(/[()（）]/g, ' ').replace(/\s+/g, ' ').trim()
}

function parseDomesticSecurity(raw: string): ParsedSecurity | null {
  const normalized = normalizeJapaneseText(raw)
  const codeMatch = normalized.match(/(?:^|[\s(（])([0-9][0-9A-Z]{3})(?=$|[\s)）])/i)
  if (!codeMatch) return null
  const market = DOMESTIC_MARKETS.find((candidate) => normalized.toUpperCase().includes(candidate)) ?? ''
  let name = removeToken(normalized, codeMatch[1])
  if (market) name = removeToken(name, market)
  return name ? { code: codeMatch[1].toUpperCase(), name, market } : null
}

function parseForeignSecurity(raw: string): ParsedSecurity | null {
  const normalized = normalizeJapaneseText(raw)
  const upper = normalized.toUpperCase()
  const market = FOREIGN_MARKETS.find((candidate) => upper.includes(candidate)) ?? ''
  let withoutMarket = market ? removeToken(normalized, market) : normalized
  const parenthesized = withoutMarket.match(/[（(]([A-Z][A-Z0-9.-]{0,9})[）)]/)
  const tokens = withoutMarket.split(/\s+/)
  const ticker = parenthesized?.[1] ?? [...tokens].reverse().find((token) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(token))
  if (!ticker) return null
  withoutMarket = removeToken(withoutMarket, ticker)
  return withoutMarket ? { code: ticker.toUpperCase(), name: withoutMarket, market } : null
}

function currencyFor(values: Readonly<Record<string, string>>, layout: Layout): string | null {
  const explicit = normalizeJapaneseText(value(values, ...OPTIONAL_CURRENCY_HEADERS)).toUpperCase()
  if (explicit) {
    if (/^[A-Z]{3}$/.test(explicit)) return explicit
    const labels: readonly [RegExp, string][] = [
      [/^(?:円貨|日本円|円)$/, 'JPY'], [/^(?:米ドル|USドル)$/, 'USD'], [/^香港ドル$/, 'HKD'],
      [/^韓国ウォン$/, 'KRW'], [/^ベトナムドン$/, 'VND'], [/^インドネシアルピア$/, 'IDR'],
      [/^シンガポールドル$/, 'SGD'], [/^タイバーツ$/, 'THB'], [/^マレーシアリンギット$/, 'MYR'],
    ]
    return labels.find(([pattern]) => pattern.test(explicit))?.[1] ?? null
  }
  if (layout === 'DOMESTIC') return 'JPY'
  const product = normalizeJapaneseText(values['商品区分'] ?? '')
  if (/米国/.test(product)) return 'USD'
  if (/中国|香港/.test(product)) return 'HKD'
  if (/韓国/.test(product)) return 'KRW'
  if (/ベトナム/.test(product)) return 'VND'
  if (/インドネシア/.test(product)) return 'IDR'
  if (/シンガポール/.test(product)) return 'SGD'
  if (/タイ/.test(product)) return 'THB'
  if (/マレーシア/.test(product)) return 'MYR'
  return null
}

function buildLegs(
  eventType: 'BUY' | 'SELL',
  currency: string,
  security: ParsedSecurity,
  quantity: number,
  gross: number,
  settlement: number,
): { legs: BrokerageEventLegCandidate[]; difference: number } {
  const legs: BrokerageEventLegCandidate[] = eventType === 'BUY'
    ? [
      { kind: 'SECURITY', signedAmount: gross, currency, instrumentCode: security.code, instrumentName: security.name, signedQuantity: quantity, description: 'SBI spot security acquired' },
      { kind: 'CASH', signedAmount: -settlement, currency, description: 'SBI spot trade cash settlement' },
    ]
    : [
      { kind: 'SECURITY', signedAmount: -gross, currency, instrumentCode: security.code, instrumentName: security.name, signedQuantity: -quantity, description: 'SBI spot security disposed' },
      { kind: 'CASH', signedAmount: settlement, currency, description: 'SBI spot trade cash settlement' },
    ]
  const difference = legs.reduce((sum, leg) => sum + leg.signedAmount, 0)
  if (Math.abs(difference) >= 0.000001) {
    legs.push({ kind: 'ADJUSTMENT', signedAmount: -difference, currency, description: 'SBI source settlement difference (fees, taxes, or FX not itemized)' })
  }
  return { legs, difference }
}

export const sbiSecuritiesTradeHistoryAdapter: ImportAdapter<BrokerageEventCandidate> = {
  id: 'sbi-securities-trade-history-v1',
  detect(input) {
    const csv = tokenizeCsv(input.text)
    const detected = detectLayout(csv.rows)
    if (!detected) return { adapterId: this.id, score: 0, reasons: ['Exact SBI trade-history field family not found'] }
    return {
      adapterId: this.id,
      score: 1,
      reasons: [`Exact SBI ${detected.layout.toLowerCase()} trade-history field family matched`],
    }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text)
    const issues: ParseIssue[] = [...csv.issues]
    const detected = detectLayout(csv.rows)
    if (!detected) {
      return { adapterId: this.id, records: [], issues: [...issues, { code: 'SBI_TRADE_HEADER_MISSING', message: 'Exact SBI domestic or foreign trade-history fields were not found.', severity: 'error' }], metadata: {} }
    }
    const headerRow = csv.rows[detected.headerIndex]
    const headers = normalizedHeaders(headerRow)
    const settlement = settlementHeader(headers)!
    const records: BrokerageEventCandidate[] = []

    for (const row of csv.rows.slice(detected.headerIndex + 1)) {
      const values = rowObject(headers, row)
      const rawTransactionType = normalizeJapaneseText(values['取引'] ?? '')
      const eventType = classifySpot(rawTransactionType, values['注文種別'] ?? '')
      if (eventType === 'UNSUPPORTED_MARGIN') {
        issues.push({ code: 'SBI_MARGIN_TRADE_UNSUPPORTED', message: `SBI margin/credit trade is not supported: ${rawTransactionType || '(empty)'}`, severity: 'error', row: row.sourceRow, column: '取引' })
        continue
      }
      if (!eventType) {
        issues.push({ code: 'SBI_TRADE_TYPE_UNSUPPORTED', message: `Only explicit SBI spot buy/sell trades are supported: ${rawTransactionType || '(empty)'}`, severity: 'warning', row: row.sourceRow, column: '取引' })
        continue
      }

      const security = detected.layout === 'DOMESTIC'
        ? parseDomesticSecurity(values['銘柄'] ?? '')
        : parseForeignSecurity(values['銘柄'] ?? '')
      if (!security) {
        issues.push({ code: 'SBI_SECURITY_INVALID', message: 'The combined SBI security field does not contain an unambiguous code/ticker and name.', severity: 'warning', row: row.sourceRow, column: '銘柄' })
        continue
      }
      const tradeDateRaw = value(values, detected.layout === 'DOMESTIC' ? '約定日' : '国内約定日')
      const settlementDateRaw = value(values, detected.layout === 'DOMESTIC' ? '受渡日' : '国内受渡日')
      const tradeDate = parseJapaneseDate(tradeDateRaw)
      const settlementDate = parseJapaneseDate(settlementDateRaw)
      const quantity = positiveAmount(values['約定数量'] ?? '')
      const unitPrice = positiveAmount(values['約定単価'] ?? '')
      const settlementAmount = positiveAmount(values[settlement] ?? '')
      const currency = currencyFor(values, detected.layout)
      if (!tradeDate || !settlementDate || quantity == null || unitPrice == null || settlementAmount == null || !currency) {
        issues.push({
          code: 'SBI_TRADE_VALUE_INVALID',
          message: 'SBI spot trade requires valid trade/settlement dates, positive quantity/unit price/settlement amount, and an unambiguous currency.',
          severity: 'warning', row: row.sourceRow,
        })
        continue
      }
      const grossAmount = quantity * unitPrice
      if (!Number.isSafeInteger(grossAmount) && currency === 'JPY') {
        issues.push({ code: 'SBI_TRADE_VALUE_INVALID', message: 'JPY transaction value must resolve to a safe integer.', severity: 'warning', row: row.sourceRow })
        continue
      }
      const built = buildLegs(eventType, currency, security, quantity, grossAmount, settlementAmount)
      if (Math.abs(built.difference) >= 0.000001) {
        issues.push({ code: 'SBI_SETTLEMENT_MISMATCH', message: `Settlement differs from quantity × unit price by ${built.difference} ${currency}; the source does not itemize the difference.`, severity: 'warning', row: row.sourceRow, column: settlement })
      }
      records.push({
        kind: 'brokerage-event', lineage: row, accountHint: input.accountHint,
        eventType, tradeDate, settlementDate, instrumentCode: security.code,
        instrumentName: security.name, ...(security.market ? { market: security.market } : {}),
        accountType: normalizeJapaneseText(value(values, '預り', '預り区分')),
        currency, quantity, unitPrice, grossAmount, feeAmount: 0, taxAmount: 0,
        settlementAmount, legs: built.legs,
        reconciliationStatus: Math.abs(built.difference) < 0.000001 ? 'BALANCED' : 'ADJUSTED',
        reconciliationDifference: built.difference, affectsHouseholdExpense: false, rawTransactionType,
      })
    }
    return {
      adapterId: this.id, records, issues,
      metadata: { ledgerKind: 'INVESTMENT', provider: 'SBI_SECURITIES', layout: detected.layout, headerRow: headerRow.sourceRow, delimiter: csv.delimiter },
    }
  },
}
