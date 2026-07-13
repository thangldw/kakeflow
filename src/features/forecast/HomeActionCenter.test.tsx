import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ForecastActionDto } from './forecastActionPlatform'
import { HomeActionCenter } from './HomeActionCenter'

const actions: ForecastActionDto['actions'] = [
  { id: 'low', kind: 'SPENDING_ANOMALY', priority: 'LOW', title: '低優先', detail: 'detail', dueOn: null, amountJpy: null, entityId: null, reasons: [] },
  { id: 'high', kind: 'BUDGET_OVERRUN', priority: 'HIGH', title: '予算を確認', detail: 'detail', dueOn: null, amountJpy: 1000, entityId: 'food', reasons: ['予算超過'] },
  { id: 'medium-b', kind: 'IMPORT_REVIEW', priority: 'MEDIUM', title: '取込B', detail: 'detail', dueOn: '2026-07-20', amountJpy: null, entityId: null, reasons: [] },
  { id: 'medium-a', kind: 'CARD_PAYMENT_DUE', priority: 'MEDIUM', title: 'カードA', detail: 'detail', dueOn: '2026-07-19', amountJpy: 2000, entityId: 'card', reasons: [] },
]

const result = (nextActions = actions): ForecastActionDto => ({
  asOf: '2026-07-31', forecastFrom: '2026-08', forecastThrough: '2026-10', openingCashJpy: 0,
  assumptions: { historyFrom: '2026-02', historyThrough: '2026-07', historyMonths: 6, averageMonthlyIncomeJpy: 0, averageMonthlyExpenseJpy: 0, averageMonthlyNonRecurringExpenseJpy: 0, averageMonthlyCashChangeBeforeCardPaymentsJpy: 0, recurringMonthlyExpenseJpy: 0, recurringItemCount: 0, reasons: [] },
  months: ['2026-08', '2026-09', '2026-10'].map((month) => ({ month, openingCashJpy: 0, projectedIncomeJpy: 0, projectedNonRecurringExpenseJpy: 0, projectedRecurringExpenseJpy: 0, projectedSavingsJpy: 0, projectedCashChangeBeforeCardPaymentsJpy: 0, knownCardPaymentsJpy: 0, projectedCashChangeJpy: 0, closingCashJpy: 0 })),
  actions: nextActions,
})

const baseProps = { householdId: 'family', accountGroupId: null, attributionScope: { kind: 'ALL' } as const, asOf: '2026-07-31', revision: 1, desktop: true, onAction: vi.fn(), onViewAll: vi.fn() }

describe('HomeActionCenter', () => {
  it('shows only the three highest-priority actions and routes the selected row', async () => {
    const query = vi.fn().mockResolvedValue(result())
    const onAction = vi.fn()
    const onViewAll = vi.fn()
    render(<HomeActionCenter {...baseProps} query={query} onAction={onAction} onViewAll={onViewAll} />)

    expect(screen.getByRole('heading', { name: '対応項目を確認中' })).toBeInTheDocument()
    expect(await screen.findByText('予算を確認')).toBeInTheDocument()
    expect(screen.getByText('カードA')).toBeInTheDocument()
    expect(screen.getByText('取込B')).toBeInTheDocument()
    expect(screen.queryByText('低優先')).not.toBeInTheDocument()
    expect(query).toHaveBeenCalledWith({ householdId: 'family', accountGroupId: null, attributionScope: { kind: 'ALL' }, asOf: '2026-07-31' })
    fireEvent.click(screen.getByRole('button', { name: '予算を確認を確認' }))
    expect(onAction).toHaveBeenCalledWith(actions[1])
    fireEvent.click(screen.getByRole('button', { name: '4件すべて見る' }))
    expect(onViewAll).toHaveBeenCalledTimes(1)
  })

  it('keeps the last valid scope snapshot when a revision refresh fails', async () => {
    const query = vi.fn().mockResolvedValueOnce(result([actions[1]])).mockRejectedValueOnce(new Error('offline'))
    const { rerender } = render(<HomeActionCenter {...baseProps} query={query} />)
    expect(await screen.findByText('予算を確認')).toBeInTheDocument()
    rerender(<HomeActionCenter {...baseProps} revision={2} query={query} />)
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('最新状態を取得できないため、直前に確認した対応項目を表示しています。')).toBeInTheDocument()
    expect(screen.getByText('予算を確認')).toBeInTheDocument()
  })

  it('separates an action-query failure from the dashboard and retries explicitly', async () => {
    const query = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(result([]))
    render(<HomeActionCenter {...baseProps} query={query} />)
    expect(await screen.findByRole('heading', { name: '対応項目を読み込めません' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '再試行' }))
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('現在、対応が必要な項目はありません。')).toBeInTheDocument()
  })

  it('never presents browser preview actions as live data', () => {
    const query = vi.fn()
    render(<HomeActionCenter {...baseProps} desktop={false} query={query} />)
    expect(screen.getByText('ブラウザプレビューではデスクトップの対応項目を読み込みません。')).toBeInTheDocument()
    expect(query).not.toHaveBeenCalled()
  })
})
