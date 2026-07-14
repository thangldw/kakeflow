import type { ExtractedDocumentDto, StartImportDto } from '../../platform'

export interface ReceiptTextFields {
  readonly merchant: string | null
  readonly occurredOn: string | null
  readonly amountJpy: number | null
  readonly confidenceBps: number
  readonly issues: readonly string[]
  readonly items: readonly ReceiptItemEvidence[]
  readonly taxes: readonly ReceiptTaxEvidence[]
  readonly couponAmountJpy: number | null
  readonly pointsUsedJpy: number | null
  readonly subtotalJpy: number | null
  readonly changeJpy: number | null
  readonly paymentMethod: string | null
  readonly taxMode: 'INCLUDED' | 'EXCLUDED' | 'MIXED' | null
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
  readonly confidenceBps: number
  readonly provenance: ReceiptEvidenceProvenance
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
  const totalLines = lineTexts.filter((line) => /(?:合計|お買上|ご請求|お支払額|GRAND\s*TOTAL|TOTAL)/i.test(line))
  const amounts = totalLines.flatMap((line) => Array.from(line.matchAll(/(?:¥|￥)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)/g), (match) => Number(match[1].replaceAll(',', '')))).filter((amount) => Number.isSafeInteger(amount) && amount > 0)
  const amountJpy = amounts.length > 0 ? Math.max(...amounts) : null
  const merchant = lineTexts.find((line) => !/(?:レシート|RECEIPT|合計|TOTAL)/i.test(line) && !/(20\d{2})[/.年-]/.test(line)) ?? null
  const provenance = (lineNumber: number): ReceiptEvidenceProvenance => ({ lineNumber, regionIndexes: [], method: 'TEXT_PATTERN' })
  const parseLineAmount = (line: string): number | null => {
    const matches = Array.from(line.matchAll(/[-−]?\s*(?:¥|￥)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:円)?/g))
    if (matches.length === 0) return null
    const last = matches[matches.length - 1]
    const amount = Number(last[1].replaceAll(',', ''))
    return Number.isSafeInteger(amount) ? amount : null
  }
  const taxes: ReceiptTaxEvidence[] = lines.flatMap(({ text: line, lineNumber }) => {
    const rate = line.match(/(?:税|対象|税率)?\s*(8|10)\s*%|(?:8|10)\s*%(?:対象|税)/)
    if (!rate || !/(?:税|対象)/.test(line)) return []
    const ratePercent = Number(rate[1] ?? line.match(/(8|10)/)?.[1]) as 8 | 10
    const amount = parseLineAmount(line)
    return [{
      ratePercent,
      taxAmountJpy: /(?:消費税|税額|内税|外税)/.test(line) ? amount : null,
      taxableAmountJpy: /(?:対象|課税)/.test(line) ? amount : null,
      confidenceBps: amount === null ? 6500 : 8500,
      provenance: provenance(lineNumber),
    }]
  })
  const adjustmentAmount = (pattern: RegExp) => {
    const line = lines.find(({ text: value }) => pattern.test(value))
    return line ? parseLineAmount(line.text) : null
  }
  const couponAmountJpy = adjustmentAmount(/(?:クーポン|値引|割引|COUPON)/i)
  const pointsUsedJpy = adjustmentAmount(/(?:ポイント利用|ポイント使用|POINTS?\s*(?:USED|REDEEMED))/i)
  const subtotalJpy = adjustmentAmount(/(?:小計|税抜合計|SUBTOTAL)/i)
  const changeJpy = adjustmentAmount(/(?:お釣り|おつり|釣銭|CHANGE)/i)
  const paymentLine = lines.find(({ text: value }) => /(?:支払|お支払|現金|クレジット|デビット|電子マネー|PayPay|楽天ペイ|Suica|PASMO|WAON|nanaco|交通系|iD|QUICPay)/i.test(value))?.text ?? ''
  const paymentMethod = paymentLine.match(/(PayPay|楽天ペイ|Suica|PASMO|WAON|nanaco|QUICPay|iD|交通系(?:IC)?|電子マネー|クレジット|デビット|現金)/i)?.[1] ?? null
  const hasIncludedTax = lines.some(({ text: value }) => /(?:内税|税込)/.test(value))
  const hasExcludedTax = lines.some(({ text: value }) => /(?:外税|税抜)/.test(value))
  const taxMode = hasIncludedTax && hasExcludedTax ? 'MIXED' : hasIncludedTax ? 'INCLUDED' : hasExcludedTax ? 'EXCLUDED' : null
  const nonItem = /(?:合計|TOTAL|小計|SUBTOTAL|税|税込|税抜|対象|課税|クーポン|値引|割引|ポイント|お預り|お釣り|おつり|釣銭|CHANGE|現金|クレジット|デビット|電子マネー|PayPay|楽天ペイ|Suica|PASMO|WAON|nanaco|QUICPay|交通系|領収|レシート|登録番号|TEL|電話)/i
  const items: ReceiptItemEvidence[] = lines.flatMap(({ text: line, lineNumber }) => {
    if (nonItem.test(line) || /(20\d{2})[/.年-]/.test(line)) return []
    const match = line.match(/^(.+?)\s+(?:¥|￥)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:円)?(?:\s*[*※])?$/)
    if (!match) return []
    const amount = Number(match[2].replaceAll(',', ''))
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
  return { merchant, occurredOn, amountJpy, confidenceBps, issues, items, taxes, couponAmountJpy, pointsUsedJpy, subtotalJpy, changeJpy, paymentMethod, taxMode }
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
    sourceType?: 'MANUAL_UPLOAD' | 'LOCAL_FOLDER' | 'CAMERA_SCAN'
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
    evidenceVersion: 4,
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
      payloadJson: JSON.stringify({ evidenceVersion: 4, extraction: pageExtraction, receipt: receiptPages.find((value) => value.pageNumber === page.pageNumber)?.receipt ?? null, documentPageNumber: page.pageNumber }),
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
