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
})
