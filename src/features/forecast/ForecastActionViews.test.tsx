import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ForecastActionDto } from './forecastActionPlatform'
import { ForecastActionViews } from './ForecastActionViews'

const data: ForecastActionDto = {
  asOf: '2026-07-13', forecastFrom: '2026-08', forecastThrough: '2026-10', openingCashJpy: 500_000,
  assumptions: { historyFrom: '2026-02', historyThrough: '2026-07', historyMonths: 6, averageMonthlyIncomeJpy: 400_000, averageMonthlyExpenseJpy: 270_000, averageMonthlyNonRecurringExpenseJpy: 220_000, averageMonthlyCashChangeBeforeCardPaymentsJpy: 130_000, recurringMonthlyExpenseJpy: 50_000, recurringItemCount: 3, reasons: ['直近6か月の確定取引を使用'] },
  months: ['2026-08', '2026-09', '2026-10'].map((month, index) => ({ month, openingCashJpy: 500_000 + index * 100_000, projectedIncomeJpy: 400_000, projectedNonRecurringExpenseJpy: 220_000, projectedRecurringExpenseJpy: 50_000, projectedSavingsJpy: 130_000, projectedCashChangeBeforeCardPaymentsJpy: 130_000, knownCardPaymentsJpy: index === 0 ? 30_000 : 0, projectedCashChangeJpy: index === 0 ? 100_000 : 130_000, closingCashJpy: 600_000 + index * 130_000 })),
  actions: [
    { id: 'mismatch-1', kind: 'CARD_MISMATCH', priority: 'CRITICAL', title: '楽天カードの金額不一致', detail: '請求額と銀行引落額が一致しません。', dueOn: '2026-07-27', amountJpy: 204_987, entityId: 'statement-1', reasons: ['差額 ¥2,000'] },
    { id: 'shortfall-1', kind: 'CARD_BALANCE_SHORTFALL', priority: 'HIGH', title: '銀行残高が不足', detail: 'カード引落後に残高が不足します。', dueOn: '2026-07-27', amountJpy: 20_000, entityId: 'bank', reasons: ['明示設定した引落口座'] },
    { id: 'mapping-1', kind: 'CARD_MAPPING_REQUIRED', priority: 'HIGH', title: '引落口座を設定', detail: '支払余力を確認するには設定が必要です。', dueOn: null, amountJpy: null, entityId: 'card', reasons: ['銀行口座は推測しません'] },
  ],
}

describe('ForecastActionViews', () => {
  it('renders three-month forecast and its explainable assumptions', () => {
    render(<ForecastActionViews data={data} />)
    expect(screen.getByText('現金・貯蓄予測')).toBeInTheDocument()
    expect(screen.getByText('2026年8月')).toBeInTheDocument()
    expect(screen.getByText('2026年10月')).toBeInTheDocument()
    fireEvent.click(screen.getByText('予測の前提と説明'))
    expect(screen.getByText('直近6か月の確定取引を使用')).toBeVisible()
  })

  it('labels and routes an action with its full DTO', () => {
    const onAction = vi.fn()
    render(<ForecastActionViews data={data} onAction={onAction} />)
    expect(screen.getByText('カード不一致')).toBeInTheDocument()
    expect(screen.getByText('カード残高不足')).toBeInTheDocument()
    expect(screen.getByText('カード引落設定')).toBeInTheDocument()
    expect(screen.getByText('緊急')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '楽天カードの金額不一致を確認' }))
    expect(onAction).toHaveBeenCalledWith(data.actions[0])
  })
})
