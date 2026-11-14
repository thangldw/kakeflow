import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { I18nProvider } from '../../i18n'
import type { AccountDto, DashboardMonthlyTotalsDto, MonthlyCategoryBudgetDto, SavingsGoalDto } from '../../platform/types'
import type { HomeClient } from './homeLoader'
import { QuickAddSheet } from './QuickAddSheet'
import { SimpleHome } from './SimpleHome'
import { SimpleMorePage } from './SimpleMorePage'
import { SimpleTabBar } from './SimpleTabBar'

// Simple screens use their own catalog entries where the shared ones read wrong in English or Vietnamese
// (lower case "save", "budget", "Other" for More, "3month"). These tests render each Simple surface in both locales.

function account(id: string, name: string, accountKind: AccountDto['accountKind'], accountSubtype: AccountDto['accountSubtype'] = 'OTHER'): AccountDto {
  return { id, name, accountKind, accountSubtype, currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' }
}

// User data stays Japanese so it can never look like an untranslated English word.
const accounts: AccountDto[] = [
  account('cash', '現金', 'ASSET', 'CASH'),
  account('food', '食費', 'EXPENSE'),
  account('daily', '日用品', 'EXPENSE'),
  account('salary', '給与', 'INCOME'),
]

const budget = (categoryAccountId: string, categoryName: string, budgetJpy: number): MonthlyCategoryBudgetDto => ({
  householdId: 'family', month: '2026-11', categoryAccountId, categoryName, budgetJpy, actualJpy: 0, remainingJpy: budgetJpy,
})

const dashboard: DashboardMonthlyTotalsDto = {
  month: '2026-11', accountingBasis: 'ACCRUAL', incomeJpy: 250_000, expenseJpy: 112_400, savingsJpy: 137_600, postedTransactionCount: 12,
  netWorthAsOf: '2026-11-14', assetsJpy: 0, liabilitiesJpy: 0, netWorthJpy: 0, accrualTrend: [], cashFlowTrend: [],
  expenseCategories: [{ accountId: 'food', name: '食費', amountJpy: 80_000 }, { accountId: 'daily', name: '日用品', amountJpy: 32_400 }],
}

const goal: SavingsGoalDto = {
  id: 'travel', householdId: 'family', name: '家族旅行', targetJpy: 300_000, savedJpy: 120_000, targetDate: '2027-06-30', status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
}

function homeClient(): HomeClient {
  return {
    queryDashboard: vi.fn(async () => dashboard),
    listBudgets: vi.fn(async (_householdId: string, month: string) => month === '2026-11' || month === '2026-10' ? [budget('food', '食費', 100_000), budget('daily', '日用品', 55_000)] : []),
    listSavingsGoals: vi.fn(async () => [goal]),
    updateSavingsGoal: vi.fn(async () => goal),
  }
}

function inLocale(locale: 'en' | 'vi', node: ReactNode) {
  localStorage.setItem('kakeflow.locale', locale)
  return render(<I18nProvider>{node}</I18nProvider>)
}

const homeProps = { householdId: 'family', householdName: '山田家', revision: 0, onSetLimit: () => undefined, onOpenBudgets: () => undefined, onOpenSavings: () => undefined }
const sheetProps = { open: true, householdId: 'h1', accounts, onClose: () => undefined, onSaved: () => undefined, client: { createManualTransaction: vi.fn() }, now: () => new Date('2026-11-14T03:00:00Z') }

/** Visible text and accessible names that start with a lower-case ASCII letter. */
function lowerCaseStarts(root: HTMLElement): string[] {
  const found: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.textContent?.trim() ?? ''
    if (/^[a-z]/.test(value)) found.push(value)
  }
  for (const element of root.querySelectorAll('[aria-label]')) {
    const value = element.getAttribute('aria-label')?.trim() ?? ''
    if (/^[a-z]/.test(value)) found.push(`aria-label: ${value}`)
  }
  return found
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-14T03:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  // The active locale is module state; render once in Japanese so later files start from the default.
  render(<I18nProvider>{null}</I18nProvider>)
})

describe('Simple screens in English', () => {
  it('Home uses capitalised labels and label-value pairs for the goal pace', async () => {
    const { container } = inLocale('en', <SimpleHome {...homeProps} month="2026-11" client={homeClient()} />)
    const hero = (await screen.findByRole('heading', { name: 'Left to spend this month' })).closest('section')!
    expect(within(hero).getByText('Budget')).toBeInTheDocument()
    expect(within(hero).getByRole('img')).toHaveAccessibleName('Spent ¥112,400 / Budget ¥155,000')
    const goalCard = screen.getByRole('heading', { name: '家族旅行' }).closest('section')!
    expect(within(goalCard).getByText('Savings goal')).toBeInTheDocument()
    expect(goalCard).toHaveTextContent('Needed per month ¥')
    expect(goalCard).toHaveTextContent(/Months left \d+/)
    expect(goalCard.textContent).not.toMatch(/\dmonth/)
    expect(lowerCaseStarts(container)).toEqual([])
  })

  it('Home names another month neutrally and offers Back to this month', async () => {
    const { container } = inLocale('en', <SimpleHome {...homeProps} month="2026-10" onGoToCurrentMonth={() => undefined} client={homeClient()} />)
    const hero = (await screen.findByRole('heading', { name: 'Left to spend' })).closest('section')!
    // The same words as the top bar's month button, not the raw 2026-10.
    expect(within(hero).getByText('October 2026')).toBeInTheDocument()
    expect(hero).not.toHaveTextContent('2026-10')
    expect(screen.getByRole('button', { name: 'Back to this month' })).toBeInTheDocument()
    expect(lowerCaseStarts(container)).toEqual([])
  })

  it('Home shows a reached goal as Goal reached and the loading state with a clear name', async () => {
    const client = homeClient()
    vi.mocked(client.listSavingsGoals).mockResolvedValue([{ ...goal, savedJpy: goal.targetJpy }])
    inLocale('en', <SimpleHome {...homeProps} month="2026-11" client={client} />)
    expect(screen.getByLabelText('Loading your home screen')).toBeInTheDocument()
    expect(await screen.findByText('Goal reached')).toBeInTheDocument()
  })

  it('quick-add sheet labels read Save, Amount, Date, Close, Type and Paid with', () => {
    const { container } = inLocale('en', <QuickAddSheet {...sheetProps} />)
    const dialog = screen.getByRole('dialog', { name: 'Add spending' })
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Amount')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Date')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(within(dialog).getByRole('group', { name: 'Type' })).toBeInTheDocument()
    expect(within(dialog).getByText('Paid with')).toBeInTheDocument()
    expect(lowerCaseStarts(container)).toEqual([])
  })

  it('tab bar reads Today, History, Budget, Savings, More', () => {
    const { container } = inLocale('en', <SimpleTabBar active="today" onSelect={() => undefined} />)
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Today', 'History', 'Budget', 'Savings', 'More'])
    expect(lowerCaseStarts(container)).toEqual([])
  })

  it('More page entries start with a capital and read naturally', () => {
    const { container } = inLocale('en', <SimpleMorePage mode="simple" onModeChange={() => undefined} onNavigate={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Recurring & fixed costs' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Audit trail' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(lowerCaseStarts(container)).toEqual([])
  })
})

describe('Simple screens in English: every other state starts with a capital', () => {
  it('over-budget hero and the needs-attention card', async () => {
    const client = homeClient()
    vi.mocked(client.queryDashboard).mockResolvedValue({
      ...dashboard, expenseJpy: 200_000,
      expenseCategories: [{ accountId: 'food', name: '食費', amountJpy: 180_000 }, { accountId: 'daily', name: '日用品', amountJpy: 20_000 }],
    })
    const { container } = inLocale('en', <SimpleHome {...homeProps} month="2026-11" client={client} />)
    expect(await screen.findByRole('heading', { name: 'Over budget by' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Category over budget' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument()
    expect(lowerCaseStarts(container)).toEqual([])
  })

  it('overdue goal card', async () => {
    const client = homeClient()
    vi.mocked(client.listSavingsGoals).mockResolvedValue([{ ...goal, targetDate: '2026-01-31' }])
    const { container } = inLocale('en', <SimpleHome {...homeProps} month="2026-11" client={client} />)
    expect(await screen.findByText('Past the target date')).toBeInTheDocument()
    expect(screen.getByText('Still to save')).toBeInTheDocument()
    expect(lowerCaseStarts(container)).toEqual([])
  })

  it('no-goal card', async () => {
    const client = homeClient()
    vi.mocked(client.listSavingsGoals).mockResolvedValue([])
    const { container } = inLocale('en', <SimpleHome {...homeProps} month="2026-11" client={client} />)
    expect(await screen.findByRole('button', { name: 'Create a goal' })).toBeInTheDocument()
    expect(lowerCaseStarts(container)).toEqual([])
  })

  it('loading state', () => {
    const client = homeClient()
    vi.mocked(client.queryDashboard).mockReturnValue(new Promise(() => undefined))
    const { container } = inLocale('en', <SimpleHome {...homeProps} month="2026-11" client={client} />)
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading your home screen')
    expect(lowerCaseStarts(container)).toEqual([])
  })

  it('error state', async () => {
    const client = homeClient()
    vi.mocked(client.queryDashboard).mockRejectedValue(new Error('offline'))
    const { container } = inLocale('en', <SimpleHome {...homeProps} month="2026-11" client={client} />)
    expect(await screen.findByText('Could not load')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(lowerCaseStarts(container)).toEqual([])
  })

  it('income sheet', () => {
    const { container } = inLocale('en', <QuickAddSheet {...sheetProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Income' }))
    expect(screen.getByRole('dialog', { name: 'Add income' })).toBeInTheDocument()
    expect(screen.getByText('Received in')).toBeInTheDocument()
    expect(lowerCaseStarts(container)).toEqual([])
  })

  it('empty sheet', () => {
    const { container } = inLocale('en', <QuickAddSheet {...sheetProps} accounts={accounts.filter((item) => item.accountKind !== 'EXPENSE')} onSetupAccounts={() => undefined} />)
    expect(screen.getByText('No account to record to')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set up accounts' })).toBeInTheDocument()
    expect(lowerCaseStarts(container)).toEqual([])
  })

  it('Simple sidebar entries', async () => {
    localStorage.setItem('kakeflow.uiMode', JSON.stringify({ 'demo-tanaka-family': 'simple' }))
    inLocale('en', <App />)
    const sidebar = await screen.findByRole('complementary', { name: 'Main navigation' })
    await waitFor(() => expect(sidebar.querySelector('.simple-nav-section')).not.toBeNull())
    const nav = sidebar.querySelector('nav')!
    expect(within(nav).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Today', 'History', 'Budget', 'Savings', 'More'])
    expect(lowerCaseStarts(nav)).toEqual([])
  })
})

describe('Simple screens in Vietnamese', () => {
  it('Home', async () => {
    inLocale('vi', <SimpleHome {...homeProps} month="2026-11" client={homeClient()} />)
    expect(screen.getByLabelText('Đang tải trang chủ')).toBeInTheDocument()
    const hero = (await screen.findByRole('heading', { name: 'Còn được tiêu tháng này' })).closest('section')!
    expect(within(hero).getByText('Ngân sách')).toBeInTheDocument()
    const goalCard = screen.getByRole('heading', { name: '家族旅行' }).closest('section')!
    expect(within(goalCard).getByText('Mục tiêu tiết kiệm')).toBeInTheDocument()
    expect(goalCard).toHaveTextContent('Cần để dành mỗi tháng ¥')
    expect(goalCard).toHaveTextContent(/Số tháng còn lại \d+/)
    expect(goalCard.textContent).not.toMatch(/\dtháng/)
  })

  it('Home for another month', async () => {
    inLocale('vi', <SimpleHome {...homeProps} month="2026-10" onGoToCurrentMonth={() => undefined} client={homeClient()} />)
    const hero = (await screen.findByRole('heading', { name: 'Còn lại' })).closest('section')!
    expect(within(hero).getByText('tháng 10 năm 2026')).toBeInTheDocument()
    expect(hero).not.toHaveTextContent('2026-10')
    expect(screen.getByRole('button', { name: 'Về tháng này' })).toBeInTheDocument()
  })

  it('quick-add sheet', () => {
    inLocale('vi', <QuickAddSheet {...sheetProps} />)
    const dialog = screen.getByRole('dialog', { name: 'Ghi chi tiêu' })
    expect(within(dialog).getByRole('button', { name: 'Lưu' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Số tiền')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Ngày')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Đóng' })).toBeInTheDocument()
    expect(within(dialog).getByRole('group', { name: 'Loại' })).toBeInTheDocument()
    expect(within(dialog).getByText('Trả bằng')).toBeInTheDocument()
  })

  it('tab bar', () => {
    inLocale('vi', <SimpleTabBar active="today" onSelect={() => undefined} />)
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Hôm nay', 'Giao dịch', 'Ngân sách', 'Tiết kiệm', 'Thêm'])
  })

  it('More page', () => {
    inLocale('vi', <SimpleMorePage mode="simple" onModeChange={() => undefined} onNavigate={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Khoản định kỳ & chi phí cố định' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nhật ký kiểm toán' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cài đặt' })).toBeInTheDocument()
  })
})
