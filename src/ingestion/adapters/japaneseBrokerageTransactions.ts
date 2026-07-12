import { normalizeHeader, rowObject, tokenizeCsv, type CsvRow } from '../csv'
import { clampScore, normalizeJapaneseText, parseJapaneseAmount, parseJapaneseDate } from '../normalize'
import type {
  BrokerageEventCandidate,
  BrokerageEventLegCandidate,
  BrokerageEventType,
  ImportAdapter,
  ParseIssue,
} from '../types'

const ALIASES = {
  tradeDate: ['約定日', '取引日', '国内約定日', '現地約定日', '約定年月日', '取引年月日'],
  settlementDate: ['受渡日', '国内受渡日', '受渡年月日'],
  transactionType: ['取引', '取引区分', '取引種類', '取引種別', '売買', '売買区分', '摘要', '取引内容', '明細区分'],
  instrumentCode: ['銘柄コード', 'コード', 'ティッカー', 'シンボル', '商品コード'],
  instrumentName: ['銘柄名', '銘柄', '商品名', 'ファンド名', 'ティッカー+銘柄名(または通貨名)'],
  accountType: ['口座区分', '預り区分', '預かり区分', '口座', '口座種別'],
  quantity: ['数量', '約定数量', '約定数量[株]', '口数', '株数', '約定株数'],
  unitPrice: ['単価', '約定単価', '約定価格', '約定価格(円)', '約定値段[ドル]', '約定値段[円]'],
  grossAmount: ['約定金額', '約定金額[ドル]', '約定金額[円]', '約定代金', '受取金額', '配当金額', '分配金額', '総額', '金額'],
  fee: ['手数料', '国内手数料', '委託手数料', '取引手数料', '手数料(税込)', '手数料(税込)[ドル]', '手数料(税込)[円]'],
  tax: ['税金', '税額', '源泉徴収税', '源泉税', '所得税・住民税', '譲渡益税', '所得税', '住民税', '外国税', '消費税'],
  settlementAmount: ['受渡金額', '受渡金額[ドル]', '受渡金額[円]', '精算金額', '入出金額', '差引金額'],
  currency: ['通貨', '通貨コード', '決済通貨', '通貨名', '取引通貨'],
  corporateActionRatio: ['分割比率', '併合比率', '交換比率', '割当比率'],
  targetInstrumentCode: ['割当銘柄コード', '新銘柄コード', '交換先コード'],
  targetInstrumentName: ['割当銘柄名', '新銘柄名', '交換先銘柄名'],
  costBasisAllocationRatio: ['取得価額配分比率', '原価配分比率', '簿価配分比率', 'コスト配分率', 'COST ALLOCATION RATIO'],
  subscriptionAmount: ['払込金額', '権利行使金額', '購読金額', 'SUBSCRIPTION AMOUNT'],
  cashInLieuAmount: ['端数株代金', '端数処分代金', '現金交付額', 'CASH IN LIEU AMOUNT'],
  cashInLieuQuantity: ['端数株数', '処分数量', 'CASH IN LIEU QUANTITY'],
} as const

type AliasKey = keyof typeof ALIASES

function findHeader(rows: readonly CsvRow[]): number {
  let bestIndex = -1
  let bestScore = 0
  rows.slice(0, 20).forEach((row, index) => {
    const headers = row.fields.map(normalizeHeader)
    const has = (key: AliasKey) => ALIASES[key].some((alias) => headers.includes(alias))
    const score = Number(has('tradeDate')) + Number(has('transactionType')) + Number(has('grossAmount') || has('settlementAmount')) + Number(has('instrumentName'))
    if (score > bestScore) { bestScore = score; bestIndex = index }
  })
  return bestScore >= 3 ? bestIndex : -1
}

function headerFor(headers: readonly string[], key: AliasKey): string | undefined {
  return ALIASES[key].find((alias) => headers.includes(alias))
}

function valueFor(values: Readonly<Record<string, string>>, headers: readonly string[], key: AliasKey): string {
  const header = headerFor(headers, key)
  return header ? values[header] ?? '' : ''
}

function firstPopulatedValue(values: Readonly<Record<string, string>>, headers: readonly string[], key: AliasKey): string {
  for (const alias of ALIASES[key]) {
    if (headers.includes(alias) && (values[alias] ?? '').trim()) return values[alias]
  }
  return valueFor(values, headers, key)
}

function populatedValues(values: Readonly<Record<string, string>>, headers: readonly string[], key: AliasKey): string[] {
  return ALIASES[key].filter((alias) => headers.includes(alias) && (values[alias] ?? '').trim()).map((alias) => values[alias])
}

function amount(value: string): number | null {
  const parsed = parseJapaneseAmount(value)
  return parsed == null ? null : Math.abs(parsed)
}

function proportion(value: string): number | null {
  const parsed = amount(value.replace(/[％%]/g, ''))
  if (parsed == null) return null
  return value.includes('%') || value.includes('％') ? parsed / 100 : parsed
}

function summedAmounts(values: Readonly<Record<string, string>>, headers: readonly string[], key: 'fee' | 'tax'): number {
  return ALIASES[key]
    .filter((alias) => headers.includes(alias))
    .reduce((sum, header) => sum + (amount(values[header] ?? '') ?? 0), 0)
}

function classify(raw: string): BrokerageEventType | null {
  const value = normalizeJapaneseText(raw).toUpperCase()
  if (/端数株(?:処分|代金)|現金交付|CASH[ _-]?IN[ _-]?LIEU/.test(value)) return 'CASH_IN_LIEU'
  if (/スピン[ _-]?オフ|会社分割|SPIN[ _-]?OFF/.test(value)) return 'SPIN_OFF'
  if (/新株予約権行使|権利行使|RIGHTS?[ _-]?(?:ISSUE|SUBSCRIPTION)|SUBSCRIPTION/.test(value)) return 'RIGHTS_SUBSCRIPTION'
  if (/株式併合|REVERSE[ _-]?SPLIT/.test(value)) return 'REVERSE_SPLIT'
  if (/株式分割|STOCK[ _-]?SPLIT|\bSPLIT\b/.test(value)) return 'SPLIT'
  if (/合併|株式交換|MERGER/.test(value)) return 'MERGER'
  if (/配当|分配金|DIVIDEND|DISTRIBUTION/.test(value)) return 'DIVIDEND'
  if (/買付|買い|購入|(?:^|\s)買(?:$|\s)|BUY/.test(value)) return 'BUY'
  if (/売却|売り|(?:^|\s)売(?:$|\s)|SELL/.test(value)) return 'SELL'
  if (/入金|預入|DEPOSIT/.test(value)) return 'DEPOSIT'
  if (/出金|引出|WITHDRAW/.test(value)) return 'WITHDRAWAL'
  if (/手数料|FEE|COMMISSION/.test(value)) return 'FEE'
  if (/税|TAX/.test(value)) return 'TAX'
  return null
}

function actionRatio(raw: string): number | null {
  const value = normalizeJapaneseText(raw).replace(/,/g, '')
  const pair = value.match(/([\d.]+)\s*[:：]\s*([\d.]+)/)
  if (pair) {
    const oldUnits = Number(pair[1]); const newUnits = Number(pair[2])
    return oldUnits > 0 && Number.isFinite(newUnits) && newUnits > 0 ? newUnits / oldUnits : null
  }
  const perShare = value.match(/1株(?:につき|当たり)?\s*([\d.]+)株/)
  const parsed = Number(perShare?.[1] ?? value.match(/[\d.]+/)?.[0])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function currencyOf(raw: string): string {
  const normalized = normalizeJapaneseText(raw).toUpperCase()
  return normalized.match(/\b[A-Z]{3}\b/)?.[0] ?? 'JPY'
}

function leg(
  kind: BrokerageEventLegCandidate['kind'],
  signedAmount: number,
  currency: string,
  description: string,
  security?: Pick<BrokerageEventLegCandidate, 'instrumentCode' | 'instrumentName' | 'signedQuantity'>,
): BrokerageEventLegCandidate {
  return { kind, signedAmount, currency, description, ...security }
}

function buildLegs(input: {
  eventType: BrokerageEventType
  currency: string
  gross: number
  fee: number
  tax: number
  settlement: number | null
  instrumentCode: string
  instrumentName: string
  quantity: number | null
  corporateActionRatio?: number
  targetInstrumentCode?: string
  targetInstrumentName?: string
  costBasisAllocationRatio?: number
  subscriptionAmount?: number
  cashInLieuAmount?: number
  cashInLieuQuantity?: number
}): { legs: BrokerageEventLegCandidate[]; settlement: number; difference: number } {
  const { eventType, currency, gross, fee, tax, instrumentCode, instrumentName, quantity } = input
  const security = { instrumentCode, instrumentName, signedQuantity: quantity ?? undefined }
  const zeroValueCorporate = ['SPLIT', 'REVERSE_SPLIT', 'MERGER', 'SPIN_OFF'].includes(eventType)
  const subscription = eventType === 'RIGHTS_SUBSCRIPTION'
  const cashInLieu = eventType === 'CASH_IN_LIEU'
  const expected = zeroValueCorporate ? 0 : eventType === 'BUY' ? gross + fee + tax
    : eventType === 'SELL' || eventType === 'DIVIDEND' ? gross - fee - tax
      : gross
  const settlement = input.settlement ?? expected
  const legs: BrokerageEventLegCandidate[] = []

  if (zeroValueCorporate) {
    const ratio = input.corporateActionRatio ?? 0
    const changesInstrument = eventType === 'MERGER' || eventType === 'SPIN_OFF'
    const targetCode = changesInstrument ? input.targetInstrumentCode ?? '' : instrumentCode
    const targetName = changesInstrument ? input.targetInstrumentName ?? '' : instrumentName
    legs.push(leg('SECURITY', 0, currency, 'Units surrendered by corporate action', { instrumentCode, instrumentName, signedQuantity: -1 }))
    legs.push(leg('SECURITY', 0, currency, 'Units received by corporate action', { instrumentCode: targetCode, instrumentName: targetName, signedQuantity: ratio }))
  } else if (subscription) {
    const subscribed = input.subscriptionAmount ?? gross
    legs.push(leg('SECURITY', subscribed, currency, 'Shares acquired through rights subscription', { instrumentCode: input.targetInstrumentCode || instrumentCode, instrumentName: input.targetInstrumentName || instrumentName, signedQuantity: input.corporateActionRatio }))
    legs.push(leg('CASH', -subscribed, currency, 'Rights subscription cash paid'))
  } else if (cashInLieu) {
    const proceeds = input.cashInLieuAmount ?? gross
    legs.push(leg('SECURITY', -proceeds, currency, 'Fractional shares disposed for cash', { instrumentCode, instrumentName, signedQuantity: -(input.cashInLieuQuantity ?? 0) }))
    legs.push(leg('CASH', proceeds, currency, 'Cash-in-lieu proceeds received'))
  } else if (eventType === 'BUY') {
    legs.push(leg('SECURITY', gross, currency, 'Security acquired at transaction value', security))
    legs.push(leg('CASH', -settlement, currency, 'Brokerage cash settlement'))
  } else if (eventType === 'SELL') {
    legs.push(leg('SECURITY', -gross, currency, 'Security disposed at transaction value', { ...security, signedQuantity: quantity == null ? undefined : -quantity }))
    legs.push(leg('CASH', settlement, currency, 'Brokerage cash settlement'))
  } else if (eventType === 'DIVIDEND') {
    legs.push(leg('INVESTMENT_INCOME', -gross, currency, 'Gross dividend or distribution'))
    legs.push(leg('CASH', settlement, currency, 'Net dividend cash received'))
  } else if (eventType === 'DEPOSIT') {
    legs.push(leg('CASH', settlement, currency, 'Cash deposited to brokerage'))
    legs.push(leg('TRANSFER', -settlement, currency, 'Transfer from external account'))
  } else if (eventType === 'WITHDRAWAL') {
    legs.push(leg('CASH', -settlement, currency, 'Cash withdrawn from brokerage'))
    legs.push(leg('TRANSFER', settlement, currency, 'Transfer to external account'))
  } else if (eventType === 'FEE') {
    const charge = fee || gross || settlement
    legs.push(leg('INVESTMENT_EXPENSE', charge, currency, 'Brokerage fee'))
    legs.push(leg('CASH', -charge, currency, 'Fee paid from brokerage cash'))
  } else {
    const charge = tax || gross || settlement
    legs.push(leg('INVESTMENT_TAX', charge, currency, 'Investment tax'))
    legs.push(leg('CASH', -charge, currency, 'Tax paid from brokerage cash'))
  }

  if (['BUY', 'SELL', 'DIVIDEND'].includes(eventType)) {
    if (fee) legs.push(leg('INVESTMENT_EXPENSE', fee, currency, 'Brokerage fee'))
    if (tax) legs.push(leg('INVESTMENT_TAX', tax, currency, 'Investment tax'))
  }

  const difference = legs.reduce((sum, item) => sum + item.signedAmount, 0)
  if (Math.abs(difference) >= 0.000001) {
    legs.push(leg('ADJUSTMENT', -difference, currency, 'Unexplained source settlement difference'))
  }
  return { legs, settlement, difference }
}

export const japaneseBrokerageTransactionsAdapter: ImportAdapter<BrokerageEventCandidate> = {
  id: 'japanese-brokerage-transactions-v1',
  detect(input) {
    const csv = tokenizeCsv(input.text)
    const headerIndex = findHeader(csv.rows)
    if (headerIndex < 0) return { adapterId: this.id, score: 0, reasons: ['Brokerage transaction header not found'] }
    const headers = csv.rows[headerIndex].fields.map(normalizeHeader)
    const matched = (Object.keys(ALIASES) as AliasKey[]).filter((key) => headerFor(headers, key)).length
    const filenameBonus = /(取引|trade|transaction|history|deal)/i.test(input.filename ?? '') ? 0.1 : 0
    return { adapterId: this.id, score: clampScore(0.5 + matched * 0.04 + filenameBonus), reasons: [`${matched}/${Object.keys(ALIASES).length} brokerage fields matched`] }
  },
  parse(input) {
    const csv = tokenizeCsv(input.text)
    const issues: ParseIssue[] = [...csv.issues]
    const headerIndex = findHeader(csv.rows)
    if (headerIndex < 0) {
      return { adapterId: this.id, records: [], issues: [...issues, { code: 'BROKERAGE_HEADER_MISSING', message: 'Japanese brokerage transaction header was not found.', severity: 'error' }], metadata: {} }
    }
    const headers = csv.rows[headerIndex].fields.map(normalizeHeader)
    const records: BrokerageEventCandidate[] = []
    for (const row of csv.rows.slice(headerIndex + 1)) {
      const values = rowObject(headers, row)
      const rawTransactionType = normalizeJapaneseText(populatedValues(values, headers, 'transactionType').join(' '))
      const eventType = classify(rawTransactionType)
      if (!eventType) {
        issues.push({ code: 'BROKERAGE_EVENT_TYPE_UNKNOWN', message: `Unsupported brokerage event type: ${rawTransactionType || '(empty)'}`, severity: 'warning', row: row.sourceRow })
        continue
      }
      const quantity = amount(valueFor(values, headers, 'quantity'))
      const unitPrice = amount(valueFor(values, headers, 'unitPrice'))
      const zeroValueCorporate = ['SPLIT', 'REVERSE_SPLIT', 'MERGER', 'SPIN_OFF'].includes(eventType)
      const ratioAction = zeroValueCorporate || eventType === 'RIGHTS_SUBSCRIPTION'
      const ratio = ratioAction ? actionRatio(firstPopulatedValue(values, headers, 'corporateActionRatio') || rawTransactionType) : null
      const costBasisAllocationRatio = proportion(valueFor(values, headers, 'costBasisAllocationRatio'))
      const subscriptionAmount = amount(valueFor(values, headers, 'subscriptionAmount'))
      const cashInLieuAmount = amount(valueFor(values, headers, 'cashInLieuAmount'))
      const cashInLieuQuantity = amount(valueFor(values, headers, 'cashInLieuQuantity'))
      const rawGross = amount(firstPopulatedValue(values, headers, 'grossAmount'))
      const fee = summedAmounts(values, headers, 'fee')
      const tax = summedAmounts(values, headers, 'tax')
      const rawSettlement = amount(firstPopulatedValue(values, headers, 'settlementAmount'))
      const derivedTradeAmount = quantity != null && unitPrice != null ? quantity * unitPrice : null
      const gross = zeroValueCorporate ? 0 : eventType === 'RIGHTS_SUBSCRIPTION' ? subscriptionAmount ?? 0 : eventType === 'CASH_IN_LIEU' ? cashInLieuAmount ?? 0 : (rawGross ?? derivedTradeAmount ?? rawSettlement ?? fee) || tax
      const missingComplexInput = eventType === 'SPIN_OFF' && costBasisAllocationRatio == null
        || eventType === 'RIGHTS_SUBSCRIPTION' && subscriptionAmount == null
        || eventType === 'CASH_IN_LIEU' && (cashInLieuAmount == null || cashInLieuQuantity == null)
      if ((!zeroValueCorporate && (!Number.isFinite(gross) || gross <= 0)) || (ratioAction && ratio == null) || missingComplexInput) {
        const actionMissing = ratioAction && ratio == null || missingComplexInput
        issues.push({ code: actionMissing ? 'BROKERAGE_ACTION_INPUT_MISSING' : 'BROKERAGE_AMOUNT_MISSING', message: actionMissing ? 'Corporate action is missing an explicit ratio, cost allocation, subscription amount, or cash-in-lieu quantity/amount.' : 'Brokerage event has no usable amount.', severity: 'warning', row: row.sourceRow })
        continue
      }
      const tradeDateRaw = valueFor(values, headers, 'tradeDate')
      const tradeDate = parseJapaneseDate(tradeDateRaw)
      if (!tradeDate) issues.push({ code: 'BROKERAGE_TRADE_DATE_INVALID', message: `Invalid trade date: ${tradeDateRaw}`, severity: 'warning', row: row.sourceRow, column: headerFor(headers, 'tradeDate') })
      const settlementDateRaw = valueFor(values, headers, 'settlementDate')
      const settlementDate = settlementDateRaw ? parseJapaneseDate(settlementDateRaw) : null
      if (settlementDateRaw && !settlementDate) issues.push({ code: 'BROKERAGE_SETTLEMENT_DATE_INVALID', message: `Invalid settlement date: ${settlementDateRaw}`, severity: 'warning', row: row.sourceRow, column: headerFor(headers, 'settlementDate') })
      let instrumentCode = normalizeJapaneseText(valueFor(values, headers, 'instrumentCode'))
      let instrumentName = normalizeJapaneseText(valueFor(values, headers, 'instrumentName'))
      if (!instrumentCode) {
        const combined = instrumentName.match(/^([A-Z0-9][A-Z0-9./-]{0,9})\s+(.+)$/i)
        if (combined) { instrumentCode = combined[1].toUpperCase(); instrumentName = combined[2].trim() }
      }
      const targetInstrumentCode = normalizeJapaneseText(valueFor(values, headers, 'targetInstrumentCode'))
      const targetInstrumentName = normalizeJapaneseText(valueFor(values, headers, 'targetInstrumentName'))
      if ((eventType === 'MERGER' || eventType === 'SPIN_OFF') && !targetInstrumentCode && !targetInstrumentName) {
        issues.push({ code: 'BROKERAGE_ACTION_TARGET_MISSING', message: 'Merger target instrument is missing.', severity: 'warning', row: row.sourceRow })
        continue
      }
      const currency = currencyOf(valueFor(values, headers, 'currency'))
      const built = buildLegs({ eventType, currency, gross, fee, tax, settlement: zeroValueCorporate ? 0 : eventType === 'RIGHTS_SUBSCRIPTION' ? subscriptionAmount : eventType === 'CASH_IN_LIEU' ? cashInLieuAmount : rawSettlement, instrumentCode, instrumentName, quantity, corporateActionRatio: ratio ?? undefined, targetInstrumentCode, targetInstrumentName, costBasisAllocationRatio: costBasisAllocationRatio ?? undefined, subscriptionAmount: subscriptionAmount ?? undefined, cashInLieuAmount: cashInLieuAmount ?? undefined, cashInLieuQuantity: cashInLieuQuantity ?? undefined })
      if (Math.abs(built.difference) >= 0.000001) {
        issues.push({ code: 'BROKERAGE_SETTLEMENT_MISMATCH', message: `Settlement differs from gross, fee and tax by ${built.difference} ${currency}.`, severity: 'warning', row: row.sourceRow })
      }
      records.push({
        kind: 'brokerage-event', lineage: row, accountHint: input.accountHint, eventType,
        tradeDate, settlementDate, instrumentCode, instrumentName,
        accountType: normalizeJapaneseText(valueFor(values, headers, 'accountType')),
        currency, quantity, unitPrice, grossAmount: gross, feeAmount: fee, taxAmount: tax,
        settlementAmount: built.settlement, legs: built.legs,
        reconciliationStatus: Math.abs(built.difference) < 0.000001 ? 'BALANCED' : 'ADJUSTED',
        reconciliationDifference: built.difference, affectsHouseholdExpense: false, rawTransactionType,
        ...(ratioAction ? { corporateActionRatio: ratio ?? undefined } : {}),
        ...(['MERGER', 'SPIN_OFF', 'RIGHTS_SUBSCRIPTION'].includes(eventType) && (targetInstrumentCode || targetInstrumentName) ? { targetInstrumentCode, targetInstrumentName, targetCurrency: currency } : {}),
        ...(eventType === 'SPIN_OFF' ? { costBasisAllocationRatio: costBasisAllocationRatio ?? undefined } : {}),
        ...(eventType === 'RIGHTS_SUBSCRIPTION' ? { subscriptionAmount: subscriptionAmount ?? undefined } : {}),
        ...(eventType === 'CASH_IN_LIEU' ? { cashInLieuAmount: cashInLieuAmount ?? undefined, cashInLieuQuantity: cashInLieuQuantity ?? undefined } : {}),
      })
    }
    return { adapterId: this.id, records, issues, metadata: { ledgerKind: 'INVESTMENT', headerRow: csv.rows[headerIndex].sourceRow, delimiter: csv.delimiter } }
  },
}
