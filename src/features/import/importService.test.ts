import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { excelRowsToCsv, previewImportFile, previewImportFiles } from './importService'

describe('import preview service', () => {
  it('keeps an RFC 5322 email immutable while parsing its one supported attachment', async () => {
    const csv = '日付,摘要,摘要内容,支払い金額,預かり金額,差引残高,メモ,未資金化区分,入払区分\n2026/07/27,ラクテンカードサービス,,204987,,100000,,,出'
    const boundary = 'kakeflow-email-boundary'
    const source = [
      'From: bank@example.test', 'To: family@example.test', 'Subject: statement', 'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`,
      'Content-Type: text/csv; name="bank.csv"', 'Content-Disposition: attachment; filename="bank.csv"',
      'Content-Transfer-Encoding: base64', '', Buffer.from(csv).toString('base64'), `--${boundary}--`, '',
    ].join('\r\n')
    const original = new TextEncoder().encode(source)
    const result = await previewImportFile(new File([original], 'statement.eml', { type: 'message/rfc822', lastModified: 1_700_000_000_000 }))

    expect(result).toMatchObject({
      filename: 'statement.eml', emailAttachmentName: 'bank.csv', adapterId: 'personal-japanese-bank-ledger-v2',
      mediaType: 'message/rfc822', encoding: 'eml / utf-8', recordCount: 1, status: 'ready',
      sourceModifiedAt: '2023-11-14T22:13:20.000Z',
    })
    expect(Array.from(result.fileBytes ?? [])).toEqual(Array.from(original))
    expect((result.parsed?.records[0] as { lineage: { sourcePart?: string } }).lineage.sourcePart).toBe('bank.csv')
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'EMAIL_ATTACHMENT_SELECTED', severity: 'warning' }))
  })

  it('blocks an email with multiple importable attachments instead of choosing one', async () => {
    const boundary = 'multi'
    const attachment = (name: string) => [`--${boundary}`, `Content-Type: text/csv; name="${name}"`, `Content-Disposition: attachment; filename="${name}"`, '', 'a,b'].join('\r\n')
    const source = ['MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '', attachment('bank.csv'), attachment('card.csv'), `--${boundary}--`, ''].join('\r\n')
    const result = await previewImportFile(new File([source], 'multiple.eml', { type: 'message/rfc822' }))
    expect(result).toMatchObject({ filename: 'multiple.eml', status: 'error', mediaType: 'message/rfc822' })
    expect(result.issues[0].code).toBe('EMAIL_MULTIPLE_SUPPORTED_ATTACHMENTS')
  })

  it('detects and parses a Japanese bank CSV file', async () => {
    const file = new File([
      '日付,摘要,摘要内容,支払い金額,預かり金額,差引残高,メモ,未資金化区分,入払区分\n' +
      '2026/07/27,ラクテンカードサービス,,204987,,100000,,,出',
    ], 'bank.csv', { type: 'text/csv' })

    const result = await previewImportFile(file)

    expect(result.adapterId).toBe('personal-japanese-bank-ledger-v2')
    expect(result.recordCount).toBe(1)
    expect(result.status).toBe('ready')
  })

  it('decodes a CP932 strict personal-bank ledger before exact v2 detection', async () => {
    const bytes = new Uint8Array([
      0x93, 0xfa, 0x95, 0x74, 0x2c, 0x93, 0x45, 0x97, 0x76, 0x2c, 0x93, 0x45,
      0x97, 0x76, 0x93, 0xe0, 0x97, 0x65, 0x2c, 0x8e, 0x78, 0x95, 0xa5, 0x82,
      0xa2, 0x8b, 0xe0, 0x8a, 0x7a, 0x2c, 0x97, 0x61, 0x82, 0xa9, 0x82, 0xe8,
      0x8b, 0xe0, 0x8a, 0x7a, 0x2c, 0x8d, 0xb7, 0x88, 0xf8, 0x8e, 0x63, 0x8d,
      0x82, 0x2c, 0x83, 0x81, 0x83, 0x82, 0x2c, 0x96, 0xa2, 0x8e, 0x91, 0x8b,
      0xe0, 0x89, 0xbb, 0x8b, 0xe6, 0x95, 0xaa, 0x2c, 0x93, 0xfc, 0x95, 0xa5,
      0x8b, 0xe6, 0x95, 0xaa, 0x0a, 0x32, 0x30, 0x32, 0x36, 0x2f, 0x30, 0x37,
      0x2f, 0x32, 0x37, 0x2c, 0x83, 0x89, 0x83, 0x4e, 0x83, 0x65, 0x83, 0x93,
      0x83, 0x4a, 0x81, 0x5b, 0x83, 0x68, 0x83, 0x54, 0x81, 0x5b, 0x83, 0x72,
      0x83, 0x58, 0x2c, 0x2c, 0x32, 0x30, 0x34, 0x39, 0x38, 0x37, 0x2c, 0x2c,
      0x31, 0x30, 0x30, 0x30, 0x30, 0x30, 0x2c, 0x2c, 0x2c, 0x8f, 0x6f,
    ])
    const result = await previewImportFile(new File([bytes], 'personal-bank-cp932.csv', { type: 'text/csv' }))

    expect(result).toMatchObject({
      adapterId: 'personal-japanese-bank-ledger-v2', encoding: 'shift_jis', recordCount: 1, status: 'ready',
    })
    expect(result.parsed?.records[0]).toMatchObject({
      description: 'ラクテンカードサービス', outgoingAmount: 204987, balance: 100000,
    })
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

  it('expands a manual Yucho ZIP into ordinary child previews with archive provenance', async () => {
    const csv = 'お客さま口座情報\n現在高：,140000,円\n取引日,入出金明細ID,受入金額（円）,払出金額（円）,詳細1,詳細2,現在（貸付）高\n20260701,1,50000,,給与,勤務先,150000'
    const zip = zipSync({ '002.csv': new TextEncoder().encode(`${csv}\n20260702,2,,1000,ATM,払出,149000`), '001.csv': new TextEncoder().encode(csv), '説明.txt': new TextEncoder().encode('ignored') })
    const result = await previewImportFiles([new File([zip], 'ゆうちょ一括.zip', { type: 'application/zip', lastModified: 1_700_000_000_000 })])
    expect(result).toHaveLength(2)
    expect(result.map((item) => item.archiveEntryName)).toEqual(['001.csv', '002.csv'])
    expect(result[0]).toMatchObject({ filename: 'ゆうちょ一括.zip › 001.csv', archiveFilename: 'ゆうちょ一括.zip', adapterId: 'yucho-direct-ledger-v1', status: 'ready', sourceModifiedAt: '2023-11-14T22:13:20.000Z' })
    expect(result[0].issues).toContainEqual(expect.objectContaining({ code: 'ZIP_NON_CSV_IGNORED', severity: 'warning' }))
    expect(result.flatMap((item) => item.issues).filter((issue) => issue.code === 'ZIP_NON_CSV_IGNORED')).toHaveLength(1)
  })

  it('shows one disclosure when byte-identical CSV entries are collapsed', async () => {
    const csv = new TextEncoder().encode('unknown,data\n1,2')
    const result = await previewImportFiles([new File([zipSync({ 'b.csv': csv, 'a.csv': csv })], 'duplicate.zip', { type: 'application/zip' })])
    expect(result).toHaveLength(1)
    expect(result[0].archiveEntryName).toBe('a.csv')
    expect(result.flatMap((item) => item.issues).filter((issue) => issue.code === 'ZIP_DUPLICATE_CSV_IGNORED')).toHaveLength(1)
    expect(result[0].issues.find((issue) => issue.code === 'ZIP_DUPLICATE_CSV_IGNORED')?.message).toContain('b.csv → a.csv')
  })

  it('does not process safe children from a partially unsafe ZIP', async () => {
    const zip = zipSync({ '../unsafe.csv': new TextEncoder().encode('x'), 'safe.csv': new TextEncoder().encode('x') })
    const result = await previewImportFiles([new File([zip], 'unsafe.zip', { type: 'application/zip' })])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ filename: 'unsafe.zip', status: 'error' })
    expect(result[0].issues[0].code).toBe('ZIP_PATH_UNSAFE')
  })

  it('includes expanded ZIP entries in the twenty-file batch limit', async () => {
    const files = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`${String(index).padStart(2, '0')}.csv`, new TextEncoder().encode(String(index))]))
    const zip = new File([zipSync(files)], 'bulk.zip', { type: 'application/zip' })
    const result = await previewImportFiles([new File(['x'], 'before.csv'), zip])
    expect(result.some((item) => item.issues.some((issue) => issue.code === 'BATCH_TOO_LARGE'))).toBe(true)
    expect(result.filter((item) => item.archiveFilename)).toHaveLength(0)
  })

  it('detects the official Money Forward ME household-ledger export', async () => {
    const file = new File([
      '計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID\n' +
      '1,2026/07/27,給与,300000,MUFG,収入,給与,7月分,0,mf-1',
    ], 'money-forward.csv', { type: 'text/csv' })
    const result = await previewImportFile(file)
    expect(result).toMatchObject({ adapterId: 'money-forward-me-household-ledger-v1', recordCount: 1, status: 'ready' })
  })

  it('decodes a CP932 Money Forward household export before multi-institution mapping', async () => {
    const bytes = new Uint8Array([
      0x8c, 0x76, 0x8e, 0x5a, 0x91, 0xce, 0x8f, 0xdb, 0x2c, 0x93, 0xfa, 0x95, 0x74, 0x2c, 0x93, 0xe0, 0x97, 0x65, 0x2c, 0x8b, 0xe0, 0x8a, 0x7a, 0x81, 0x69, 0x89, 0x7e, 0x81, 0x6a, 0x2c, 0x95, 0xdb, 0x97, 0x4c, 0x8b, 0xe0, 0x97, 0x5a, 0x8b, 0x40, 0x8a, 0xd6, 0x2c, 0x91, 0xe5, 0x8d, 0x80, 0x96, 0xda, 0x2c, 0x92, 0x86, 0x8d, 0x80, 0x96, 0xda, 0x2c, 0x83, 0x81, 0x83, 0x82, 0x2c, 0x90, 0x55, 0x91, 0xd6, 0x2c, 0x49, 0x44, 0x0a,
      0x31, 0x2c, 0x32, 0x30, 0x32, 0x36, 0x2f, 0x30, 0x37, 0x2f, 0x31, 0x32, 0x2c, 0x8b, 0x8b, 0x97, 0x5e, 0x2c, 0x33, 0x30, 0x30, 0x30, 0x30, 0x30, 0x2c, 0x8e, 0x4f, 0x95, 0x48, 0x82, 0x74, 0x82, 0x65, 0x82, 0x69, 0x8b, 0xe2, 0x8d, 0x73, 0x2c, 0x8e, 0xfb, 0x93, 0xfc, 0x2c, 0x8b, 0x8b, 0x97, 0x5e, 0x2c, 0x8e, 0xb5, 0x8c, 0x8e, 0x95, 0xaa, 0x2c, 0x30, 0x2c, 0x6d, 0x66, 0x2d, 0x63, 0x70, 0x39, 0x33, 0x32, 0x0a,
    ])
    const result = await previewImportFile(new File([bytes], 'money-forward-cp932.csv', { type: 'text/csv' }))
    expect(result).toMatchObject({ adapterId: 'money-forward-me-household-ledger-v1', encoding: 'shift_jis', recordCount: 1, status: 'ready' })
    expect(result.parsed?.metadata).toMatchObject({ institutions: ['三菱UFJ銀行'] })
  })

  it('decodes and previews a CP932 Vpass statement at the file boundary', async () => {
    const bytes = new Uint8Array([
      0x89, 0xcb, 0x8b, 0xf3, 0x20, 0x91, 0xbe, 0x98, 0x59, 0x20, 0x97, 0x6c, 0x2c, 0x34, 0x39, 0x38, 0x30, 0x2d, 0x2a, 0x2a, 0x2a, 0x2a, 0x2d, 0x2a, 0x2a, 0x2a, 0x2a, 0x2d, 0x31, 0x32, 0x33, 0x34, 0x2c, 0x8e, 0x4f, 0x88, 0xe4, 0x8f, 0x5a, 0x97, 0x46, 0x83, 0x4a, 0x81, 0x5b, 0x83, 0x68, 0x28, 0x4e, 0x4c, 0x29, 0x0a,
      0x32, 0x30, 0x32, 0x36, 0x2f, 0x30, 0x36, 0x2f, 0x30, 0x31, 0x2c, 0x89, 0xcb, 0x8b, 0xf3, 0x83, 0x58, 0x83, 0x67, 0x83, 0x41, 0x2c, 0x31, 0x32, 0x30, 0x30, 0x2c, 0x88, 0xea, 0x8a, 0x87, 0x2c, 0x2c, 0x31, 0x32, 0x30, 0x30, 0x2c, 0x2c, 0x2c, 0x2c, 0x2c, 0x93, 0xfa, 0x97, 0x70, 0x95, 0x69, 0x0a,
      0x82, 0xa8, 0x8e, 0x78, 0x95, 0xa5, 0x82, 0xa2, 0x8d, 0x87, 0x8c, 0x76, 0x2c, 0x2c, 0x2c, 0x2c, 0x2c, 0x31, 0x32, 0x30, 0x30, 0x2c, 0x2c, 0x2c, 0x2c, 0x2c,
    ])
    const result = await previewImportFile(new File([bytes], 'vpass.csv', { type: 'text/csv' }))

    expect(result).toMatchObject({ adapterId: 'smbc-vpass-statement-v1', encoding: 'shift_jis', recordCount: 1, status: 'ready' })
  })

  it('decodes and previews an AEON finalized statement at the file boundary', async () => {
    const csv = [
      'イオンカードご利用明細,2026年7月ご請求分',
      'カード会員名,架空 太郎',
      'カード番号,4987-****-****-1234',
      'ご利用日,ご利用先,ご利用金額(円),支払区分,今回ご請求額(円),カード利用者,備考',
      '2026/06/12,架空ストア,1200,一括,1200,本人,',
      'お支払い合計,,,,1200,,',
    ].join('\n')
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(csv)])

    const result = await previewImportFile(new File([bytes], 'aeon-card.csv', { type: 'text/csv' }))

    expect(result).toMatchObject({ adapterId: 'aeon-card-finalized-statement-v1', encoding: 'utf-8-bom', recordCount: 1, status: 'ready' })
    expect(result.parsed?.records[0]).toMatchObject({ kind: 'card-statement', issuer: 'AEON_CARD', statementTotal: 1200 })
  })

  it('decodes and previews the bounded PayPay Card finalized statement at the file boundary', async () => {
    const fixture = readFileSync('src/ingestion/fixtures/paypay-card-statement.community-derived.synthetic.csv')
    const result = await previewImportFile(new File([fixture], 'unrelated-name.csv', { type: 'text/csv' }))

    expect(result).toMatchObject({ adapterId: 'paypay-card-finalized-statement-v1', recordCount: 1, status: 'ready' })
    expect(result.parsed?.records[0]).toMatchObject({
      kind: 'card-statement', issuer: 'PAYPAY_CARD', paymentDueOn: '2026-07-27', statementTotal: 5550,
    })
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
    expect(result.adapterId).toBe('pdf-local-extraction-v2')
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
