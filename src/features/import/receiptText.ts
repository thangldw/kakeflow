import type { ExtractedDocumentDto, StartImportDto } from '../../platform'
import type { ImportSourceType } from './importMapper'

export interface ReceiptTextFields {
  readonly merchant: string | null
  readonly occurredOn: string | null
  readonly amountJpy: number | null
  readonly confidenceBps: number
  readonly issues: readonly string[]
  readonly items: readonly ReceiptItemEvidence[]
  readonly taxes: readonly ReceiptTaxEvidence[]
  readonly couponEvidence: readonly ReceiptAdjustmentEvidence[]
  readonly pointsUsedEvidence: readonly ReceiptAdjustmentEvidence[]
  readonly couponAmountJpy: number | null
  readonly pointsUsedJpy: number | null
  readonly subtotalJpy: number | null
  readonly changeJpy: number | null
  readonly paymentMethod: string | null
  readonly taxMode: 'INCLUDED' | 'EXCLUDED' | 'MIXED' | null
  readonly reconciliation: ReceiptReconciliationEvidence
}

export interface ReceiptEvidenceProvenance {
  readonly lineNumber: number
  readonly regionIndexes: readonly number[]
  readonly method: 'TEXT_PATTERN'
}

export interface ReceiptItemEvidence {
  readonly description: string
  readonly quantity: number | null
  readonly amountJpy: number
  readonly taxRatePercent: 8 | 10 | null
  readonly confidenceBps: number
  readonly provenance: ReceiptEvidenceProvenance
}

export interface ReceiptAdjustmentEvidence {
  readonly amountJpy: number | null
  readonly confidenceBps: number
  readonly provenance: ReceiptEvidenceProvenance
}

export interface ReceiptReconciliationEvidence {
  readonly status: 'EXACT' | 'DELTA' | 'NO_ITEMS'
  readonly itemTotalJpy: number | null
  readonly totalAmountJpy: number | null
  /** Item total minus the extracted receipt total. No tax/discount allocation is inferred. */
  readonly deltaJpy: number | null
}

export interface ReceiptTaxEvidence {
  readonly ratePercent: 8 | 10
  readonly taxAmountJpy: number | null
  readonly taxableAmountJpy: number | null
  readonly confidenceBps: number
  readonly provenance: ReceiptEvidenceProvenance
}

export interface ReceiptPageResult {
  readonly pageNumber: number
  readonly fields: ReceiptTextFields
  readonly candidateCreated: boolean
}

function isoDate(year: string, month: string, day: string): string | null {
  const value = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value ? null : value
}

export function parseReceiptText(text: string): ReceiptTextFields {
  const normalizedText = text.normalize('NFKC')
  const lines = normalizedText.split(/\r?\n/).map((line, index) => ({ text: line.trim(), lineNumber: index + 1 })).filter((line) => Boolean(line.text))
  const lineTexts = lines.map((line) => line.text)
  const dateMatches = Array.from(normalizedText.matchAll(/(20\d{2})[/.年-]\s*(\d{1,2})[/.月-]\s*(\d{1,2})(?:日)?/g))
  const eraMatches = Array.from(normalizedText.matchAll(/(令和|平成)\s*(元|\d{1,2})年\s*(\d{1,2})月\s*(\d{1,2})日/g))
  const eraDate = eraMatches[0] ? isoDate(String((eraMatches[0][1] === '令和' ? 2018 : 1988) + (eraMatches[0][2] === '元' ? 1 : Number(eraMatches[0][2]))), eraMatches[0][3], eraMatches[0][4]) : null
  const occurredOn = dateMatches[0] ? isoDate(dateMatches[0][1], dateMatches[0][2], dateMatches[0][3]) : eraDate
  const parseLineAmount = (line: string): number | null => {
    const matches = Array.from(line.matchAll(/[-−]?\s*(?:¥|￥)?\s*([0-9]{1,3}(?:[,.][0-9]{3})+|[0-9]+)(?:円)?/g))
    if (matches.length === 0) return null
    const last = matches[matches.length - 1]
    const amount = Number(last[1].replace(/[,.]/g, ''))
    return Number.isSafeInteger(amount) ? amount : null
  }
  const amountAtOrAfter = (lineIndex: number): number | null => {
    const withoutTaxRate = lineTexts[lineIndex].replace(/(?:8|10)(?:\.0+)?\s*%/g, '')
    const inline = parseLineAmount(withoutTaxRate)
    if (inline !== null) return inline
    const next = lineTexts[lineIndex + 1]
    return next && /^[-−]?\s*(?:¥|￥)?\s*[0-9]{1,3}(?:[,.][0-9]{3})*(?:円)?$/.test(next) ? parseLineAmount(next) : null
  }
  const totalLineIndexes = lineTexts.flatMap((line, index) => /(?:合計|ご請求|お支払額|GRAND\s*TOTAL|TOTAL)/i.test(line) ? [index] : [])
  const totalLines = totalLineIndexes.map((index) => lineTexts[index])
  const amounts = totalLineIndexes.flatMap((index) => {
    const amount = amountAtOrAfter(index)
    return amount !== null && amount > 0 ? [amount] : []
  })
  const amountJpy = amounts.length > 0 ? Math.max(...amounts) : null
  const firstDateLine = lineTexts.findIndex((line) => /(?:20\d{2})[/.年-]|(?:令和|平成)\s*(?:元|\d{1,2})年/.test(line))
  const merchantHeader = firstDateLine >= 0 ? lineTexts.slice(0, firstDateLine) : lineTexts.slice(0, 6)
  const merchant = merchantHeader.find((line) => !/(?:レシ[ー\s-]*ト|RECEIPT|領収証?|登録番号|合計|TOTAL|TEL|電話)/i.test(line) && !/(20\d{2})[/.年-]/.test(line) && line.length >= 3) ?? null
  const provenance = (lineNumber: number): ReceiptEvidenceProvenance => ({ lineNumber, regionIndexes: [], method: 'TEXT_PATTERN' })
  const taxes: ReceiptTaxEvidence[] = lines.flatMap(({ text: line, lineNumber }, lineIndex) => {
    const rate = line.match(/(?:税|対象|税率)?\s*(8|10)(?:\.0+)?\s*%|(?:8|10)(?:\.0+)?\s*%(?:対象|税)/)
    if (!rate || !/(?:税|対象)/.test(line)) return []
    const ratePercent = Number(rate[1] ?? line.match(/(8|10)/)?.[1]) as 8 | 10
    const amount = amountAtOrAfter(lineIndex)
    return [{
      ratePercent,
      taxAmountJpy: /(?:消費税|税額|税金)/.test(line) || (/(?:内税|外税)/.test(line) && !/(?:対象|課税)/.test(line)) ? amount : null,
      taxableAmountJpy: /(?:対象|課税)/.test(line) ? amount : null,
      confidenceBps: amount === null ? 6500 : 8500,
      provenance: provenance(lineNumber),
    }]
  })
  const adjustmentEvidence = (pattern: RegExp): ReceiptAdjustmentEvidence[] => lines.flatMap(({ text: line, lineNumber }, lineIndex) => {
    if (!pattern.test(line)) return []
    const amountJpy = amountAtOrAfter(lineIndex)
    return [{ amountJpy, confidenceBps: amountJpy === null ? 5000 : 8500, provenance: provenance(lineNumber) }]
  })
  const adjustmentTotal = (evidence: readonly ReceiptAdjustmentEvidence[]) => {
    const amounts = evidence.flatMap((item) => item.amountJpy === null ? [] : [item.amountJpy])
    if (amounts.length === 0) return null
    const total = amounts.reduce((sum, amount) => sum + amount, 0)
    return Number.isSafeInteger(total) ? total : null
  }
  const couponEvidence = adjustmentEvidence(/(?:クーポン|値引|割引|COUPON)/i)
  const pointsUsedEvidence = adjustmentEvidence(/(?:ポイント利用|ポイント使用|POINTS?\s*(?:USED|REDEEMED))/i)
  const couponAmountJpy = adjustmentTotal(couponEvidence)
  const pointsUsedJpy = adjustmentTotal(pointsUsedEvidence)
  const singleAdjustmentAmount = (pattern: RegExp) => adjustmentEvidence(pattern)[0]?.amountJpy ?? null
  const subtotalJpy = singleAdjustmentAmount(/(?:小計|税抜合計|SUBTOTAL)/i)
  const changeJpy = singleAdjustmentAmount(/(?:お釣り?|おつり|釣銭|CHANGE)/i)
  const paymentLine = lines.find(({ text: value }) => /(?:支払|お支払|現金|现金|クレジット|デビット|電子マネー|PayPay|楽天ペイ|Suica|PASMO|WAON|nanaco|交通系|iD|QUICPay)/i.test(value))?.text ?? ''
  const paymentMethodPattern = /(PayPay|楽天ペイ|Suica|PASMO|WAON|nanaco|QUICPay|iD|交通系(?:IC)?|電子マネー|クレジット|デビット|現金|现金)/i
  const paymentMethodMatch = paymentLine.match(paymentMethodPattern)?.[1]
    ?? lines.map(({ text: value }) => value.match(paymentMethodPattern)?.[1] ?? null).find((value) => value !== null)
    ?? null
  const paymentMethod = paymentMethodMatch === '现金' ? '現金' : paymentMethodMatch
  const hasIncludedTax = lines.some(({ text: value }) => /(?:内税|税込)/.test(value))
  const hasExcludedTax = lines.some(({ text: value }) => /(?:外税|税抜)/.test(value))
  const taxMode = hasIncludedTax && hasExcludedTax ? 'MIXED' : hasIncludedTax ? 'INCLUDED' : hasExcludedTax ? 'EXCLUDED' : null
  const markerRates = new Map<string, 8 | 10>()
  for (const { text: line } of lines) {
    const marker = line.match(/([*※◇◆])\s*(?:は|:|=)?\s*(?:(?:軽減税率|8\s*%)|10\s*%)/)
    if (marker) markerRates.set(marker[1], /10\s*%/.test(marker[0]) ? 10 : 8)
  }
  const nonItem = /(?:合計|TOTAL|小計|SUBTOTAL|税|税込|税抜|対象|課税|クーポン|値引|割引|ポイント|お預り|お釣り?|おつり|釣銭|CHANGE|支払|現金|现金|クレジット|デビット|電子マネー|PayPay|楽天ペイ|Suica|PASMO|WAON|nanaco|QUICPay|交通系|領収|レシ[ー\s-]*ト|登録番号|TEL|電話)/i
  const items: ReceiptItemEvidence[] = lines.flatMap(({ text: line, lineNumber }, lineIndex) => {
    if (nonItem.test(line) || /(20\d{2})[/.年-]/.test(line)) return []
    const explicitRate = line.match(/(?:^|\s|\()(8|10)\s*%(?:\)|\s|$)/)
    const mappedMarker = [...markerRates.entries()].find(([marker]) => line.includes(marker))?.[1] ?? null
    const taxRatePercent = explicitRate ? Number(explicitRate[1]) as 8 | 10 : /(?:^|\s)軽(?:\s|$)/.test(line) ? 8 : mappedMarker
    const normalizedItemLine = line
      .replace(/\(?\s*(?:8|10)\s*%\s*\)?/g, ' ')
      .replace(/(?:^|\s)軽(?=\s|$)/g, ' ')
      .replace(/[＊*※◇◆]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const inlineMatch = normalizedItemLine.match(/^(.+?)\s+(?:¥|￥)?\s*([0-9]{1,3}(?:[,.][0-9]{3})+|[0-9]+)(?:円)?$/)
    const followingAmount = lineTexts[lineIndex + 1] && /^[-−]?\s*(?:¥|￥)?\s*[0-9]{1,3}(?:[,.][0-9]{3})*(?:円)?$/.test(lineTexts[lineIndex + 1])
      ? parseLineAmount(lineTexts[lineIndex + 1])
      : null
    const match = inlineMatch ?? (followingAmount !== null ? [normalizedItemLine, normalizedItemLine, String(followingAmount)] : null)
    if (!match) return []
    const amount = Number(match[2].replace(/[,.]/g, ''))
    if (!Number.isSafeInteger(amount) || amount <= 0) return []
    const quantity = match[1].match(/(?:(?:x|×)\s*(\d+)|(\d+)\s*(?:点|個|本))(?:\s*@\s*[0-9,]+)?$/i)
      ?? match[1].match(/@\s*[0-9,]+\s*(?:x|×)\s*(\d+)$/i)
    const quantityValue = quantity ? Number(quantity[1] ?? quantity[2]) : null
    const description = match[1]
      .replace(/@\s*[0-9,]+\s*(?:x|×)\s*\d+$/i, '')
      .replace(/(?:(?:x|×)\s*\d+|\d+\s*(?:点|個|本))(?:\s*@\s*[0-9,]+)?$/i, '')
      .trim()
    if (!description) return []
    return [{
      description,
      quantity: quantityValue,
      amountJpy: amount,
      taxRatePercent,
      confidenceBps: 8000,
      provenance: provenance(lineNumber),
    }]
  })
  const issues: string[] = []
  if (dateMatches.length + eraMatches.length > 3 || totalLines.length > 3) issues.push('STATEMENT_LIKELY')
  if (!merchant) issues.push('MERCHANT_MISSING')
  if (!occurredOn) issues.push('DATE_MISSING')
  if (!amountJpy) issues.push('TOTAL_MISSING')
  const confidenceBps = Math.max(0, 10_000 - issues.length * 2500)
  const itemTotalJpy = items.length === 0 ? null : items.reduce((sum, item) => sum + item.amountJpy, 0)
  const deltaJpy = itemTotalJpy === null || amountJpy === null ? null : itemTotalJpy - amountJpy
  const reconciliation: ReceiptReconciliationEvidence = {
    status: items.length === 0 ? 'NO_ITEMS' : deltaJpy === 0 ? 'EXACT' : 'DELTA',
    itemTotalJpy: Number.isSafeInteger(itemTotalJpy) ? itemTotalJpy : null,
    totalAmountJpy: amountJpy,
    deltaJpy: Number.isSafeInteger(deltaJpy) ? deltaJpy : null,
  }
  return { merchant, occurredOn, amountJpy, confidenceBps, issues, items, taxes, couponEvidence, pointsUsedEvidence, couponAmountJpy, pointsUsedJpy, subtotalJpy, changeJpy, paymentMethod, taxMode, reconciliation }
}

export async function buildReceiptImport(
  extracted: ExtractedDocumentDto,
  file: {
    householdId: string
    filename: string
    mediaType: string
    byteSize: number
    sha256: string
    sourceModifiedAt: string | null
    accountId: string
    sourceType?: ImportSourceType
    audienceVisibility?: 'SHARED' | 'PERSONAL'
    audienceMemberId?: string | null
    attributionKind?: 'HOUSEHOLD' | 'MEMBER'
    attributedMemberId?: string | null
  },
  id: () => string,
  hash: (value: string) => Promise<string>,
): Promise<{ request: StartImportDto | null; fields: ReceiptTextFields; pageResults: readonly ReceiptPageResult[] }> {
  const parsedFields = parseReceiptText(extracted.text)
  const isMultiPageDocument = (extracted.pageCount ?? 1) > 1
  const fields: ReceiptTextFields = isMultiPageDocument
    ? { ...parsedFields, issues: [...parsedFields.issues, 'MULTI_PAGE_DOCUMENT'] }
    : parsedFields
  const pageText = (pageNumber: number) => {
    const regions = (extracted.regions ?? []).filter((region) => region.pageNumber === pageNumber)
    const lines = regions.filter((region) => region.provenance === 'TESSERACT_LINE')
    const preferred = lines.length > 0 ? lines : regions.filter((region) => region.provenance !== 'TESSERACT_WORD')
    return preferred.map((region) => region.text.trim()).filter(Boolean).join('\n')
  }
  const pageResults: ReceiptPageResult[] = isMultiPageDocument
    ? Array.from({ length: extracted.pageCount ?? 0 }, (_, index) => {
      const pageNumber = index + 1
      const pageFields = parseReceiptText(pageText(pageNumber))
      return {
        pageNumber,
        fields: pageFields,
        candidateCreated: Boolean(pageFields.occurredOn && pageFields.amountJpy && !pageFields.issues.includes('STATEMENT_LIKELY')),
      }
    })
    : [{
      pageNumber: 1,
      fields,
      candidateCreated: Boolean(fields.occurredOn && fields.amountJpy && !fields.issues.includes('STATEMENT_LIKELY')),
    }]
  if (!isMultiPageDocument && !pageResults[0].candidateCreated) return { request: null, fields, pageResults }
  const regionIndexesForLine = (document: ExtractedDocumentDto, lineNumber: number) => {
    const matches = (document.regions ?? [])
    .map((region, index) => ({ region, index }))
    .filter(({ region }) => region.text.trim() === document.text.split(/\r?\n/)[lineNumber - 1]?.trim())
    const lines = matches.filter(({ region }) => region.provenance === 'TESSERACT_LINE')
    return (lines.length ? lines : matches).map(({ index }) => index)
  }
  const receiptEvidence = (document: ExtractedDocumentDto, receiptFields: ReceiptTextFields) => ({
    ...receiptFields,
    items: receiptFields.items.map((item) => ({ ...item, provenance: { ...item.provenance, regionIndexes: regionIndexesForLine(document, item.provenance.lineNumber) } })),
    taxes: receiptFields.taxes.map((tax) => ({ ...tax, provenance: { ...tax.provenance, regionIndexes: regionIndexesForLine(document, tax.provenance.lineNumber) } })),
    couponEvidence: receiptFields.couponEvidence.map((item) => ({ ...item, provenance: { ...item.provenance, regionIndexes: regionIndexesForLine(document, item.provenance.lineNumber) } })),
    pointsUsedEvidence: receiptFields.pointsUsedEvidence.map((item) => ({ ...item, provenance: { ...item.provenance, regionIndexes: regionIndexesForLine(document, item.provenance.lineNumber) } })),
  })
  const receiptPages = pageResults.map((pageResult) => {
    const regions = (extracted.regions ?? []).filter((region) => region.pageNumber === pageResult.pageNumber)
    const page = extracted.pages?.find((value) => value.pageNumber === pageResult.pageNumber)
    const document: ExtractedDocumentDto = {
      method: extracted.method,
      text: pageText(pageResult.pageNumber),
      confidenceBps: page?.confidenceBps ?? extracted.confidenceBps,
      issues: page?.issues ?? [],
      regions,
      pageCount: 1,
      pages: page ? [{ ...page, pageNumber: 1 }] : [],
    }
    return { pageNumber: pageResult.pageNumber, candidateCreated: pageResult.candidateCreated, receipt: receiptEvidence(document, pageResult.fields) }
  })
  const primaryReceipt = isMultiPageDocument
    ? receiptPages.find((page) => page.candidateCreated)?.receipt ?? null
    : receiptEvidence(extracted, fields)
  const documentPayloadJson = JSON.stringify({
    evidenceVersion: 5,
    extraction: { ...extracted, regions: extracted.regions ?? [], pages: extracted.pages ?? [] },
    receipt: isMultiPageDocument ? null : primaryReceipt,
    receiptPages,
    documentClassification: isMultiPageDocument ? 'PAGE_WISE_RECEIPT_REVIEW' : 'SINGLE_RECEIPT',
  })
  const documentRecordId = id()
  const audienceVisibility = file.audienceVisibility ?? 'SHARED'
  const audienceMemberId = audienceVisibility === 'PERSONAL' ? file.audienceMemberId ?? null : null
  const attributionKind = file.attributionKind ?? 'HOUSEHOLD'
  const attributedMemberId = attributionKind === 'MEMBER' ? file.attributedMemberId ?? null : null
  const candidatePages = pageResults.filter((page) => page.candidateCreated).map((page) => {
    if (!isMultiPageDocument) return { page, recordId: documentRecordId, payloadJson: documentPayloadJson }
    const pageOutcome = extracted.pages?.find((value) => value.pageNumber === page.pageNumber)
    const pageExtraction = {
      method: extracted.method,
      text: pageText(page.pageNumber),
      confidenceBps: pageOutcome?.confidenceBps ?? extracted.confidenceBps,
      issues: pageOutcome?.issues ?? [],
      regions: (extracted.regions ?? []).filter((region) => region.pageNumber === page.pageNumber),
      pageCount: 1,
      pages: pageOutcome ? [pageOutcome] : [],
    }
    return {
      page,
      recordId: id(),
      payloadJson: JSON.stringify({ evidenceVersion: 5, extraction: pageExtraction, receipt: receiptPages.find((value) => value.pageNumber === page.pageNumber)?.receipt ?? null, documentPageNumber: page.pageNumber }),
    }
  })
  const candidates = candidatePages.map(({ page, recordId }) => ({
      id: id(), accountId: file.accountId, occurredOn: page.fields.occurredOn!, postedOn: null,
      amountJpy: page.fields.amountJpy!, direction: 'OUT' as const,
      descriptionRaw: isMultiPageDocument ? `Receipt document page ${page.pageNumber}` : 'Receipt document', merchantRaw: page.fields.merchant,
      externalTransactionId: null, extractionConfidenceBps: extracted.pages?.find((value) => value.pageNumber === page.pageNumber)?.confidenceBps ?? extracted.confidenceBps,
      externalSource: null, externalFactHash: null, calculationTarget: true, suggestedTransactionType: null,
      institutionRaw: null, categoryMajorRaw: null, categoryMinorRaw: null, memoRaw: null,
      normalizationConfidenceBps: page.fields.confidenceBps,
      attributionKind, attributedMemberId, audienceVisibility, audienceMemberId,
      reviewStatus: Math.min(extracted.pages?.find((value) => value.pageNumber === page.pageNumber)?.confidenceBps ?? extracted.confidenceBps, page.fields.confidenceBps) >= 7500 ? 'READY' as const : 'PENDING' as const,
      evidence: isMultiPageDocument
        ? [{ sourceRecordId: recordId, role: 'PRIMARY' as const }, { sourceRecordId: documentRecordId, role: 'SUPPORTING' as const }]
        : [{ sourceRecordId: documentRecordId, role: 'PRIMARY' as const }],
    }))
  const records = await Promise.all([
    { id: documentRecordId, rowNumber: 1, payloadJson: documentPayloadJson },
    ...candidatePages.filter(() => isMultiPageDocument).map(({ recordId, payloadJson, page }) => ({ id: recordId, rowNumber: page.pageNumber + 1, payloadJson })),
  ].map(async (record) => ({ ...record, recordHash: await hash(record.payloadJson) })))
  return {
    fields, pageResults,
    request: {
      runId: id(), documentId: id(), householdId: file.householdId, sourceType: file.sourceType ?? 'MANUAL_UPLOAD',
      originalFilename: file.filename, mediaType: file.mediaType, byteSize: file.byteSize, sha256: file.sha256,
      sourceModifiedAt: file.sourceModifiedAt, adapterId: 'receipt-text-v2', adapterVersion: '2',
      audienceVisibility, audienceMemberId,
      records, candidates,
      cardStatements: [],
    },
  }
}
