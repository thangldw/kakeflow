import { describe, expect, it } from 'vitest'
import type { ExtractedDocumentDto } from '../../platform'
import { parseRakutenStatementPdf } from './rakutenStatementPdf'

function extracted(lines: readonly string[]): ExtractedDocumentDto {
  return {
    method: 'EMBEDDED_TEXT', text: lines.join('\n'), confidenceBps: 9800, issues: [], pageCount: 1,
    pages: [{ pageNumber: 1, widthPixels: null, heightPixels: null, confidenceBps: 9800, issues: [] }],
    regions: lines.map((text) => ({ pageNumber: 1, coordinateSpace: 'UNLOCATED', boundingBox: null, text, confidenceBps: 9800, provenance: 'PDF_EMBEDDED_TEXT_RKSJ' })),
  }
}

const header = [
  'ご利用代金請求明細書',
  '山田 太郎\t様',
  '楽天カード株式会社',
  '2025\t年\t09\t月ご請求金額',
  '3,000\t円\t楽天\tカード\t(Visa) ****-****-****-9127',
  'お支払日\t返済方法\t引落口座',
  '2025/09/29\t口座振替\tテスト銀行',
  '利用日\t利用店名\t利用者\t支払方法\t利用金額\t手数料\t/\t利息\t支払総額\t当月請求額\t翌月繰越残高',
]

describe('parseRakutenStatementPdf', () => {
  it('turns positioned Rakuten PDF rows into a reconciled card statement', () => {
    const result = parseRakutenStatementPdf(extracted([
      ...header,
      '2025/08/30\tSHOP A\t本人\t*\t1\t回払い\t1,200\t0\t1,200\t1,200\t0',
      '2025/08/31\tSHOP B\t本人\t*\t1\t回払い\t1,800\t0\t1,800\t1,800\t0',
    ]))
    expect(result?.parsed.issues).toEqual([])
    expect(result?.detailCount).toBe(2)
    expect(result?.parsed.records[0]).toMatchObject({
      issuer: 'RAKUTEN_CARD', statementMonth: '2025-09', statementTotal: 3000,
      paymentDueOn: '2025-09-29', maskedCardNumber: '****-****-****-9127', holderName: '山田 太郎',
    })
    expect(result?.parsed.records[0].transactions[0]).toMatchObject({
      usageDate: '2025-08-30', merchant: 'SHOP A', paymentMethod: '1回払い', billingAmount: 1200,
      sourceFields: {
        利用日: '2025/08/30', '利用店名・商品名': 'SHOP A', 利用者: '本人', 支払方法: '1回払い',
        利用金額: '1,200', '手数料/利息': '0', 支払総額: '1,200', 当月請求額: '1,200',
        翌月繰越残高: '0', 新規サイン: '*',
      },
    })
  })

  it('refuses to silently import when the statement and detail totals differ', () => {
    const result = parseRakutenStatementPdf(extracted([
      ...header,
      '2025/08/30\tSHOP A\t本人\t*\t1\t回払い\t1,200\t0\t1,200\t1,200\t0',
    ]))
    expect(result?.parsed.issues).toContainEqual(expect.objectContaining({ code: 'RAKUTEN_PDF_TOTAL_MISMATCH', severity: 'error' }))
  })

  it('leaves unrelated PDFs to the receipt/source-only flow', () => {
    expect(parseRakutenStatementPdf(extracted(['領収書', '合計 1,200円']))).toBeNull()
  })
})
