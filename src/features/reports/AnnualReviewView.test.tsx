import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { YearlyFinancialReportDto } from '../calendar/financialCalendarPlatform'
import { AnnualReviewView } from './AnnualReviewView'

const monthly = Array.from({ length: 12 }, (_, index) => ({
  month: `2026-${String(index + 1).padStart(2, '0')}`,
  status: index < 6 ? 'COMPLETE' as const : index === 6 ? 'PARTIAL' as const : 'FUTURE' as const,
  incomeJpy: index < 6 ? 100_000 : 0, expenseJpy: index < 6 ? 50_000 : 0,
  savingsJpy: index < 6 ? 50_000 : 0, savingsRateBps: index < 6 ? 5_000 : null,
  postedTransactionCount: index < 6 ? 2 : 0,
}))
const current = { incomeJpy: 600_000, expenseJpy: 300_000, savingsJpy: 300_000, savingsRateBps: 5_000, postedTransactionCount: 12 }
const prior = { incomeJpy: 540_000, expenseJpy: 300_000, savingsJpy: 240_000, savingsRateBps: 4_444, postedTransactionCount: 12 }
const delta = { income: { amountJpy: 60_000, rateBps: 1_111 }, expense: { amountJpy: 0, rateBps: 0 }, savings: { amountJpy: 60_000, rateBps: 2_500 } }
const data: YearlyFinancialReportDto = {
  period: '2026', asOf: '2026-07-13', throughMonth: '2026-06', completedMonthCount: 6, isCompleteYear: false,
  currentComparable: current, priorYearComparable: prior, vsPriorYearComparable: delta,
  current, priorYear: prior, vsPriorYear: delta, months: monthly,
  topCategoryDrivers: [{ id: 'food', name: '食費', currentJpy: 90_000, previousJpy: 70_000, deltaJpy: 20_000 }],
  topMerchantDrivers: [{ merchant: '生協', currentJpy: 60_000, previousJpy: 50_000, deltaJpy: 10_000 }],
  budget: { budgetJpy: 360_000, actualJpy: 300_000, remainingJpy: 60_000, utilizationBps: 8_333, categoryCount: 4, overBudgetCount: 1 },
  goals: { activeCount: 1, targetJpy: 1_000_000, savedJpy: 300_000, remainingJpy: 700_000, dueWithinPeriodCount: 0 },
  dataQuality: { totalImports: 10, postedImports: 8, reviewRequiredImports: 1, failedImports: 1, inProgressImports: 0, importCompletionBps: 8_000, latestImportedAt: '2026-07-12', staleDays: 1, hasUnresolvedImports: true },
  reconciliation: { totalStatements: 6, fullyReconciled: 5, possibleMatches: 1, partiallyReconciled: 0, unmatched: 0, mismatchCount: 0, paymentTotalJpy: 120_000 },
}

describe('AnnualReviewView', () => {
  it('shows equal-window KPIs and clearly excludes partial and future months', () => {
    render(<AnnualReviewView data={data} />)
    expect(screen.getByRole('heading', { name: '2026年' })).toBeInTheDocument()
    expect(screen.getByText(/2026-06までの計算対象取引を前年同期間と比較/)).toBeInTheDocument()
    expect(screen.getAllByText('未完了')).toHaveLength(1)
    expect(screen.getAllByText('将来')).toHaveLength(5)
    expect(screen.getByText('¥600,000')).toBeInTheDocument()
    expect(screen.getByText(/集計対象外・現在の未完了月・将来月は年間KPIから除外/)).toBeInTheDocument()
  })

  it('supports driver drill-down, actions and separate CSV/Excel/PDF saving', () => {
    const select = vi.fn(); const budget = vi.fn(); const imports = vi.fn(); const cards = vi.fn(); const saveCsv = vi.fn(); const saveXlsx = vi.fn(); const savePdf = vi.fn()
    render(<AnnualReviewView data={data} onSelectDriver={select} onOpenBudget={budget} onOpenImports={imports} onOpenReconciliation={cards} onSaveCsv={saveCsv} onSaveXlsx={saveXlsx} onSavePdf={savePdf} />)
    fireEvent.click(screen.getByRole('button', { name: '食費' }))
    fireEvent.click(screen.getByRole('button', { name: '生協' }))
    fireEvent.click(screen.getByRole('button', { name: '予算を見る' }))
    fireEvent.click(screen.getAllByRole('button', { name: /インポートを確認|取込状況を見る/ })[0])
    fireEvent.click(screen.getByRole('button', { name: '照合を見る' }))
    fireEvent.click(screen.getByRole('button', { name: '年次CSVを保存' }))
    fireEvent.click(screen.getByRole('button', { name: '年次Excelを保存' }))
    fireEvent.click(screen.getByRole('button', { name: '年次PDFを保存' }))
    expect(select).toHaveBeenNthCalledWith(1, 'CATEGORY', 'food')
    expect(select).toHaveBeenNthCalledWith(2, 'MERCHANT', '生協')
    expect(budget).toHaveBeenCalledOnce(); expect(imports).toHaveBeenCalledOnce(); expect(cards).toHaveBeenCalledOnce(); expect(saveCsv).toHaveBeenCalledOnce(); expect(saveXlsx).toHaveBeenCalledOnce(); expect(savePdf).toHaveBeenCalledOnce()
  })

  it('shows format-specific progress and prevents overlapping exports', () => {
    const { rerender } = render(<AnnualReviewView data={data} savingXlsx onSaveCsv={vi.fn()} onSaveXlsx={vi.fn()} onSavePdf={vi.fn()} />)
    expect(screen.getByRole('button', { name: '年次CSVを保存' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Excelを作成中…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '年次PDFを保存' })).toBeDisabled()

    rerender(<AnnualReviewView data={data} savingCsv onSaveCsv={vi.fn()} onSaveXlsx={vi.fn()} onSavePdf={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'CSVを作成中…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '年次Excelを保存' })).toBeDisabled()

    rerender(<AnnualReviewView data={data} savingPdf onSaveCsv={vi.fn()} onSaveXlsx={vi.fn()} onSavePdf={vi.fn()} />)
    expect(screen.getByRole('button', { name: '年次CSVを保存' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '年次Excelを保存' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'PDFを作成中…' })).toBeDisabled()
  })
})
