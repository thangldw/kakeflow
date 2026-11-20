import { describe, expect, it } from 'vitest'
import { suggestBillDeadline } from './billDeadline'

describe('suggestBillDeadline', () => {
  it('reads a western date after a deadline label and the billed amount', () => {
    expect(suggestBillDeadline('ご請求金額 ¥12,345\nお支払期限 2026年12月25日\nご利用ありがとうございます')).toEqual({ dueOn: '2026-12-25', amountJpy: 12_345, marker: 'お支払期限' })
  })

  it('reads Reiwa and other era years, including 元年 and the letter forms', () => {
    expect(suggestBillDeadline('納付期限 令和8年6月30日')?.dueOn).toBe('2026-06-30')
    expect(suggestBillDeadline('支払期日 令和元年10月1日')?.dueOn).toBe('2019-10-01')
    expect(suggestBillDeadline('納期限 R8.7.31')?.dueOn).toBe('2026-07-31')
    expect(suggestBillDeadline('納期限 H30/3/5')?.dueOn).toBe('2018-03-05')
  })

  it('reads slash dates and full-width digits', () => {
    expect(suggestBillDeadline('お支払期限：２０２６／１２／０５')?.dueOn).toBe('2026-12-05')
    expect(suggestBillDeadline('Payment due: 2026-11-30')?.dueOn).toBe('2026-11-30')
  })

  it('ignores dates that are not introduced by deadline wording', () => {
    expect(suggestBillDeadline('発行日 2026年11月1日 検針期間 2026年10月1日〜10月31日')).toBeNull()
  })

  it('ignores a date that is far from the label', () => {
    expect(suggestBillDeadline(`お支払期限は下記の通りです。${'あ'.repeat(40)}2026年12月25日`)).toBeNull()
  })

  it('rejects impossible calendar dates', () => {
    expect(suggestBillDeadline('お支払期限 2026年2月30日')).toBeNull()
  })

  it('uses the earliest deadline when several are present and leaves the amount null when absent', () => {
    expect(suggestBillDeadline('引落日 2026年12月27日 お支払期限 2026年12月10日')).toEqual({ dueOn: '2026-12-27', amountJpy: null, marker: '引落日' })
  })

  it('returns null for empty text', () => {
    expect(suggestBillDeadline('')).toBeNull()
  })
})
