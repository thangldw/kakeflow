import { describe, expect, it } from 'vitest'
import { moneyForwardHouseholdLedgerAdapter } from './moneyForwardHouseholdLedger'

const header = '計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID'

describe('Money Forward ME household-ledger adapter', () => {
  it('preserves all documented fields and forces transfers out of analytics', () => {
    const parsed = moneyForwardHouseholdLedgerAdapter.parse({ text: `${header}\n1,2026/07/12,"ATM, transfer",-10000,MUFG,振替,口座振替,カード支払,1,mf-1` })
    expect(parsed.issues).toEqual([])
    expect(parsed.records[0]).toMatchObject({
      calculationTarget: false, transactionDate: '2026-07-12', content: 'ATM, transfer', signedAmountJpy: -10000,
      institution: 'MUFG', majorCategory: '振替', minorCategory: '口座振替', memo: 'カード支払', isTransfer: true,
      externalTransactionId: 'mf-1',
    })
    expect(parsed.records[0].sourceFields).toMatchObject({ '金額(円)': '-10000', ID: 'mf-1' })
  })

  it('accepts reordered official headers and calculation-target-off income', () => {
    const text = 'ID,振替,メモ,中項目,大項目,保有金融機関,金額（円）,内容,日付,計算対象\nabc,0,refund,その他,収入,Rakuten,500,返金,2026-07-13,0'
    const parsed = moneyForwardHouseholdLedgerAdapter.parse({ text })
    expect(parsed.records[0]).toMatchObject({ signedAmountJpy: 500, calculationTarget: false, isTransfer: false, externalTransactionId: 'abc' })
  })

  it('rejects malformed flags, zero amounts, dates, and multi-institution files', () => {
    const text = [header,
      'maybe,2026/02/30,A,0,MUFG,食費,食料品,,no,a',
      '1,2026/07/13,B,-100,SMBC,食費,食料品,,0,b',
      '1,2026/07/13,C,-100,MUFG,食費,食料品,,0,c',
    ].join('\n')
    const parsed = moneyForwardHouseholdLedgerAdapter.parse({ text })
    expect(parsed.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'MONEY_FORWARD_CALCULATION_TARGET_INVALID', 'MONEY_FORWARD_TRANSFER_INVALID', 'MONEY_FORWARD_DATE_INVALID',
      'MONEY_FORWARD_AMOUNT_INVALID', 'MONEY_FORWARD_MULTIPLE_INSTITUTIONS',
    ]))
  })
})
