import { describe, expect, it } from 'vitest'
import { buildReceiptImport, parseReceiptText } from './receiptText'

describe('receipt text normalization', () => {
  it('extracts merchant, Japanese date and receipt total', () => {
    expect(parseReceiptText('セブンイレブン 新宿店\n2026年7月12日 18:42\n合計 ¥1,480')).toMatchObject({
      merchant: 'セブンイレブン 新宿店', occurredOn: '2026-07-12', amountJpy: 1480, confidenceBps: 10000,
    })
  })

  it('refuses statement-like text instead of creating an aggregate expense', async () => {
    const extracted = { method: 'EMBEDDED_TEXT' as const, confidenceBps: 9000, issues: [], text: 'CARD\n2026/07/01 A\n2026/07/02 B\n2026/07/03 C\n2026/07/04 D\nTOTAL 20,000' }
    const result = await buildReceiptImport(extracted, {
      householdId: 'family', filename: 'statement.pdf', mediaType: 'application/pdf', byteSize: 100,
      sha256: 'a'.repeat(64), sourceModifiedAt: null, accountId: 'family-cash',
    }, () => 'id', async () => 'b'.repeat(64))
    expect(result.request).toBeNull()
    expect(result.fields.issues).toContain('STATEMENT_LIKELY')
  })

  it('preserves a multi-page OCR document and creates candidates only for independently parseable receipt pages', async () => {
    const lines = (pageNumber: number, text: string) => text.split('\n').map((line) => ({
      pageNumber, coordinateSpace: 'PIXELS' as const, boundingBox: { left: 0, top: 0, width: 100, height: 20 },
      text: line, confidenceBps: 9000, provenance: 'TESSERACT_LINE',
    }))
    const extracted = {
      method: 'OCR' as const,
      confidenceBps: 8600,
      issues: [],
      text: 'スーパーA\n2026/07/12\n合計 1,200\nCARD STATEMENT\n2026/07/01 A\n2026/07/02 B\n2026/07/03 C\n2026/07/04 D\nTOTAL 20,000\nOCRできないページ',
      pageCount: 3,
      pages: [
        { pageNumber: 1, widthPixels: 1000, heightPixels: 1400, confidenceBps: 9200, issues: [] },
        { pageNumber: 2, widthPixels: 1000, heightPixels: 1400, confidenceBps: 8700, issues: [] },
        { pageNumber: 3, widthPixels: 1000, heightPixels: 1400, confidenceBps: 3000, issues: ['NO_TEXT'] },
      ],
      regions: [
        ...lines(1, 'スーパーA\n2026/07/12\n合計 1,200'),
        ...lines(2, 'CARD STATEMENT\n2026/07/01 A\n2026/07/02 B\n2026/07/03 C\n2026/07/04 D\nTOTAL 20,000'),
        ...lines(3, 'OCRできないページ'),
      ],
    }
    let sequence = 0
    const result = await buildReceiptImport(extracted, {
      householdId: 'family', filename: 'mixed.pdf', mediaType: 'application/pdf', byteSize: 100,
      sha256: 'a'.repeat(64), sourceModifiedAt: null, accountId: 'family-cash',
    }, () => `id-${++sequence}`, async () => 'b'.repeat(64))

    expect(result.request).not.toBeNull()
    expect(result.request?.records).toHaveLength(2)
    expect(result.request?.candidates).toEqual([
      expect.objectContaining({ occurredOn: '2026-07-12', amountJpy: 1200, merchantRaw: 'スーパーA', descriptionRaw: 'Receipt document page 1' }),
    ])
    expect(result.pageResults.map(({ pageNumber, candidateCreated }) => ({ pageNumber, candidateCreated }))).toEqual([
      { pageNumber: 1, candidateCreated: true },
      { pageNumber: 2, candidateCreated: false },
      { pageNumber: 3, candidateCreated: false },
    ])
    const payload = JSON.parse(result.request!.records[0].payloadJson)
    expect(payload).toMatchObject({ evidenceVersion: 4, documentClassification: 'PAGE_WISE_RECEIPT_REVIEW' })
    expect(payload.extraction.pages).toHaveLength(3)
    expect(payload.receiptPages).toHaveLength(3)
    const pagePayload = JSON.parse(result.request!.records[1].payloadJson)
    expect(pagePayload).toMatchObject({ documentPageNumber: 1, receipt: { amountJpy: 1200 } })
    expect(result.request?.candidates[0].evidence).toEqual([
      { sourceRecordId: result.request?.records[1].id, role: 'PRIMARY' },
      { sourceRecordId: result.request?.records[0].id, role: 'SUPPORTING' },
    ])
  })

  it('preserves a multi-page statement OCR as source evidence without creating an aggregate expense', async () => {
    const statement = 'CARD STATEMENT\n2026/07/01 A\n2026/07/02 B\n2026/07/03 C\n2026/07/04 D\nTOTAL 20,000'
    const result = await buildReceiptImport({
      method: 'OCR', text: statement, confidenceBps: 9000, issues: [], pageCount: 2,
      pages: [
        { pageNumber: 1, widthPixels: 1000, heightPixels: 1400, confidenceBps: 9000, issues: [] },
        { pageNumber: 2, widthPixels: 1000, heightPixels: 1400, confidenceBps: 0, issues: ['NO_TEXT'] },
      ],
      regions: statement.split('\n').map((text) => ({ pageNumber: 1, coordinateSpace: 'PIXELS', boundingBox: null, text, confidenceBps: 9000, provenance: 'TESSERACT_LINE' })),
    }, {
      householdId: 'family', filename: 'statement.pdf', mediaType: 'application/pdf', byteSize: 100,
      sha256: 'a'.repeat(64), sourceModifiedAt: null, accountId: 'family-cash',
    }, () => globalThis.crypto.randomUUID(), async () => 'b'.repeat(64))

    expect(result.request?.records).toHaveLength(1)
    expect(result.request?.candidates).toEqual([])
    expect(result.pageResults.every((page) => !page.candidateCreated)).toBe(true)
  })

  it('keeps a complete but low-confidence OCR result pending for human review', async () => {
    const extracted = { method: 'OCR' as const, confidenceBps: 6200, issues: ['LOW_CONFIDENCE'], text: 'セブンイレブン\n2026/07/12\n合計 1,480' }
    const result = await buildReceiptImport(extracted, {
      householdId: 'family', filename: 'receipt.jpg', mediaType: 'image/jpeg', byteSize: 100,
      sha256: 'a'.repeat(64), sourceModifiedAt: null, accountId: 'family-cash',
    }, () => globalThis.crypto.randomUUID(), async () => 'b'.repeat(64))

    expect(result.request?.candidates[0]).toMatchObject({
      extractionConfidenceBps: 6200,
      normalizationConfidenceBps: 10000,
      reviewStatus: 'PENDING',
      attributionKind: 'HOUSEHOLD', attributedMemberId: null,
      audienceVisibility: 'SHARED', audienceMemberId: null,
    })
    expect(result.request).toMatchObject({ audienceVisibility: 'SHARED', audienceMemberId: null })
  })

  it('preserves a personal mobile capture scope through the review candidate', async () => {
    const extracted = { method: 'OCR' as const, confidenceBps: 9000, issues: [], text: 'スーパー\n2026/07/12\n合計 1,480' }
    const result = await buildReceiptImport(extracted, {
      householdId: 'family', filename: 'mobile.jpg', mediaType: 'image/jpeg', byteSize: 100,
      sha256: 'a'.repeat(64), sourceModifiedAt: '2026-07-12T10:00:00Z', accountId: 'family-cash',
      sourceType: 'CAMERA_SCAN', audienceVisibility: 'PERSONAL', audienceMemberId: 'member-a',
      attributionKind: 'MEMBER', attributedMemberId: 'member-a',
    }, () => globalThis.crypto.randomUUID(), async () => 'b'.repeat(64))

    expect(result.request).toMatchObject({
      sourceType: 'CAMERA_SCAN', audienceVisibility: 'PERSONAL', audienceMemberId: 'member-a',
      candidates: [expect.objectContaining({
        attributionKind: 'MEMBER', attributedMemberId: 'member-a',
        audienceVisibility: 'PERSONAL', audienceMemberId: 'member-a', reviewStatus: 'READY',
      })],
    })
  })

  it('extracts item, Japanese tax, coupon and points evidence with line provenance', () => {
    const receipt = parseReceiptText([
      'スーパー新宿店',
      '2026年7月12日',
      '牛乳 238',
      '洗剤 x2 760',
      '8%対象 238',
      '消費税10% 69',
      'クーポン -100',
      'ポイント利用 41',
      '合計 926',
    ].join('\n'))

    expect(receipt.items).toEqual([
      expect.objectContaining({ description: '牛乳', amountJpy: 238, quantity: null, provenance: expect.objectContaining({ lineNumber: 3 }) }),
      expect.objectContaining({ description: '洗剤', amountJpy: 760, quantity: 2, provenance: expect.objectContaining({ lineNumber: 4 }) }),
    ])
    expect(receipt.taxes).toEqual([
      expect.objectContaining({ ratePercent: 8, taxableAmountJpy: 238, provenance: expect.objectContaining({ lineNumber: 5 }) }),
      expect.objectContaining({ ratePercent: 10, taxAmountJpy: 69, provenance: expect.objectContaining({ lineNumber: 6 }) }),
    ])
    expect(receipt).toMatchObject({ couponAmountJpy: 100, pointsUsedJpy: 41 })
  })

  it('separates quantity, subtotal, payment and change lines from Japanese items', () => {
    const receipt = parseReceiptText([
      'スーパー東京店',
      '2026/07/13',
      'りんご 2点 @120 240',
      '洗剤 @380 ×2 760',
      '小計 1,000',
      '10%対象(外税) 1,000',
      '消費税10% 100',
      '合計 1,100',
      'クレジット お支払 1,100',
      'お釣り 0',
    ].join('\n'))

    expect(receipt.items).toEqual([
      expect.objectContaining({ description: 'りんご', quantity: 2, amountJpy: 240 }),
      expect.objectContaining({ description: '洗剤', quantity: 2, amountJpy: 760 }),
    ])
    expect(receipt).toMatchObject({ subtotalJpy: 1000, changeJpy: 0, paymentMethod: 'クレジット', taxMode: 'EXCLUDED' })
  })

  it('normalizes full-width receipt text and Japanese era dates', () => {
    const receipt = parseReceiptText([
      'コンビニ東京店',
      '令和８年７月１３日',
      'おにぎり ２個 ３２０円',
      '税込合計 ￥３２０',
      'Ｓｕｉｃａ お支払額 ￥３２０',
    ].join('\n'))

    expect(receipt).toMatchObject({ occurredOn: '2026-07-13', amountJpy: 320, paymentMethod: 'Suica', taxMode: 'INCLUDED' })
    expect(receipt.items).toEqual([expect.objectContaining({ description: 'おにぎり', quantity: 2, amountJpy: 320 })])
  })
})
