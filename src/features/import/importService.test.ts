import { describe, expect, it } from 'vitest'
import { excelRowsToCsv, previewImportFile } from './importService'

describe('import preview service', () => {
  it('detects and parses a Japanese bank CSV file', async () => {
    const file = new File([
      '日付,摘要,摘要内容,支払い金額,預かり金額,差引残高,メモ,未資金化区分,入払区分\n' +
      '2026/07/27,ラクテンカードサービス,,204987,,100000,,,出',
    ], 'bank.csv', { type: 'text/csv' })

    const result = await previewImportFile(file)

    expect(result.adapterId).toBe('japanese-bank-ledger-v1')
    expect(result.recordCount).toBe(1)
    expect(result.status).toBe('ready')
  })

  it('keeps unsupported files in review instead of silently dropping them', async () => {
    const result = await previewImportFile(new File(['unknown,data\n1,2'], 'unknown.csv'))

    expect(result.status).toBe('unsupported')
    expect(result.issues[0].code).toBe('ADAPTER_NOT_FOUND')
  })

  it('serializes Excel rows without losing commas, quotes, or dates', () => {
    const rows = [
      ['日付', '摘要', '支払い金額'],
      [new Date(2026, 6, 27), 'SHOP, "TOKYO"', 204987],
    ]

    expect(excelRowsToCsv(rows)).toBe('日付,摘要,支払い金額\n2026/07/27,"SHOP, ""TOKYO""",204987')
  })

  it('keeps PDF bytes for explicit local extraction without auto-posting', async () => {
    const result = await previewImportFile(new File(['%PDF-1.4\n'], 'receipt.pdf', { type: 'application/pdf' }))

    expect(result.status).toBe('extractable')
    expect(result.adapterId).toBe('pdf-embedded-text-v1')
    expect(result.fileBytes).toBeInstanceOf(Uint8Array)
    expect(result.issues[0].code).toBe('DOCUMENT_EXTRACTION_REQUIRED')
  })
})
