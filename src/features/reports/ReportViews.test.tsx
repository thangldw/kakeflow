import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { FinancialCalendarView, MonthlyReportView } from './ReportViews'
import type { FinancialCalendarDto, MonthlyReportDto } from './ReportViews'

const quality = {
  totalImports: 4,
  postedImports: 2,
  reviewRequiredImports: 1,
  failedImports: 1,
  inProgressImports: 0,
  importCompletionBps: 5000,
  latestImportedAt: '2026-07-12T14:55:16+09:00',
  staleDays: 1,
  hasUnresolvedImports: true,
} as const

const budget = {
  budgetJpy: 200_000,
  actualJpy: 120_000,
  remainingJpy: 80_000,
  utilizationBps: 6000,
  categoryCount: 8,
  overBudgetCount: 1,
} as const

const goals = {
  activeCount: 2,
  targetJpy: 1_000_000,
  savedJpy: 400_000,
  remainingJpy: 600_000,
  dueWithinPeriodCount: 1,
} as const

const calendar: FinancialCalendarDto = {
  month: '2026-07',
  asOf: '2026-07-31',
  budget,
  goals,
  dataQuality: quality,
  days: [
    {
      date: '2026-07-01',
      accrualIncomeJpy: 300_000,
      accrualExpenseJpy: 0,
      cashInflowJpy: 300_000,
      cashOutflowJpy: 0,
      postedTransactionCount: 1,
      noSpendDay: true,
      events: [{ kind: 'CASH_INFLOW', id: 'salary', title: '給与', amountJpy: 300_000, status: 'POSTED' }],
    },
    {
      date: '2026-07-27',
      accrualIncomeJpy: 0,
      accrualExpenseJpy: 10_000,
      cashInflowJpy: 0,
      cashOutflowJpy: 80_000,
      postedTransactionCount: 2,
      noSpendDay: false,
      events: [{ kind: 'CARD_PAYMENT_DUE', id: 'rakuten', title: '楽天カード', amountJpy: 80_000, status: 'PAYMENT_PENDING' }],
    },
  ],
}

const metrics = { incomeJpy: 300_000, expenseJpy: 120_000, savingsJpy: 180_000, savingsRateBps: 6000, postedTransactionCount: 30 } as const
const report: MonthlyReportDto = {
  period: '2026-07',
  asOf: '2026-07-31',
  current: metrics,
  priorMonth: { incomeJpy: 280_000, expenseJpy: 100_000, savingsJpy: 180_000, savingsRateBps: 6429, postedTransactionCount: 27 },
  priorYear: { incomeJpy: 290_000, expenseJpy: 130_000, savingsJpy: 160_000, savingsRateBps: 5517, postedTransactionCount: 29 },
  vsPriorMonth: {
    income: { amountJpy: 20_000, rateBps: 714 },
    expense: { amountJpy: 20_000, rateBps: 2000 },
    savings: { amountJpy: 0, rateBps: 0 },
  },
  vsPriorYear: {
    income: { amountJpy: 10_000, rateBps: 345 },
    expense: { amountJpy: -10_000, rateBps: -769 },
    savings: { amountJpy: 20_000, rateBps: 1250 },
  },
  topCategoryDrivers: [{ id: 'food', name: '食費', currentJpy: 60_000, previousJpy: 45_000, deltaJpy: 15_000 }],
  topMerchantDrivers: [{ merchant: 'コストコ', currentJpy: 30_000, previousJpy: 10_000, deltaJpy: 20_000 }],
  budget,
  goals,
  dataQuality: quality,
  reconciliation: { totalStatements: 3, fullyReconciled: 1, possibleMatches: 1, partiallyReconciled: 0, unmatched: 1, mismatchCount: 1, paymentTotalJpy: 204_987 },
}

describe('FinancialCalendarView', () => {
  it('renders a stable 42-cell calendar with events and data-quality context', () => {
    const { container } = render(<FinancialCalendarView data={calendar} />)

    expect(container.querySelectorAll('tbody .calendar-day')).toHaveLength(42)
    expect(screen.getByRole('table', { name: '2026年7月の日別収支カレンダー' })).toBeInTheDocument()
    expect(screen.getByText('No spend')).toBeInTheDocument()
    expect(screen.getByText('楽天カード')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1件が確認待ち')
    expect(screen.getAllByText('¥300,000')).toHaveLength(2)
  })

  it('switches basis and exposes date, event, and import callbacks', () => {
    const setBasis = vi.fn()
    const selectDate = vi.fn()
    const selectEvent = vi.fn()
    const openImports = vi.fn()
    render(<FinancialCalendarView data={calendar} basis="CASH" onBasisChange={setBasis} onSelectDate={selectDate} onSelectEvent={selectEvent} onOpenImports={openImports} />)

    fireEvent.click(screen.getByRole('button', { name: '発生ベース' }))
    fireEvent.click(screen.getByRole('button', { name: '2026-07-27の取引を表示' }))
    fireEvent.click(screen.getByRole('button', { name: /インポートを確認/ }))
    fireEvent.click(screen.getByRole('button', { name: /楽天カード/ }))

    expect(setBasis).toHaveBeenCalledWith('ACCRUAL')
    expect(selectDate).toHaveBeenCalledWith('2026-07-27')
    expect(openImports).toHaveBeenCalledOnce()
    expect(selectEvent).toHaveBeenCalledWith('2026-07-27', calendar.days[1].events[0])
    expect(screen.getByText('差引 +¥220,000')).toBeInTheDocument()
  })
})

describe('MonthlyReportView', () => {
  it('renders KPI deltas, drivers, health summaries, and an accessible comparison table', () => {
    render(<MonthlyReportView data={report} />)

    expect(screen.getByRole('heading', { name: '2026年7月' })).toBeInTheDocument()
    expect(screen.getAllByText('+¥20,000').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('heading', { name: '支出を動かしたカテゴリー' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '支出を動かした支払先' })).toBeInTheDocument()
    expect(screen.getByText('食費')).toBeInTheDocument()
    expect(screen.getByText('コストコ')).toBeInTheDocument()
    expect(screen.getByText('1/3件')).toBeInTheDocument()
    const comparison = screen.getByRole('heading', { name: '収支比較' }).closest('section')!
    expect(within(comparison).getByRole('columnheader', { name: '前年同月' })).toBeInTheDocument()
    expect(within(comparison).getByRole('rowheader', { name: '取引件数' })).toBeInTheDocument()
  })

  it('supports comparison, drill-down, and action callbacks', () => {
    const setComparison = vi.fn()
    const selectDriver = vi.fn()
    const openBudget = vi.fn()
    const openGoals = vi.fn()
    const openImports = vi.fn()
    const openReconciliation = vi.fn()
    const saveCsv = vi.fn()
    const saveXlsx = vi.fn()
    const savePdf = vi.fn()
    render(<MonthlyReportView data={report} comparison="PRIOR_YEAR" onComparisonChange={setComparison} onSelectDriver={selectDriver} onOpenBudget={openBudget} onOpenGoals={openGoals} onOpenImports={openImports} onOpenReconciliation={openReconciliation} onSaveCsv={saveCsv} onSaveXlsx={saveXlsx} onSavePdf={savePdf} />)

    fireEvent.click(screen.getByRole('button', { name: '前月比' }))
    fireEvent.click(screen.getByRole('button', { name: '食費' }))
    fireEvent.click(screen.getByRole('button', { name: 'コストコ' }))
    fireEvent.click(screen.getByRole('button', { name: '予算を見る' }))
    fireEvent.click(screen.getByRole('button', { name: '目標を見る' }))
    fireEvent.click(screen.getByRole('button', { name: '取込状況を見る' }))
    fireEvent.click(screen.getByRole('button', { name: '照合を見る' }))
    fireEvent.click(screen.getByRole('button', { name: '月次CSVを保存' }))
    fireEvent.click(screen.getByRole('button', { name: '月次Excelを保存' }))
    fireEvent.click(screen.getByRole('button', { name: '月次PDFを保存' }))

    expect(setComparison).toHaveBeenCalledWith('PRIOR_MONTH')
    expect(selectDriver).toHaveBeenNthCalledWith(1, 'CATEGORY', report.topCategoryDrivers[0])
    expect(selectDriver).toHaveBeenNthCalledWith(2, 'MERCHANT', report.topMerchantDrivers[0])
    expect(openBudget).toHaveBeenCalledOnce()
    expect(openGoals).toHaveBeenCalledOnce()
    expect(openImports).toHaveBeenCalledOnce()
    expect(openReconciliation).toHaveBeenCalledOnce()
    expect(saveCsv).toHaveBeenCalledOnce()
    expect(saveXlsx).toHaveBeenCalledOnce()
    expect(savePdf).toHaveBeenCalledOnce()
    expect(screen.getByText('−¥10,000')).toBeInTheDocument()
  })

  it('mutually disables monthly exports without changing the selected comparison', () => {
    const { rerender } = render(<MonthlyReportView data={report} comparison="PRIOR_YEAR" savingCsv onComparisonChange={vi.fn()} onSaveCsv={vi.fn()} onSaveXlsx={vi.fn()} onSavePdf={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'CSVを作成中…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '月次Excelを保存' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '月次PDFを保存' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '前年同月比' })).toHaveAttribute('aria-pressed', 'true')

    rerender(<MonthlyReportView data={report} comparison="PRIOR_YEAR" savingXlsx onComparisonChange={vi.fn()} onSaveCsv={vi.fn()} onSaveXlsx={vi.fn()} onSavePdf={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Excelを作成中…' })).toBeDisabled()
  })
})
