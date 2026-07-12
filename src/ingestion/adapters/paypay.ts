import { normalizeHeader, rowObject, tokenizeCsv } from '../csv'
import { clampScore, normalizeJapaneseText, parseJapaneseAmount, parseJapaneseDateTime } from '../normalize'
import type { ImportAdapter, ParseIssue, WalletEventCandidate, WalletFundingLegCandidate } from '../types'

const ALIASES = {
  date: ['Date & Time', '日時'], outgoing: ['Amount Outgoing (Yen)', '出金金額(円)', '出金金額'],
  incoming: ['Amount Incoming (Yen)', '入金金額(円)', '入金金額'], type: ['Transaction Type', '取引種類'],
  option: ['Payment Option', '支払い方法'], id: ['Transaction ID', '取引番号'], counterparty: ['Description', '取引先', '店舗名'],
} as const
const find = (object: Record<string, string>, aliases: readonly string[]) => aliases.map(normalizeHeader).map((key) => object[key]).find((value) => value !== undefined) ?? ''

function parseFunding(value: string): WalletFundingLegCandidate[] {
  const normalized = value.normalize('NFKC')
  const result: WalletFundingLegCandidate[] = []
  const pattern = /([^,、;]+?)\s*[（(]\s*([\d,]+)\s*(?:円|yen)\s*[）)]/gi
  for (const match of normalized.matchAll(pattern)) result.push({ method: normalizeJapaneseText(match[1]), amount: Number(match[2].replace(/,/g, '')), currency: 'JPY' })
  return result
}

export const payPayAdapter: ImportAdapter<WalletEventCandidate> = {
  id: 'paypay-history-v1',
  detect(input) {
    const row = tokenizeCsv(input.text).rows[0]
    const headers = row?.fields.map(normalizeHeader) ?? []
    const groups = Object.values(ALIASES)
    const hits = groups.filter((aliases) => aliases.some((alias) => headers.includes(normalizeHeader(alias)))).length
    return { adapterId: this.id, score: clampScore(hits / groups.length), reasons: [`${hits}/${groups.length} PayPay columns matched`] }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text); const issues: ParseIssue[] = [...csv.issues]
    if (!csv.rows[0]) return { adapterId: this.id, records: [], issues: [{ code: 'EMPTY_FILE', message: 'CSV is empty.', severity: 'error' }], metadata: {} }
    const headers = csv.rows[0].fields.map(normalizeHeader)
    const groups = new Map<string, { date: string; counterparty: string; types: string[]; legs: WalletEventCandidate['legs'][number][] }>()
    for (const row of csv.rows.slice(1)) {
      const value = rowObject(headers, row); const id = find(value, ALIASES.id)
      if (!id) { issues.push({ code: 'PAYPAY_ID_MISSING', message: 'Row has no Transaction ID.', severity: 'warning', row: row.sourceRow }); continue }
      const type = find(value, ALIASES.type); const option = find(value, ALIASES.option)
      const current = groups.get(id) ?? { date: find(value, ALIASES.date), counterparty: find(value, ALIASES.counterparty), types: [], legs: [] }
      current.types.push(type)
      current.legs.push({ lineage: row, transactionType: type, outgoingAmount: parseJapaneseAmount(find(value, ALIASES.outgoing)), incomingAmount: parseJapaneseAmount(find(value, ALIASES.incoming)), paymentOption: option, funding: parseFunding(option) })
      groups.set(id, current)
    }
    const records = [...groups].map(([transactionId, group]) => ({
      kind: 'wallet-event' as const, transactionId, occurredAt: parseJapaneseDateTime(group.date), counterparty: normalizeJapaneseText(group.counterparty),
      eventType: [...new Set(group.types.filter(Boolean))].join(' + '), legs: group.legs,
      totalOutgoing: group.legs.reduce((sum, leg) => sum + Math.abs(leg.outgoingAmount ?? 0), 0),
      totalIncoming: group.legs.reduce((sum, leg) => sum + Math.abs(leg.incomingAmount ?? 0), 0),
    }))
    for (const event of records) for (const leg of event.legs) if (leg.funding.length > 1 && leg.outgoingAmount != null && leg.funding.reduce((sum, item) => sum + item.amount, 0) !== Math.abs(leg.outgoingAmount)) issues.push({ code: 'PAYPAY_FUNDING_MISMATCH', message: `Funding legs do not equal outgoing amount for ${event.transactionId}.`, severity: 'warning', row: leg.lineage.sourceRow })
    return { adapterId: this.id, records, issues, metadata: { sourceRows: csv.rows.length - 1, businessEvents: records.length } }
  },
}
