import { describe, expect, it } from 'vitest'
import { detectImportAdapter, securitiesAssetSnapshotAdapter } from '../index'

const sample = [
  '■資産合計欄',
  '資産合計,"1,750,000","125,000"',
  '現金・預り金,"250,000",0',
  '国内株式,"1,100,000","100,000"',
  '米国株式,"400,000","25,000"',
  '■保有商品詳細',
  '商品区分,預り区分,銘柄コード,銘柄名,保有数量,平均取得単価,現在値,評価額,評価損益,実現損益,通貨',
  '国内株式,特定,7203,トヨタ自動車,100,"2,500","3,000","300,000","50,000","10,000",JPY',
  '米国株式,特定,AAPL,Apple Inc.,10,180,200,"300,000","30,000",0,USD',
  '投資信託,NISA,,eMAXIS Slim 全世界株式,100000,1.0,9.0,"900,000","45,000",0,JPY',
  '合計,,,,,,,,"1,500,000","125,000",,',
  '■参考為替レート',
  '通貨,為替レート',
  'USD,150.25',
  'ユーロ,162.10',
].join('\n')

describe('securities asset snapshot adapter', () => {
  it('detects assetbalance exports ahead of transaction adapters', () => {
    const detected = detectImportAdapter({ text: sample, filename: 'assetbalance(all)_20260712_144756.csv' })
    expect(detected?.adapter.id).toBe('securities-asset-snapshot-v1')
    expect(detected?.score).toBeGreaterThanOrEqual(0.9)
  })

  it('parses summary, positions, FX rates, and timestamp without creating transactions', () => {
    const result = securitiesAssetSnapshotAdapter.parse({
      text: sample,
      filename: 'assetbalance(all)_20260712_144756.csv',
      accountHint: 'SBI Securities',
    })

    expect(result.issues).toHaveLength(0)
    expect(result.metadata).toMatchObject({ snapshotKind: 'PORTFOLIO', positionCount: 3, fxRateCount: 2 })
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      kind: 'portfolio-snapshot',
      accountHint: 'SBI Securities',
      asOf: '2026-07-12T14:47:56+09:00',
      marketValueJpy: 1750000,
      cashValueJpy: 250000,
      unrealizedPnlJpy: 125000,
      realizedPnlJpy: 10000,
    })
    expect(result.records[0].positions[0]).toMatchObject({
      kind: 'position-snapshot', instrumentCode: '7203', instrumentName: 'トヨタ自動車',
      quantity: 100, averageCost: 2500, marketPrice: 3000, marketValueJpy: 300000,
      unrealizedPnlJpy: 50000, realizedPnlJpy: 10000, currency: 'JPY',
    })
    expect(result.records[0].fxRates).toEqual([
      expect.objectContaining({ baseCurrency: 'USD', quoteCurrency: 'JPY', rate: 150.25 }),
      expect.objectContaining({ baseCurrency: 'EUR', quoteCurrency: 'JPY', rate: 162.1 }),
    ])
  })

  it('handles full-width values, alternate headers and invalid rows with lineage warnings', () => {
    const alternate = [
      '■資産合計欄',
      '合計,￥１２３，４５６',
      '■保有商品詳細',
      '商品種別,口座区分,ティッカー,商品名,数量,取得単価,現在価格,時価評価額,含み損益,通貨コード',
      '外国株式,NISA,MSFT,Microsoft Corp.,５,３００,３２０,￥１２３，４５６,△１，０００,USD',
      '外国株式,NISA,BAD,Broken position,1,1,1,not-a-number,0,USD',
      '■参考為替レート',
      '通貨名,参考レート',
      '米ドル,１４９．８',
      'GBP,0',
    ].join('\n')
    const result = securitiesAssetSnapshotAdapter.parse({ text: alternate })
    const snapshot = result.records[0]

    expect(snapshot.positions[0]).toMatchObject({ quantity: 5, marketValueJpy: 123456, unrealizedPnlJpy: -1000 })
    expect(snapshot.positions[1].marketValueJpy).toBeNull()
    expect(snapshot.fxRates[0]).toMatchObject({ baseCurrency: 'USD', rate: 149.8 })
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ASSET_POSITION_VALUE_MISSING', row: 6 }),
      expect.objectContaining({ code: 'ASSET_FX_RATE_INVALID', row: 10 }),
    ]))
  })

  it('parses the current assetbalance all header and headerless reference FX rows', () => {
    const current = [
      '■資産合計欄',
      '資産合計,"1,500,000",0',
      '預り金合計,"100,000",0',
      '■ 保有商品詳細 (すべて）',
      '種別,銘柄コード・ティッカー,銘柄,口座,保有数量,［単位］,平均取得価額,［単位］,現在値,［単位］,現在値(更新日),(参考為替),前日比,［単位］,時価評価額[円],時価評価額[外貨],評価損益[円],評価損益[％]',
      '国内株式,7203,トヨタ自動車,特定,100,株,2500,円,3000,円,,,10,円,"300,000",-,"50,000",20',
      '米国株式,AAPL,Apple Inc.,NISA,10,株,180,USD,200,USD,,,1,USD,"300,000","2,000 USD","30,000",10',
      '■参考為替レート',
      '米ドル,150.25,円/USD,(07/17 02:50)',
      'イギリスポンド,200.5,円/GBP,(07/17 02:50)',
    ].join('\n')
    const result = securitiesAssetSnapshotAdapter.parse({ text: current, filename: 'assetbalance(all)_20260717_025335.csv' })

    expect(result.issues).not.toContainEqual(expect.objectContaining({ code: 'ASSET_POSITION_HEADER_MISSING' }))
    expect(result.metadata).toMatchObject({ positionCount: 2, fxRateCount: 2 })
    expect(result.records[0].positions).toEqual([
      expect.objectContaining({ productType: '国内株式', accountType: '特定', instrumentCode: '7203', instrumentName: 'トヨタ自動車', averageCost: 2500, marketValueJpy: 300000, currency: 'JPY' }),
      expect.objectContaining({ productType: '米国株式', accountType: 'NISA', instrumentCode: 'AAPL', instrumentName: 'Apple Inc.', averageCost: 180, marketValueJpy: 300000, currency: 'USD' }),
    ])
    expect(result.records[0].fxRates).toEqual([
      expect.objectContaining({ baseCurrency: 'USD', rate: 150.25 }),
      expect.objectContaining({ baseCurrency: 'GBP', rate: 200.5 }),
    ])
  })

  it('rejects unrelated CSV data as a snapshot', () => {
    const result = securitiesAssetSnapshotAdapter.parse({ text: '日付,摘要,金額\n2026/07/01,給与,100000' })
    expect(result.records).toHaveLength(0)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'ASSET_SECTIONS_MISSING', severity: 'error' }))
  })
})
