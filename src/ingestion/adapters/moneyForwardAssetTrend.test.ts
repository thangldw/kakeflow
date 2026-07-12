import { describe, expect, it } from 'vitest'
import { detectImportAdapter, moneyForwardAssetTrendAdapter } from '../index'

const fullHeader = '日付,合計（円）,預金・現金・暗号資産（円）,株式(現物)（円）,投資信託（円）,債券（円）,FX（円）,保険（円）,不動産（円）,年金（円）,ポイント（円）,その他の資産（円）'

describe('Money Forward ME asset trend adapter', () => {
  it('strongly detects the official asset-trend header and parses one snapshot per valid row', () => {
    const text = [
      fullHeader,
      '2026/06/30,"8,500,000","2,000,000","3,000,000","1,000,000",0,"200,000","300,000","500,000","1,400,000","50,000","50,000"',
      '2026年07月31日,"8,700,000","2,100,000","3,100,000","1,000,000",0,"200,000","300,000","500,000","1,400,000","50,000","50,000"',
    ].join('\n')

    const detected = detectImportAdapter({ text, filename: '資産推移.csv' })
    expect(detected?.adapter.id).toBe('money-forward-me-asset-trend-v1')
    expect(detected?.score).toBeGreaterThanOrEqual(0.9)

    const result = moneyForwardAssetTrendAdapter.parse({ text })
    expect(result.issues).toHaveLength(0)
    expect(result.records).toHaveLength(2)
    expect(result.records[0]).toMatchObject({
      kind: 'aggregate-asset-snapshot',
      asOf: '2026-06-30',
      totalAssetsJpy: 8_500_000,
      lineage: { sourceRow: 2, sourceRowEnd: 2 },
    })
    expect(result.records[0].assetClasses).toEqual(expect.arrayContaining([
      { assetClass: 'DEPOSITS_CASH_CRYPTO', officialHeader: '預金・現金・暗号資産(円)', valueJpy: 2_000_000 },
      { assetClass: 'LISTED_STOCKS', officialHeader: '株式(現物)(円)', valueJpy: 3_000_000 },
    ]))
  })

  it('accepts optional and reordered official category columns without deriving the total', () => {
    const text = [
      'ポイント（円）,合計（円）,日付,預金・現金・暗号資産（円）',
      '１２３,９９９,2026.07.01,４５６',
    ].join('\n')
    const result = moneyForwardAssetTrendAdapter.parse({ text })

    expect(result.issues).toHaveLength(0)
    expect(result.records[0]).toEqual(expect.objectContaining({
      asOf: '2026-07-01',
      totalAssetsJpy: 999,
      assetClasses: [
        { assetClass: 'DEPOSITS_CASH_CRYPTO', officialHeader: '預金・現金・暗号資産(円)', valueJpy: 456 },
        { assetClass: 'POINTS', officialHeader: 'ポイント(円)', valueJpy: 123 },
      ],
    }))
    expect(result.metadata).toMatchObject({ categoryColumnCount: 2, unknownHeaders: [] })
  })

  it('rejects invalid dates, decimal JPY, missing totals, and invalid category values', () => {
    const text = [
      '日付,合計（円）,預金・現金・暗号資産（円）',
      '2026/02/30,100,100',
      '2026/02/28,100.5,100',
      '2026/03/31,,100',
      '2026/04/30,100,unknown',
      '2026-05-31,100,100',
    ].join('\n')
    const result = moneyForwardAssetTrendAdapter.parse({ text })

    expect(result.records).toHaveLength(1)
    expect(result.records[0].asOf).toBe('2026-05-31')
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MONEY_FORWARD_ASSET_DATE_INVALID', row: 2 }),
      expect.objectContaining({ code: 'MONEY_FORWARD_ASSET_TOTAL_INVALID', row: 3 }),
      expect.objectContaining({ code: 'MONEY_FORWARD_ASSET_TOTAL_INVALID', row: 4 }),
      expect.objectContaining({ code: 'MONEY_FORWARD_ASSET_CLASS_INVALID', row: 5 }),
    ]))
  })

  it('does not claim unrelated date/total CSVs or accept transaction exports', () => {
    const generic = '日付,合計（円）\n2026/07/01,100'
    const transaction = '計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID\n1,2026/07/01,給与,100,銀行,収入,給与,,,1'

    expect(detectImportAdapter({ text: generic })).toBeNull()
    expect(detectImportAdapter({ text: transaction })).toBeNull()
    const parsed = moneyForwardAssetTrendAdapter.parse({ text: transaction })
    expect(parsed.records).toHaveLength(0)
    expect(parsed.issues).toContainEqual(expect.objectContaining({ code: 'MONEY_FORWARD_ASSET_HEADERS_MISSING', severity: 'error' }))
  })
})
