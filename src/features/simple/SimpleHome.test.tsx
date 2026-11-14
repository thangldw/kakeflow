import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { goalPace } from '../../domain/goalPace'
import type { DashboardMonthlyTotalsDto, MonthlyCategoryBudgetDto, SavingsGoalDto } from '../../platform/types'
import type { HomeClient } from './homeLoader'
import { SimpleHome } from './SimpleHome'

const budget = (month: string, categoryAccountId: string, categoryName: string, budgetJpy: number): MonthlyCategoryBudgetDto => ({
  householdId: 'family', month, categoryAccountId, categoryName, budgetJpy, actualJpy: 0, remainingJpy: budgetJpy,
})

// The spec's example: budgets 60,000 / 45,000 / 15,000 / 20,000 / 15,000 (155,000) and 112,400 spent.
const specBudgets = [
  budget('2026-11', 'food', '食費', 60_000),
  budget('2026-11', 'daily', '日用品', 45_000),
  budget('2026-11', 'transport', '交通費', 15_000),
  budget('2026-11', 'fun', '娯楽', 20_000),
  budget('2026-11', 'other', 'その他', 15_000),
]

const dashboard = (overrides: Partial<DashboardMonthlyTotalsDto> = {}): DashboardMonthlyTotalsDto => ({
  month: '2026-11', accountingBasis: 'ACCRUAL', incomeJpy: 250_000, expenseJpy: 112_400, savingsJpy: 137_600, postedTransactionCount: 12,
  netWorthAsOf: '2026-11-14', assetsJpy: 0, liabilitiesJpy: 0, netWorthJpy: 0, accrualTrend: [], cashFlowTrend: [],
  expenseCategories: [
    { accountId: 'food', name: '食費', amountJpy: 50_000 },
    { accountId: 'daily', name: '日用品', amountJpy: 30_000 },
    { accountId: 'transport', name: '交通費', amountJpy: 10_000 },
    { accountId: 'fun', name: '娯楽', amountJpy: 12_400 },
    { accountId: 'other', name: 'その他', amountJpy: 10_000 },
  ],
  ...overrides,
})

const travelGoal: SavingsGoalDto = {
  id: 'travel', householdId: 'family', name: '家族旅行', targetJpy: 300_000, savedJpy: 120_000, targetDate: '2027-06-30', status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}

function fakeClient(options: {
  budgets?: Record<string, readonly MonthlyCategoryBudgetDto[]>
  dashboard?: DashboardMonthlyTotalsDto
  goals?: readonly SavingsGoalDto[]
  failDashboard?: boolean
} = {}) {
  let goals = options.goals ?? []
  return {
    queryDashboard: vi.fn(async () => {
      if (options.failDashboard) throw new Error('offline')
      return options.dashboard ?? dashboard()
    }),
    listBudgets: vi.fn(async (_householdId: string, month: string) => (options.budgets ?? { '2026-11': specBudgets })[month] ?? []),
    listSavingsGoals: vi.fn(async () => goals),
    updateSavingsGoal: vi.fn(async (input: Parameters<HomeClient['updateSavingsGoal']>[0]) => {
      const next = { ...input, createdAt: travelGoal.createdAt, updatedAt: '2026-11-14T00:00:00Z' }
      goals = goals.map((goal) => goal.id === next.id ? next : goal)
      return next
    }),
  } satisfies HomeClient
}

function renderHome(client: HomeClient, overrides: Partial<Parameters<typeof SimpleHome>[0]> = {}) {
  const props = {
    householdId: 'family', householdName: '山田家', month: '2026-11', revision: 0,
    onSetLimit: vi.fn(), onOpenBudgets: vi.fn(), onOpenSavings: vi.fn(), client, ...overrides,
  }
  return { ...render(<SimpleHome {...props} />), props }
}

describe('SimpleHome', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-14T03:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('shows a busy state while loading', () => {
    const client = fakeClient()
    client.queryDashboard.mockImplementation(() => new Promise(() => {}))
    const { container } = renderHome(client)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.getByRole('status', { name: 'ホームを準備中' })).toHaveAttribute('aria-busy', 'true')
  })

  it('shows the remaining amount, the daily allowance and an accessible spending bar', async () => {
    renderHome(fakeClient())
    const hero = (await screen.findByText('今月あと使える金額')).closest('section')!
    expect(within(hero).getByText('¥42,600')).toBeInTheDocument()
    expect(within(hero).getByText('1日あたりの目安')).toBeInTheDocument()
    expect(within(hero).getByText('¥2,505')).toBeInTheDocument()
    expect(within(hero).getByText('残り日数')).toBeInTheDocument()
    expect(within(hero).getByText('17')).toBeInTheDocument()
    const bar = within(hero).getByRole('img')
    expect(bar).toHaveAccessibleName('使った金額 ¥112,400 / 予算の合計 ¥155,000')
    expect(screen.getByText('山田家')).toBeInTheDocument()
    expect(screen.queryByText('予算のないカテゴリーの支出')).not.toBeInTheDocument()
    expect(screen.queryByText('以前の月の予算を使っています')).not.toBeInTheDocument()
    expect(screen.queryByText('予算を超えたカテゴリー')).not.toBeInTheDocument()
  })

  it('labels an earlier month neutrally, names the month and offers a way back to this month', async () => {
    const october = { '2026-10': specBudgets.map((row) => ({ ...row, month: '2026-10' })) }
    const { props } = renderHome(fakeClient({ budgets: october, dashboard: dashboard({ month: '2026-10' }) }), { month: '2026-10', onGoToCurrentMonth: vi.fn() })
    const hero = (await screen.findByText('残り金額')).closest('section')!
    expect(screen.queryByText('今月あと使える金額')).not.toBeInTheDocument()
    expect(within(hero).getByText('2026-10')).toBeInTheDocument()
    expect(within(hero).getByText('¥42,600')).toBeInTheDocument()
    expect(within(hero).queryByText('1日あたりの目安')).not.toBeInTheDocument()
    fireEvent.click(within(hero).getByRole('button', { name: '今月に戻る' }))
    expect(props.onGoToCurrentMonth).toHaveBeenCalledTimes(1)
  })

  it('keeps the this-month label and offers no way back for the current month', async () => {
    renderHome(fakeClient(), { onGoToCurrentMonth: vi.fn() })
    const hero = (await screen.findByText('今月あと使える金額')).closest('section')!
    expect(within(hero).queryByText('2026-11')).not.toBeInTheDocument()
    expect(within(hero).queryByRole('button', { name: '今月に戻る' })).not.toBeInTheDocument()
  })

  it('offers a way back from a month without budgets too', async () => {
    renderHome(fakeClient({ budgets: {} }), { month: '2026-12', onGoToCurrentMonth: vi.fn() })
    const hero = (await screen.findByText('収入 − 支出（予算は未設定）')).closest('section')!
    expect(within(hero).getByText('2026-12')).toBeInTheDocument()
    expect(within(hero).getByRole('button', { name: '今月に戻る' })).toBeInTheDocument()
  })

  it('shows overspending as an over-budget amount, never as a negative hero number', async () => {
    const { container } = renderHome(fakeClient({ dashboard: dashboard({ expenseJpy: 170_000 }) }))
    const hero = (await screen.findByText('予算を超えています')).closest('section')!
    expect(within(hero).getByText('¥15,000')).toBeInTheDocument()
    expect(screen.queryByText('今月あと使える金額')).not.toBeInTheDocument()
    expect(screen.queryByText('1日あたりの目安')).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/[-−]\s*¥/)
  })

  it('shows unbudgeted spending only when there is some', async () => {
    const budgets = { '2026-11': specBudgets.filter((row) => row.categoryAccountId !== 'other').map((row) => row.categoryAccountId === 'food' ? { ...row, budgetJpy: 75_000 } : row) }
    renderHome(fakeClient({ budgets }))
    const line = (await screen.findByText('予算のないカテゴリーの支出')).parentElement!
    expect(line).toHaveTextContent('¥10,000')
  })

  it('notes when an earlier month\'s budget is used', async () => {
    renderHome(fakeClient({ budgets: { '2026-09': specBudgets.map((row) => ({ ...row, month: '2026-09' })) } }))
    const note = await screen.findByText('以前の月の予算を使っています')
    expect(note.parentElement).toHaveTextContent('2026-09')
    expect(screen.getByText('¥42,600')).toBeInTheDocument()
  })

  it('without any budget shows income minus spending and invites setting a limit', async () => {
    const { props } = renderHome(fakeClient({ budgets: {} }))
    const hero = (await screen.findByText('収入 − 支出（予算は未設定）')).closest('section')!
    expect(within(hero).getByText('¥137,600')).toBeInTheDocument()
    expect(screen.queryByText('今月あと使える金額')).not.toBeInTheDocument()
    fireEvent.click(within(hero).getByRole('button', { name: '月の上限を決める' }))
    expect(props.onSetLimit).toHaveBeenCalledTimes(1)
  })

  it('shows the most overspent category with a link to the budgets', async () => {
    const data = dashboard({ expenseCategories: [{ accountId: 'fun', name: '娯楽', amountJpy: 24_500 }, { accountId: 'food', name: '食費', amountJpy: 61_000 }] })
    const { props } = renderHome(fakeClient({ dashboard: data }))
    const row = (await screen.findByText('予算を超えたカテゴリー')).closest('section')!
    expect(row).toHaveTextContent('娯楽')
    expect(row).toHaveTextContent('¥4,500')
    fireEvent.click(within(row).getByRole('button', { name: '見る' }))
    expect(props.onOpenBudgets).toHaveBeenCalledTimes(1)
  })

  it('shows the savings goal pace and updates the saved amount', async () => {
    const client = fakeClient({ goals: [travelGoal] })
    renderHome(client)
    const card = (await screen.findByText('家族旅行')).closest('section')!
    const pace = goalPace(travelGoal)
    expect(card).toHaveTextContent(`¥${pace.monthly.toLocaleString('ja-JP')}`)
    expect(card).toHaveTextContent('必要な月額')
    expect(within(card).getByRole('img')).toHaveAccessibleName('貯蓄の目標 家族旅行 ¥120,000 / ¥300,000')
    fireEvent.change(within(card).getByLabelText('貯蓄済みの金額'), { target: { value: '150000' } })
    fireEvent.click(within(card).getByRole('button', { name: '貯蓄済みを更新' }))
    await waitFor(() => expect(client.updateSavingsGoal).toHaveBeenCalledWith({
      id: 'travel', householdId: 'family', name: '家族旅行', targetJpy: 300_000, savedJpy: 150_000, targetDate: '2027-06-30', status: 'ACTIVE',
    }))
    await waitFor(() => expect(client.listSavingsGoals).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('¥150,000 / ¥300,000')).toBeInTheDocument()
  })

  it('blocks saving while the saved-amount text is invalid', async () => {
    const client = fakeClient({ goals: [travelGoal] })
    renderHome(client)
    const card = (await screen.findByText('家族旅行')).closest('section')!
    const field = within(card).getByLabelText('貯蓄済みの金額')
    const button = within(card).getByRole('button', { name: '貯蓄済みを更新' })
    fireEvent.change(field, { target: { value: '15000' } })
    expect(button).toBeEnabled()
    fireEvent.change(field, { target: { value: '15000x' } })
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(button).toBeDisabled()
    fireEvent.submit(button.closest('form')!)
    fireEvent.click(button)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(client.updateSavingsGoal).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: '16000' } })
    expect(button).toBeEnabled()
  })

  it('shows an alert and keeps the typed amount when the update fails', async () => {
    const client = fakeClient({ goals: [travelGoal] })
    client.updateSavingsGoal.mockRejectedValueOnce(new Error('offline'))
    renderHome(client)
    const card = (await screen.findByText('家族旅行')).closest('section')!
    const field = within(card).getByLabelText('貯蓄済みの金額')
    fireEvent.change(field, { target: { value: '150000' } })
    fireEvent.click(within(card).getByRole('button', { name: '貯蓄済みを更新' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent('更新できませんでした')
    expect(field).toHaveValue('150000')
    expect(within(card).getByRole('button', { name: '貯蓄済みを更新' })).toBeEnabled()
    expect(client.listSavingsGoals).toHaveBeenCalledTimes(1)
  })

  it('shows exactly zero left as ¥0 to spend in the neutral tone, not as over budget', async () => {
    renderHome(fakeClient({ dashboard: dashboard({ expenseJpy: 155_000 }) }))
    const hero = (await screen.findByText('今月あと使える金額')).closest('section')!
    expect(within(hero).getByText('¥0')).toBeInTheDocument()
    expect(hero).not.toHaveClass('simple-hero-over')
    expect(screen.queryByText('予算を超えています')).not.toBeInTheDocument()
    expect(screen.queryByText('1日あたりの目安')).not.toBeInTheDocument()
    expect(within(hero).getByRole('img')).toHaveAccessibleName('使った金額 ¥155,000 / 予算の合計 ¥155,000')
  })

  it('invites creating a goal when there is none', async () => {
    const { props } = renderHome(fakeClient())
    fireEvent.click(await screen.findByRole('button', { name: '目標を作る' }))
    expect(props.onOpenSavings).toHaveBeenCalledTimes(1)
  })

  it('shows an alert with a retry button when loading fails', async () => {
    const client = fakeClient({ failDashboard: true })
    renderHome(client)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('読み込めませんでした')
    client.queryDashboard.mockResolvedValue(dashboard())
    fireEvent.click(within(alert).getByRole('button', { name: '再読み込み' }))
    expect(await screen.findByText('¥42,600')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reloads when the revision changes and ignores a stale response', async () => {
    const client = fakeClient()
    const { rerender, props } = renderHome(client)
    await screen.findByText('¥42,600')
    let resolveOld: (value: DashboardMonthlyTotalsDto) => void = () => {}
    client.queryDashboard.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    rerender(<SimpleHome {...props} revision={1} />)
    client.queryDashboard.mockResolvedValueOnce(dashboard({ expenseJpy: 100_000 }))
    rerender(<SimpleHome {...props} revision={2} />)
    expect(await screen.findByText('¥55,000')).toBeInTheDocument()
    await act(async () => {
      resolveOld(dashboard({ expenseJpy: 1_000 }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(screen.queryByText('¥154,000')).not.toBeInTheDocument()
    expect(screen.getByText('¥55,000')).toBeInTheDocument()
  })
})
