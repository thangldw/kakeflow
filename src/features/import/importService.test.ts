import { describe, expect, it } from 'vitest'
import { previewImportFile } from './importService'

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
})
