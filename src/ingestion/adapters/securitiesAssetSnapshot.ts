import { normalizeHeader, rowObject, tokenizeCsv, type CsvRow } from '../csv'
import { clampScore, normalizeJapaneseText, parseJapaneseAmount } from '../normalize'
import type {
  FxRateSnapshotCandidate,
  ImportAdapter,
  ParseIssue,
  PortfolioAssetClassCandidate,
  PortfolioSnapshotCandidate,
  PositionSnapshotCandidate,
  SourceLineage,
} from '../types'

type SectionName = 'summary' | 'positions' | 'fx'

const SECTION_MARKERS: Readonly<Record<SectionName, RegExp>> = {
  summary: /資産合計欄|資産合計/,
  positions: /保有商品詳細|保有商品/,
  fx: /参考為替レート|為替レート/,
}

const POSITION_ALIASES = {
  productType: ['商品区分', '商品種別', '商品'],
  accountType: ['預り区分', '口座区分', '預かり区分'],
  instrumentCode: ['銘柄コード', 'コード', 'ティッカー', 'シンボル'],
  instrumentName: ['銘柄名', '商品名', 'ファンド名'],
  quantity: ['保有数量', '数量', '保有数', '口数'],
  averageCost: ['平均取得単価', '取得単価', '平均単価', '取得価額'],
  marketPrice: ['現在値', '現在価格', '基準価額', '時価単価'],
  marketValue: ['評価額', '時価評価額', '評価金額', '時価'],
  unrealizedPnl: ['評価損益', '含み損益', '評価損益額'],
  realizedPnl: ['実現損益', '売買損益', '確定損益'],
  currency: ['通貨', '通貨コード'],
} as const

function sectionFor(row: CsvRow): SectionName | null {
  const rawMarker = normalizeJapaneseText(row.fields[0] ?? '')
  if (!/^■+/.test(rawMarker)) return null
  const marker = rawMarker.replace(/^■+/, '')
  if (!marker) return null
  for (const [section, pattern] of Object.entries(SECTION_MARKERS) as [SectionName, RegExp][]) {
    if (pattern.test(marker)) return section
  }
  return null
}

function rowsInSection(rows: readonly CsvRow[], section: SectionName): readonly CsvRow[] {
  const start = rows.findIndex((row) => sectionFor(row) === section)
  if (start < 0) return []
  const relativeEnd = rows.slice(start + 1).findIndex((row) => sectionFor(row) !== null)
  return rows.slice(start + 1, relativeEnd < 0 ? rows.length : start + 1 + relativeEnd)
}

function aliasesFor(headers: readonly string[], aliases: readonly string[]): string | undefined {
  return headers.find((header) => aliases.includes(header))
}

function numeric(value: string | undefined): number | null {
  const amount = parseJapaneseAmount(value)
  return amount == null || !Number.isFinite(amount) ? null : amount
}

function currencyFrom(value: string | undefined, productType: string): string {
  const normalized = normalizeJapaneseText(value ?? '').toUpperCase()
  const explicit = normalized.match(/\b[A-Z]{3}\b/)?.[0]
  if (explicit) return explicit
  const productCurrency = normalizeJapaneseText(productType).toUpperCase().match(/\b[A-Z]{3}\b/)?.[0]
  return productCurrency ?? 'JPY'
}

function parseAsOf(filename?: string): string | null {
  const match = filename?.normalize('NFKC').match(/assetbalance\(all\)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/i)
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`)
  return Number.isNaN(date.valueOf()) ? null : `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`
}

function findHeader(rows: readonly CsvRow[], requiredAliases: readonly (readonly string[])[]): number {
  let bestIndex = -1
  let bestHits = 0
  rows.forEach((row, index) => {
    const headers = row.fields.map(normalizeHeader)
    const hits = requiredAliases.filter((aliases) => aliases.some((alias) => headers.includes(alias))).length
    if (hits > bestHits) { bestHits = hits; bestIndex = index }
  })
  return bestHits >= 2 ? bestIndex : -1
}

function parsePositions(rows: readonly CsvRow[], issues: ParseIssue[]): PositionSnapshotCandidate[] {
  const headerIndex = findHeader(rows, [POSITION_ALIASES.instrumentName, POSITION_ALIASES.marketValue, POSITION_ALIASES.quantity])
  if (headerIndex < 0) {
    if (rows.length) issues.push({ code: 'ASSET_POSITION_HEADER_MISSING', message: 'Position table header was not recognized.', severity: 'warning' })
    return []
  }
  const headers = rows[headerIndex].fields.map(normalizeHeader)
  const key = (aliases: readonly string[]) => aliasesFor(headers, aliases)
  const nameHeader = key(POSITION_ALIASES.instrumentName)
  const valueHeader = key(POSITION_ALIASES.marketValue)
  const positions: PositionSnapshotCandidate[] = []
  for (const row of rows.slice(headerIndex + 1)) {
    const values = rowObject(headers, row)
    const name = normalizeJapaneseText(nameHeader ? values[nameHeader] : '')
    const marketValueJpy = numeric(valueHeader ? values[valueHeader] : undefined)
    if (!name || /^(合計|小計)$/.test(name)) continue
    if (marketValueJpy == null) {
      issues.push({ code: 'ASSET_POSITION_VALUE_MISSING', message: `Position ${name} has no usable market value.`, severity: 'warning', row: row.sourceRow, column: valueHeader })
    }
    const productType = normalizeJapaneseText(values[key(POSITION_ALIASES.productType) ?? ''] ?? '')
    positions.push({
      kind: 'position-snapshot', lineage: row, productType,
      accountType: normalizeJapaneseText(values[key(POSITION_ALIASES.accountType) ?? ''] ?? ''),
      instrumentCode: normalizeJapaneseText(values[key(POSITION_ALIASES.instrumentCode) ?? ''] ?? ''),
      instrumentName: name,
      quantity: numeric(values[key(POSITION_ALIASES.quantity) ?? '']),
      averageCost: numeric(values[key(POSITION_ALIASES.averageCost) ?? '']),
      marketPrice: numeric(values[key(POSITION_ALIASES.marketPrice) ?? '']),
      marketValueJpy,
      unrealizedPnlJpy: numeric(values[key(POSITION_ALIASES.unrealizedPnl) ?? '']),
      realizedPnlJpy: numeric(values[key(POSITION_ALIASES.realizedPnl) ?? '']),
      currency: currencyFrom(values[key(POSITION_ALIASES.currency) ?? ''], productType),
    })
  }
  return positions
}

function parseFxRates(rows: readonly CsvRow[], issues: ParseIssue[]): FxRateSnapshotCandidate[] {
  const currencyAliases = ['通貨', '通貨コード', '通貨名']
  const rateAliases = ['為替レート', '参考レート', '円換算レート', 'レート']
  const headerIndex = findHeader(rows, [currencyAliases, rateAliases])
  if (headerIndex < 0) return []
  const headers = rows[headerIndex].fields.map(normalizeHeader)
  const currencyHeader = aliasesFor(headers, currencyAliases)!
  const rateHeader = aliasesFor(headers, rateAliases)!
  return rows.slice(headerIndex + 1).flatMap((row) => {
    const values = rowObject(headers, row)
    const currencyText = normalizeJapaneseText(values[currencyHeader] ?? '').toUpperCase()
    const currency = currencyText.match(/\b[A-Z]{3}\b/)?.[0] ?? ({ 米ドル: 'USD', ユーロ: 'EUR', 英ポンド: 'GBP', 豪ドル: 'AUD', 中国元: 'CNY' }[currencyText])
    const rate = numeric(values[rateHeader])
    if (!currency || currency === 'JPY') return []
    if (rate == null || rate <= 0) {
      issues.push({ code: 'ASSET_FX_RATE_INVALID', message: `Invalid FX rate for ${currency}.`, severity: 'warning', row: row.sourceRow, column: rateHeader })
      return []
    }
    return [{ kind: 'fx-rate-snapshot' as const, lineage: row, baseCurrency: currency, quoteCurrency: 'JPY' as const, rate }]
  })
}

function parseSummary(rows: readonly CsvRow[]): { assetClasses: PortfolioAssetClassCandidate[]; lineage: SourceLineage | null } {
  const assetClasses: PortfolioAssetClassCandidate[] = []
  let first: CsvRow | null = null
  let last: CsvRow | null = null
  for (const row of rows) {
    const label = normalizeJapaneseText(row.fields[0] ?? '')
    const amount = row.fields.slice(1).map(numeric).find((value): value is number => value != null)
    if (!label || amount == null || /評価損益|実現損益/.test(label)) continue
    const pnl = row.fields.slice(2).map(numeric).find((value): value is number => value != null) ?? null
    assetClasses.push({ lineage: row, name: label, marketValueJpy: amount, unrealizedPnlJpy: pnl })
    first ??= row; last = row
  }
  return { assetClasses, lineage: first && last ? { sourceRow: first.sourceRow, sourceRowEnd: last.sourceRowEnd, rawFields: rows.flatMap((row) => row.rawFields) } : null }
}

export const securitiesAssetSnapshotAdapter: ImportAdapter<PortfolioSnapshotCandidate> = {
  id: 'securities-asset-snapshot-v1',
  detect(input) {
    const csv = tokenizeCsv(input.text)
    const markers = new Set(csv.rows.map(sectionFor).filter(Boolean))
    const filenameMatch = /assetbalance\(all\)/i.test(input.filename ?? '')
    const score = clampScore(markers.size * 0.25 + (markers.has('positions') ? 0.2 : 0) + (filenameMatch ? 0.15 : 0))
    return { adapterId: this.id, score, reasons: [`${markers.size}/3 snapshot sections found`, filenameMatch ? 'Filename signature matched' : 'Filename signature missing'] }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text)
    const issues: ParseIssue[] = [...csv.issues]
    const positionRows = rowsInSection(csv.rows, 'positions')
    const summaryRows = rowsInSection(csv.rows, 'summary')
    const fxRows = rowsInSection(csv.rows, 'fx')
    if (!positionRows.length && !summaryRows.length) {
      return { adapterId: this.id, records: [], issues: [...issues, { code: 'ASSET_SECTIONS_MISSING', message: 'Asset summary and position sections were not found.', severity: 'error' }], metadata: {} }
    }
    const positions = parsePositions(positionRows, issues)
    const fxRates = parseFxRates(fxRows, issues)
    const summary = parseSummary(summaryRows)
    const total = summary.assetClasses.find((item) => /^(資産合計|合計)$/.test(item.name))
    const cash = summary.assetClasses.filter((item) => /現金|預り金|預託金|買付余力/.test(item.name)).reduce((sum, item) => sum + item.marketValueJpy, 0)
    const marketValueJpy = total?.marketValueJpy ?? (positions.length ? positions.reduce((sum, item) => sum + (item.marketValueJpy ?? 0), 0) + cash : null)
    const rawRows = [...summaryRows, ...positionRows, ...fxRows]
    const first = rawRows[0]; const last = rawRows[rawRows.length - 1]
    const lineage = summary.lineage ?? (first && last ? { sourceRow: first.sourceRow, sourceRowEnd: last.sourceRowEnd, rawFields: rawRows.flatMap((row) => row.rawFields) } : { sourceRow: 1, sourceRowEnd: 1, rawFields: [] })
    const record: PortfolioSnapshotCandidate = {
      kind: 'portfolio-snapshot', lineage, accountHint: input.accountHint, asOf: parseAsOf(input.filename),
      marketValueJpy, cashValueJpy: cash || null,
      unrealizedPnlJpy: positions.some((item) => item.unrealizedPnlJpy != null) ? positions.reduce((sum, item) => sum + (item.unrealizedPnlJpy ?? 0), 0) : null,
      realizedPnlJpy: positions.some((item) => item.realizedPnlJpy != null) ? positions.reduce((sum, item) => sum + (item.realizedPnlJpy ?? 0), 0) : null,
      assetClasses: summary.assetClasses, positions, fxRates,
    }
    return { adapterId: this.id, records: [record], issues, metadata: { snapshotKind: 'PORTFOLIO', positionCount: positions.length, fxRateCount: fxRates.length, asOfSource: record.asOf ? 'filename' : 'unknown' } }
  },
}
