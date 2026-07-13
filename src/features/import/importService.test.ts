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

  it('detects the official Yucho Direct CSV after its account preamble', async () => {
    const file = new File([
      'お客さま口座情報\n' +
      '現在高：,140000,円\n' +
      '取引日,入出金明細ID,受入金額（円）,払出金額（円）,詳細1,詳細2,現在（貸付）高\n' +
      '20260701,1,50000,,給与,勤務先,150000\n' +
      '20260702,2,,10000,カード,ATM,140000',
    ], 'yucho-direct.csv', { type: 'text/csv' })

    const result = await previewImportFile(file)

    expect(result).toMatchObject({ adapterId: 'yucho-direct-ledger-v1', recordCount: 2, status: 'ready' })
    expect(result.parsed?.metadata).toMatchObject({ institution: 'JP_BANK', exportSequenceIsDurableTransactionId: false })
  })

  it('detects the official Money Forward ME household-ledger export', async () => {
    const file = new File([
      '計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID\n' +
      '1,2026/07/27,給与,300000,MUFG,収入,給与,7月分,0,mf-1',
    ], 'money-forward.csv', { type: 'text/csv' })
    const result = await previewImportFile(file)
    expect(result).toMatchObject({ adapterId: 'money-forward-me-household-ledger-v1', recordCount: 1, status: 'ready' })
  })

  it('keeps unsupported files in review instead of silently dropping them', async () => {
    const result = await previewImportFile(new File(['unknown,data\n1,2'], 'unknown.csv'))

    expect(result.status).toBe('unsupported')
    expect(result.issues[0].code).toBe('ADAPTER_NOT_FOUND')
    expect(result.fileBytes).toBeInstanceOf(Uint8Array)
    expect(result.mediaType).toBe('text/csv')
    expect(result.sourceModifiedAt).toBeTruthy()
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

  it.each([
    ['receipt.png', 'image/png', 'image/png'],
    ['receipt.jpg', 'image/jpeg', 'image/jpeg'],
    ['receipt.jpeg', '', 'image/jpeg'],
  ])('keeps %s bytes for explicit local OCR', async (filename, inputType, expectedType) => {
    const result = await previewImportFile(new File([new Uint8Array([1, 2, 3])], filename, { type: inputType }))

    expect(result).toMatchObject({
      status: 'extractable',
      adapterId: 'receipt-image-ocr-v1',
      mediaType: expectedType,
      encoding: 'binary',
    })
    expect(result.fileBytes).toBeInstanceOf(Uint8Array)
    expect(result.issues[0].message).toContain('OCR')
  })

  it('enforces the OCR backend image size limit before reading bytes', async () => {
    const file = new File([], 'large.png', { type: 'image/png' })
    Object.defineProperty(file, 'size', { value: 20 * 1024 * 1024 + 1 })

    const result = await previewImportFile(file)

    expect(result.status).toBe('error')
    expect(result.issues[0]).toMatchObject({ code: 'FILE_TOO_LARGE', message: 'レシート画像は20MB以下にしてください。' })
  })
})
