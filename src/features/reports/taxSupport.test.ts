import { describe, expect, it } from 'vitest'
import { buildTaxSupportReport, medicalDeductionJpy, taxSupportCsv, type TaxTransaction } from './taxSupport'

let counter = 0
function tx(partial: Partial<TaxTransaction>): TaxTransaction {
  counter += 1
  return {
    id: `t${counter}`, occurredOn: '2026-05-10', transactionType: 'EXPENSE', payee: null, description: null,
    amountJpy: 1000, status: 'POSTED', calculationTarget: true, categoryName: null, ...partial,
  }
}

describe('medicalDeductionJpy', () => {
  it('uses 5% of income when income is under ¥2,000,000, else ¥100,000', () => {
    expect(medicalDeductionJpy(150_000, 1_500_000)).toBe(75_000)
    expect(medicalDeductionJpy(150_000, 6_000_000)).toBe(50_000)
  })
  it('never goes negative or above ¥2,000,000', () => {
    expect(medicalDeductionJpy(50_000, 6_000_000)).toBe(0)
    expect(medicalDeductionJpy(9_000_000, 6_000_000)).toBe(2_000_000)
  })
})

describe('buildTaxSupportReport', () => {
  const data = [
    tx({ payee: '田中クリニック', amountJpy: 3000 }),
    tx({ payee: 'ABC', categoryName: '健康・医療', amountJpy: 12_000, occurredOn: '2026-03-01' }),
    tx({ payee: 'さとふる', amountJpy: 30_000 }),
    tx({ payee: '日本赤十字社', description: '寄付', amountJpy: 5000 }),
    tx({ payee: 'スーパー', amountJpy: 800 }),
    tx({ payee: '田中クリニック', amountJpy: 2000, occurredOn: '2025-12-31' }),
    tx({ payee: '田中クリニック', amountJpy: 9999, status: 'PENDING' }),
    tx({ payee: '田中クリニック', amountJpy: 9999, calculationTarget: false }),
    tx({ payee: '田中クリニック', amountJpy: 1000, transactionType: 'REFUND' }),
    tx({ payee: '田中クリニック', amountJpy: 4000, transactionType: 'TRANSFER' }),
  ]

  it('sorts confirmed items of the year into medical, furusato and donations', () => {
    const report = buildTaxSupportReport(data, '2026', 5_000_000)
    expect(report.medical.map((item) => item.amountJpy)).toEqual([12_000, 3000, -1000])
    expect(report.medicalTotalJpy).toBe(14_000)
    expect(report.furusatoTotalJpy).toBe(30_000)
    expect(report.donationTotalJpy).toBe(5000)
    expect(report.medicalDeductionJpy).toBe(0)
  })

  it('leaves the deduction out when no income is given', () => {
    expect(buildTaxSupportReport(data, '2026').medicalDeductionJpy).toBeNull()
  })

  it('does not count a drugstore as medical on its own', () => {
    expect(buildTaxSupportReport([tx({ payee: 'マツモトキヨシ ドラッグ', amountJpy: 900 })], '2026').medical).toEqual([])
  })
})

describe('taxSupportCsv', () => {
  it('starts with a BOM, totals each kind and neutralizes formulas and quotes', () => {
    const report = buildTaxSupportReport([
      tx({ payee: '=HYPERLINK("x")', categoryName: '医療', amountJpy: 500 }),
      tx({ payee: 'a,b クリニック', description: 'line1\nline2', amountJpy: 700 }),
    ], '2026', 1_000_000)
    const csv = taxSupportCsv(report)
    expect(csv.startsWith('\uFEFF区分,日付')).toBe(true)
    expect(csv).toContain("'=HYPERLINK(\"\"x\"\")")
    expect(csv).toContain('"a,b クリニック"')
    expect(csv).toContain('line1 line2')
    expect(csv).toContain('医療費 合計,,,,1200,')
    expect(csv).toContain('医療費控除額（参考）,,,,0,')
  })
})
