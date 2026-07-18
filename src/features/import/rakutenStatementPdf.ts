import type { ExtractedDocumentDto } from '../../platform'
import { normalizeJapaneseText, parseJapaneseAmount, parseJapaneseDate } from '../../ingestion/normalize'
import type { CardStatementCandidate, CardTransactionCandidate, ParsedImport, ParseIssue } from '../../ingestion/types'

export interface RakutenStatementPdfParseResult {
  readonly parsed: ParsedImport<CardStatementCandidate>
  readonly detailCount: number
}

function documentLines(document: ExtractedDocumentDto): string[] {
  if (document.regions?.some((region) => region.provenance === 'PDF_EMBEDDED_TEXT_RKSJ')) {
    return document.regions
      .filter((region) => region.provenance === 'PDF_EMBEDDED_TEXT_RKSJ')
      .map((region) => region.text)
  }
  return document.text.split(/[\n\f]/)
}

function compactLine(line: string): string {
  return line.normalize('NFKC').replace(/[\t\s]+/g, '')
}

function statementMetadata(lines: readonly string[]) {
  const compact = lines.map(compactLine)
  const monthLineIndex = compact.findIndex((line) => /\d{4}年\d{1,2}月ご請求金額/.test(line))
  const monthMatch = compact[monthLineIndex]?.match(/(\d{4})年(\d{1,2})月ご請求金額/)
  const statementMonth = monthMatch ? `${monthMatch[1]}-${monthMatch[2].padStart(2, '0')}` : undefined

  let statementTotal: number | null = null
  let productName: string | undefined
  let maskedCardNumber: string | undefined
  if (monthLineIndex >= 0) {
    for (const line of lines.slice(monthLineIndex + 1, monthLineIndex + 7)) {
      const fields = line.split('\t').map((field) => field.trim()).filter(Boolean)
      const yenIndex = fields.findIndex((field) => field.normalize('NFKC') === '円')
      const amount = yenIndex > 0 ? parseJapaneseAmount(fields[yenIndex - 1]) : null
      const masked = line.match(/\*{4}-\*{4}-\*{4}-(\d{4})/)
      if (amount != null && amount > 0) statementTotal = amount
      if (masked) {
        maskedCardNumber = masked[0]
        productName = normalizeJapaneseText(fields.slice(yenIndex + 1).join(' ').replace(/\([^)]*\)\s*\*{4}.*$/, '')) || undefined
      }
      if (statementTotal != null && maskedCardNumber) break
    }
  }

  const dueHeaderIndex = compact.findIndex((line) => line.startsWith('お支払日') && line.includes('返済方法'))
  const dueValue = dueHeaderIndex >= 0 ? lines[dueHeaderIndex + 1]?.split('\t')[0] : undefined
  const paymentDueOn = parseJapaneseDate(dueValue)
  const holderLine = lines.find((line, index) => index > 0 && index < 5 && compactLine(line).endsWith('様'))
  const holderName = holderLine ? normalizeJapaneseText(holderLine.replace(/\t?様\s*$/, '')) : undefined

  return { statementMonth, statementTotal, paymentDueOn, holderName, maskedCardNumber, productName }
}

/**
 * Parses the positioned rows emitted by the native 90ms-RKSJ-H extractor.
 * Returns null for non-Rakuten PDFs so receipt/source-only handling can continue.
 */
export function parseRakutenStatementPdf(document: ExtractedDocumentDto): RakutenStatementPdfParseResult | null {
  const lines = documentLines(document)
  const compact = lines.map(compactLine)
  if (!compact.some((line) => line.includes('ご利用代金請求明細書'))
    || !compact.some((line) => line.includes('楽天カード株式会社'))
    || !compact.some((line) => line.startsWith('利用日利用店名利用者支払方法'))) return null

  const issues: ParseIssue[] = []
  const transactions: CardTransactionCandidate[] = []
  let detailTableSeen = false
  lines.forEach((line, index) => {
    if (compactLine(line).startsWith('利用日利用店名利用者支払方法')) {
      detailTableSeen = true
      return
    }
    const fields = line.split('\t').map((field) => field.trim())
    const usageDate = parseJapaneseDate(fields[0])
    if (!detailTableSeen || !usageDate) return
    if (fields.length < 8) {
      issues.push({ code: 'RAKUTEN_PDF_DETAIL_COLUMNS_MISSING', message: 'PDF明細行の列を確認できませんでした。', severity: 'error', row: index + 1 })
      return
    }
    const billingAmount = parseJapaneseAmount(fields.at(-2))
    const usageAmount = parseJapaneseAmount(fields.at(-5))
    const feeOrInterest = parseJapaneseAmount(fields.at(-4))
    if (billingAmount == null || !Number.isSafeInteger(billingAmount) || billingAmount === 0) {
      issues.push({ code: 'RAKUTEN_PDF_DETAIL_AMOUNT_INVALID', message: 'PDF明細行の当月請求額を確認できませんでした。', severity: 'error', row: index + 1 })
      return
    }
    const merchant = normalizeJapaneseText(fields[1] ?? '')
    const newSign = fields.length >= 11 ? fields[3] ?? '' : ''
    const paymentMethod = normalizeJapaneseText(fields.slice(newSign ? 4 : 3, -5).join(''))
    const usageAmountRaw = fields.at(-5) ?? ''
    const feeOrInterestRaw = fields.at(-4) ?? ''
    const paymentTotalRaw = fields.at(-3) ?? ''
    const monthlyBillingRaw = fields.at(-2) ?? ''
    const carryoverRaw = fields.at(-1) ?? ''
    transactions.push({
      kind: 'card-transaction',
      lineage: { sourceRow: index + 1, sourceRowEnd: index + 1, rawFields: fields },
      sourceFields: {
        利用日: fields[0] ?? '',
        '利用店名・商品名': fields[1] ?? '',
        利用者: fields[2] ?? '',
        支払方法: paymentMethod,
        利用金額: usageAmountRaw,
        '手数料/利息': feeOrInterestRaw,
        支払総額: paymentTotalRaw,
        当月請求額: monthlyBillingRaw,
        翌月繰越残高: carryoverRaw,
        新規サイン: newSign,
      },
      usageDate,
      merchant,
      userName: normalizeJapaneseText(fields[2] ?? ''),
      paymentMethod,
      billingAmount,
      feeOrInterest,
      isRefund: billingAmount < 0 || /返品|返金|取消/.test(merchant),
      rawExtra: {
        利用金額: usageAmount == null ? usageAmountRaw : String(usageAmount),
        支払総額: paymentTotalRaw,
        当月請求額: monthlyBillingRaw,
        翌月繰越残高: carryoverRaw,
        新規サイン: newSign,
      },
    })
  })

  const metadata = statementMetadata(lines)
  if (transactions.length === 0) issues.push({ code: 'RAKUTEN_PDF_DETAILS_MISSING', message: '楽天カードPDFから利用明細を抽出できませんでした。', severity: 'error' })
  if (metadata.statementTotal == null) issues.push({ code: 'RAKUTEN_PDF_STATEMENT_TOTAL_MISSING', message: '楽天カードPDFのご請求金額を確認できませんでした。', severity: 'error' })
  const detailTotal = transactions.reduce((sum, transaction) => sum + (transaction.billingAmount ?? 0), 0)
  if (metadata.statementTotal != null && detailTotal !== metadata.statementTotal) {
    issues.push({
      code: 'RAKUTEN_PDF_TOTAL_MISMATCH',
      message: `PDFのご請求金額（${metadata.statementTotal.toLocaleString('ja-JP')}円）と明細合計（${detailTotal.toLocaleString('ja-JP')}円）が一致しません。原本は変更せず、返金・調整行をレビューで修正してください。`,
      severity: 'warning',
    })
  }

  const statement: CardStatementCandidate = {
    kind: 'card-statement',
    issuer: 'RAKUTEN_CARD',
    holderName: metadata.holderName,
    maskedCardNumber: metadata.maskedCardNumber,
    productName: metadata.productName,
    statementMonth: metadata.statementMonth,
    paymentDueOn: metadata.paymentDueOn ?? undefined,
    statementTotal: metadata.statementTotal,
    transactions,
  }
  return {
    parsed: {
      adapterId: 'rakuten-enavi-v1',
      records: [statement],
      issues,
      metadata: {
        sourceFormat: 'RAKUTEN_CARD_PDF_RKSJ',
        detailCount: transactions.length,
        detailTotal,
        statementDifference: metadata.statementTotal == null ? null : metadata.statementTotal - detailTotal,
        pageCount: document.pageCount ?? 1,
      },
    },
    detailCount: transactions.length,
  }
}
