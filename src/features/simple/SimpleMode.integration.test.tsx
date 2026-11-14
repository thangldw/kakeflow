import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountingBasisDto, DashboardExpenseCategoryDto, DashboardMonthlyTotalsDto } from '../../platform/types'

// The shell runs against the browser preview client by default. Tests that need
// ledger data switch `runtime.tauri` on; the listed methods are then replaced by
// mocks and every other call still falls back to the preview client.
const runtime = vi.hoisted(() => ({ tauri: false }))
const desktop = vi.hoisted(() => ({
  listHouseholds: vi.fn(),
  createHousehold: vi.fn(),
  listHouseholdMembers: vi.fn(),
  listAccounts: vi.fn(),
  queryDashboard: vi.fn(),
  queryTransactions: vi.fn(),
  listBudgets: vi.fn(),
  listSavingsGoals: vi.fn(),
  createManualTransaction: vi.fn(),
  getTransactionDetail: vi.fn(),
  listTransactionSourceRecords: vi.fn(),
  getDashboardPreferences: vi.fn(),
}))
const nativeInvoke = vi.hoisted(() => vi.fn())
const accountGroups = vi.hoisted(() => ({ groups: [] as unknown[] }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: nativeInvoke }))
vi.mock('../../platform', async () => {
  const actual = await vi.importActual<typeof import('../../platform')>('../../platform')
  const web = actual.platformClient as unknown as Record<string | symbol, unknown>
  const overrides = desktop as unknown as Record<string | symbol, unknown>
  const platformClient = new Proxy(web, {
    get(target, property) {
      if (property === 'runtime') return runtime.tauri ? 'tauri' : 'web'
      if (runtime.tauri && property in overrides) return overrides[property]
      return target[property]
    },
  })
  return { ...actual, platformClient }
})

import App from '../../App'
import { platformClient } from '../../platform'

const FAMILY = { id: 'family', name: '田中家', baseCurrency: 'JPY', createdAt: '2026-07-01T00:00:00Z' }
const OTHER = { id: 'other', name: '実家', baseCurrency: 'JPY', createdAt: '2026-07-01T00:00:00Z' }
const account = (id: string, name: string, accountKind: string, accountSubtype: string) => ({ id, name, accountKind, accountSubtype, currency: 'JPY', ownershipKind: 'HOUSEHOLD', ownerMemberId: null, ownerMemberName: null, visibility: 'SHARED' })
const ACCOUNTS = [
  account('family-bank', '銀行', 'ASSET', 'BANK'),
  account('family-food-expense', '食費', 'EXPENSE', 'OTHER'),
  account('family-other-expense', 'その他', 'EXPENSE', 'OTHER'),
  account('family-income', '収入', 'INCOME', 'OTHER'),
]
const LAYOUTS = {
  FINANCIAL_OVERVIEW: { widgetOrder: ['TREND', 'SPENDING', 'RECENT', 'CARDS'], hiddenWidgets: [] },
  HOUSEHOLD_LEDGER: { widgetOrder: ['SPENDING', 'RECENT', 'TREND', 'CARDS'], hiddenWidgets: [] },
  ASSETS_LIABILITIES: { widgetOrder: ['TREND', 'SPENDING', 'CARDS', 'RECENT'], hiddenWidgets: [] },
  CARD_RECONCILIATION: { widgetOrder: ['CARDS', 'RECENT', 'TREND', 'SPENDING'], hiddenWidgets: [] },
  CASH_FLOW: { widgetOrder: ['TREND', 'RECENT', 'CARDS', 'SPENDING'], hiddenWidgets: [] },
}
// Typed as the real DTO so the Home reads categories by `accountId` exactly as it does at runtime.
function dashboard(request: { month: string; accountingBasis: AccountingBasisDto }, expenseJpy: number): DashboardMonthlyTotalsDto {
  return {
    month: request.month, accountingBasis: request.accountingBasis, incomeJpy: 300_000, expenseJpy, savingsJpy: 300_000 - expenseJpy, postedTransactionCount: 3,
    netWorthAsOf: `${request.month}-01`, assetsJpy: 0, liabilitiesJpy: 0, netWorthJpy: 0, accrualTrend: [], cashFlowTrend: [],
    expenseCategories: categoryActuals ?? [{ accountId: 'family-food-expense', name: '食費', amountJpy: expenseJpy }],
  }
}

let expenseJpy = 40_000
/** Per-category spending for the dashboard; null means everything was spent on food. */
let categoryActuals: DashboardExpenseCategoryDto[] | null = null

function setUpDesktop() {
  runtime.tauri = true
  expenseJpy = 40_000
  categoryActuals = null
  desktop.listHouseholds.mockReset().mockResolvedValue([FAMILY])
  desktop.createHousehold.mockReset().mockImplementation(async (input: { id: string; name: string }) => ({ id: 'new-home', name: input.name, baseCurrency: 'JPY', createdAt: '2026-11-14T00:00:00Z' }))
  desktop.listHouseholdMembers.mockReset().mockResolvedValue([{ id: 'taro', householdId: 'family', displayName: '太郎', relationshipLabel: '父', status: 'ACTIVE', sortOrder: 0, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z' }])
  desktop.listAccounts.mockReset().mockResolvedValue(ACCOUNTS)
  desktop.queryDashboard.mockReset().mockImplementation(async (request: { month: string; accountingBasis: AccountingBasisDto }) => dashboard(request, expenseJpy))
  desktop.queryTransactions.mockReset().mockResolvedValue({ items: [], page: 1, pageSize: 25, totalItems: 0, totalPages: 0 })
  desktop.listBudgets.mockReset().mockImplementation(async (_householdId: string, month: string) => [{ householdId: 'family', month, categoryAccountId: 'family-food-expense', categoryName: '食費', budgetJpy: 100_000, actualJpy: expenseJpy, remainingJpy: 100_000 - expenseJpy }])
  desktop.listSavingsGoals.mockReset().mockResolvedValue([])
  desktop.createManualTransaction.mockReset().mockImplementation(async (input: { id: string }) => {
    expenseJpy += 1_500
    return { id: input.id, occurredOn: '2026-11-14', postedOn: null, transactionType: 'EXPENSE', payee: null, description: null, amountJpy: 1500, status: 'POSTED', calculationTarget: true, debitAccountId: 'family-food-expense', debitAccountName: '食費', creditAccountId: 'family-bank', creditAccountName: '銀行', categoryAccountId: 'family-food-expense', categoryName: '食費', attributionKind: 'HOUSEHOLD', attributedMemberId: null, attributedMemberName: null, audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null }
  })
  desktop.getTransactionDetail.mockReset().mockResolvedValue({ id: 'manual-1', householdId: 'family', occurredOn: '2026-11-14', postedOn: null, transactionType: 'EXPENSE', payee: 'お弁当', description: null, calculationTarget: true, attributionKind: 'HOUSEHOLD', attributedMemberId: null, attributedMemberName: null, audienceVisibility: 'SHARED', audienceMemberId: null, audienceMemberName: null, status: 'POSTED', createdAt: '2026-11-14T00:00:00Z', updatedAt: '2026-11-14T00:00:00Z', editable: true, entries: [{ id: 'debit', accountId: 'family-food-expense', accountName: '食費', accountKind: 'EXPENSE', side: 'DEBIT', amountJpy: 1500, lineNumber: 1 }, { id: 'credit', accountId: 'family-bank', accountName: '銀行', accountKind: 'ASSET', side: 'CREDIT', amountJpy: 1500, lineNumber: 2 }], sourceEvidence: [] })
  desktop.listTransactionSourceRecords.mockReset().mockResolvedValue([])
  desktop.getDashboardPreferences.mockReset().mockImplementation(async (householdId: string) => ({ householdId, template: 'FINANCIAL_OVERVIEW', theme: 'SYSTEM', density: 'COMFORTABLE', templateLayouts: LAYOUTS, updatedAt: '2026-07-13T00:00:00Z' }))
}

const storeMode = (modes: Record<string, 'simple' | 'full'>) => localStorage.setItem('kakeflow.uiMode', JSON.stringify(modes))
const sidebar = () => screen.getByRole('complementary', { name: 'メインナビゲーション' })
const tabBar = () => screen.getByRole('navigation', { name: '主なページ' })
const simpleHome = () => document.querySelector('.simple-home')
// The top bar and the floating button both read "＋ 支出を記録"; CSS shows one of them per screen width.
const floatingAdd = () => document.querySelector<HTMLButtonElement>('.simple-add-fab')!
const topbarAdd = () => within(document.querySelector<HTMLElement>('.topbar')!).getByRole('button', { name: '＋ 支出を記録' })

async function renderSimpleDesktop() {
  setUpDesktop()
  storeMode({ family: 'simple' })
  render(<App />)
  await screen.findByRole('heading', { name: '今月あと使える金額' })
}

beforeEach(() => {
  localStorage.clear()
  runtime.tauri = false
  accountGroups.groups = []
  nativeInvoke.mockReset().mockImplementation(async (command: string) => {
    if (command === 'account_groups_list') return accountGroups.groups
    throw new Error(`unexpected native command ${command}`)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  runtime.tauri = false
})

describe('Simple mode in the app shell', () => {
  it('renders the existing Full Home and sidebar when no mode is stored', async () => {
    render(<App />)
    await screen.findByText('ブラウザプレビュー')
    expect(screen.getByRole('button', { name: 'テンプレート: キャッシュフロー' })).toBeInTheDocument()
    expect(within(sidebar()).getByRole('button', { name: 'インポート' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '主なページ' })).not.toBeInTheDocument()
    expect(simpleHome()).toBeNull()
    expect(screen.queryByRole('button', { name: '＋ 支出を記録' })).not.toBeInTheDocument()
  })

  it('renders the Simple Home, five entries and a reduced top bar when simple is stored', async () => {
    storeMode({ 'demo-tanaka-family': 'simple' })
    render(<App />)
    await waitFor(() => expect(simpleHome()).not.toBeNull())
    expect(screen.queryByRole('button', { name: 'テンプレート: キャッシュフロー' })).not.toBeInTheDocument()
    expect(within(tabBar()).getAllByRole('button').map((button) => button.textContent)).toEqual(['今日', '取引一覧', '予算管理', '貯蓄管理', 'そのほか'])
    expect(screen.queryByRole('group', { name: '計上基準' })).not.toBeInTheDocument()
    expect(screen.queryByText('範囲:')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '前月' })).toBeInTheDocument()
    expect(floatingAdd()).toHaveTextContent('＋ 支出を記録')
    expect(topbarAdd()).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '手入力取引' })).not.toBeInTheDocument()
    expect(document.querySelector('.app-shell')).toHaveClass('app-shell--simple')
    expect(document.querySelector('.scope-footnote')).toBeNull()
  })

  it('shows five sidebar entries, marks the active one, navigates and keeps names when collapsed', async () => {
    storeMode({ 'demo-tanaka-family': 'simple' })
    render(<App />)
    await waitFor(() => expect(simpleHome()).not.toBeNull())
    const entries = within(sidebar()).getAllByRole('button').filter((button) => button.classList.contains('nav-item') && button.closest('nav'))
    expect(entries.map((button) => button.getAttribute('aria-label'))).toEqual(['今日', '取引一覧', '予算管理', '貯蓄管理', 'そのほか'])
    expect(within(sidebar()).getByRole('button', { name: '今日' })).toHaveAttribute('aria-current', 'page')
    expect(within(sidebar()).queryByRole('button', { name: 'インポート' })).not.toBeInTheDocument()

    fireEvent.click(within(sidebar()).getByRole('button', { name: '取引一覧' }))
    expect(within(sidebar()).getByRole('button', { name: '取引一覧' })).toHaveAttribute('aria-current', 'page')
    expect(within(sidebar()).getByRole('button', { name: '今日' })).not.toHaveAttribute('aria-current')
    expect(within(tabBar()).getByRole('button', { name: '取引一覧' })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(within(sidebar()).getByRole('button', { name: 'サイドバーを折りたたむ' }))
    expect(sidebar()).toHaveClass('sidebar--collapsed')
    for (const name of ['今日', '取引一覧', '予算管理', '貯蓄管理', 'そのほか']) expect(within(sidebar()).getByRole('button', { name })).toBeInTheDocument()
  })

  it('opens the quick-add sheet from the top bar instead of navigating', async () => {
    await renderSimpleDesktop()
    fireEvent.click(topbarAdd())
    expect(await screen.findByRole('dialog', { name: '支出を記録' })).toBeInTheDocument()
    expect(simpleHome()).not.toBeNull()
    expect(screen.queryByRole('heading', { name: '取引' })).not.toBeInTheDocument()
  })

  it('refreshes the Home after saving and offers Edit, which opens the transaction detail', async () => {
    await renderSimpleDesktop()
    expect(screen.getByText('¥60,000')).toBeInTheDocument()

    fireEvent.click(floatingAdd())
    const sheet = await screen.findByRole('dialog', { name: '支出を記録' })
    fireEvent.change(within(sheet).getByLabelText('記録する金額'), { target: { value: '1500' } })
    fireEvent.click(within(sheet).getByRole('button', { name: '食費' }))
    fireEvent.click(within(sheet).getByRole('button', { name: '記録を保存' }))

    await waitFor(() => expect(desktop.createManualTransaction).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '支出を記録' })).not.toBeInTheDocument())
    expect(await screen.findByText('¥58,500')).toBeInTheDocument()
    const toast = await screen.findByRole('status')
    expect(toast).toHaveTextContent('保存しました')
    expect(toast).toHaveTextContent('¥1,500')
    expect(toast).toHaveTextContent('食費')

    fireEvent.click(within(toast).getByRole('button', { name: '修正' }))
    const savedId = (desktop.createManualTransaction.mock.calls[0][0] as { id: string }).id
    await waitFor(() => expect(desktop.getTransactionDetail).toHaveBeenCalledWith('family', savedId))
    expect(await screen.findByRole('dialog', { name: 'お弁当' })).toBeInTheDocument()
    expect(within(sidebar()).getByRole('button', { name: '取引一覧' })).toHaveAttribute('aria-current', 'page')
  })

  it('labels a saved earlier month neutrally and goes back to this month from the Home', async () => {
    setUpDesktop()
    storeMode({ family: 'simple' })
    localStorage.setItem('kakeflow.selectedMonth', '2020-01')
    render(<App />)
    const label = await screen.findByRole('heading', { name: '残り金額' })
    expect(label.closest('section')).toHaveTextContent('2020-01')
    fireEvent.click(screen.getByRole('button', { name: '今月に戻る' }))
    expect(await screen.findByRole('heading', { name: '今月あと使える金額' })).toBeInTheDocument()
    expect(localStorage.getItem('kakeflow.selectedMonth')).not.toBe('2020-01')
    expect(screen.queryByRole('button', { name: '今月に戻る' })).not.toBeInTheDocument()
  })

  it('shows the most overspent category and unbudgeted spending from the dashboard categories', async () => {
    setUpDesktop()
    expenseJpy = 125_000
    // Food has a 100,000 budget; その他 has none.
    categoryActuals = [
      { accountId: 'family-food-expense', name: '食費', amountJpy: 120_000 },
      { accountId: 'family-other-expense', name: 'その他', amountJpy: 5_000 },
    ]
    storeMode({ family: 'simple' })
    render(<App />)
    const attention = (await screen.findByRole('heading', { name: '予算を超えたカテゴリー' })).closest('section')!
    expect(attention).toHaveTextContent('食費')
    expect(attention).toHaveTextContent('+¥20,000')
    expect(screen.getByText('予算のないカテゴリーの支出').parentElement).toHaveTextContent('¥5,000')
  })

  it('has no attention card or unbudgeted line when all spending is within a budget', async () => {
    await renderSimpleDesktop()
    expect(screen.queryByRole('heading', { name: '予算を超えたカテゴリー' })).not.toBeInTheDocument()
    expect(screen.queryByText('予算のないカテゴリーの支出')).not.toBeInTheDocument()
  })

  it('offers account setup from an empty quick-add sheet', async () => {
    storeMode({ 'demo-tanaka-family': 'simple' })
    render(<App />)
    await waitFor(() => expect(simpleHome()).not.toBeNull())
    fireEvent.click(floatingAdd())
    fireEvent.click(await screen.findByRole('button', { name: '口座を設定する' }))
    expect(await screen.findByRole('heading', { name: '設定', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '支出を記録' })).not.toBeInTheDocument()
  })

  it('opens the budgets page from Budget and scrolls to the goals from Savings', async () => {
    storeMode({ 'demo-tanaka-family': 'simple' })
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollIntoView })
    try {
      render(<App />)
      await waitFor(() => expect(simpleHome()).not.toBeNull())

      fireEvent.click(within(tabBar()).getByRole('button', { name: '予算管理' }))
      expect(await screen.findByRole('heading', { name: '予算・貯蓄目標' })).toBeInTheDocument()
      expect(within(tabBar()).getByRole('button', { name: '予算管理' })).toHaveAttribute('aria-current', 'page')

      fireEvent.click(within(tabBar()).getByRole('button', { name: '貯蓄管理' }))
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
      expect(scrollIntoView.mock.contexts.at(-1)).toBe(document.getElementById('goals'))
      expect(within(tabBar()).getByRole('button', { name: '貯蓄管理' })).toHaveAttribute('aria-current', 'page')
      expect(within(sidebar()).getByRole('button', { name: '貯蓄管理' })).toHaveAttribute('aria-current', 'page')

      fireEvent.click(within(tabBar()).getByRole('button', { name: '予算管理' }))
      expect(within(tabBar()).getByRole('button', { name: '予算管理' })).toHaveAttribute('aria-current', 'page')
    } finally {
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
    }
  })

  it('does not crash when scrollIntoView is unavailable', async () => {
    storeMode({ 'demo-tanaka-family': 'simple' })
    render(<App />)
    await waitFor(() => expect(simpleHome()).not.toBeNull())
    fireEvent.click(within(tabBar()).getByRole('button', { name: '貯蓄管理' }))
    expect(await screen.findByRole('heading', { name: '予算・貯蓄目標' })).toBeInTheDocument()
  })

  it('restores the Full shell without a reload when Full is chosen in More', async () => {
    storeMode({ 'demo-tanaka-family': 'simple' })
    render(<App />)
    await waitFor(() => expect(simpleHome()).not.toBeNull())
    fireEvent.click(within(tabBar()).getByRole('button', { name: 'そのほか' }))
    fireEvent.click(within(screen.getByRole('group', { name: '表示モード' })).getByRole('button', { name: '詳細' }))

    expect(await screen.findByRole('button', { name: 'テンプレート: キャッシュフロー' })).toBeInTheDocument()
    expect(within(sidebar()).getByRole('button', { name: 'インポート' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '主なページ' })).not.toBeInTheDocument()
    expect(localStorage.getItem('kakeflow.uiMode')).toBeNull()
  })

  it('switches to Simple from Settings', async () => {
    render(<App />)
    await screen.findByText('ブラウザプレビュー')
    fireEvent.click(within(sidebar()).getByRole('button', { name: '設定' }))
    fireEvent.click(within(await screen.findByRole('group', { name: '表示モード' })).getByRole('button', { name: 'かんたん' }))
    expect(screen.getByRole('navigation', { name: '主なページ' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('kakeflow.uiMode') ?? '{}')).toEqual({ 'demo-tanaka-family': 'simple' })
  })

  it('keeps the goals scroll after the shell resets the page scroll on the web runtime', async () => {
    storeMode({ 'demo-tanaka-family': 'simple' })
    const requests: string[] = []
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value(this: Element) { requests.push(this.id === 'goals' ? 'goals' : 'other') } })
    Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, writable: true, value(this: Element) { if (this.matches('.main-shell > main')) requests.push('top') } })
    try {
      render(<App />)
      await waitFor(() => expect(simpleHome()).not.toBeNull())
      requests.length = 0
      fireEvent.click(within(tabBar()).getByRole('button', { name: '貯蓄管理' }))
      await waitFor(() => expect(requests).toContain('goals'))
      await new Promise((resolve) => globalThis.setTimeout(resolve, 30))
      expect(requests).toContain('top')
      expect(requests.at(-1)).toBe('goals')
      expect(requests.filter((request) => request === 'goals')).toHaveLength(1)
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView
      delete (Element.prototype as Partial<Element>).scrollTo
    }
  })

  it('scrolls back to the top when Budget is tapped after Savings on the same page', async () => {
    storeMode({ 'demo-tanaka-family': 'simple' })
    const requests: string[] = []
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value(this: Element) { requests.push(this.id === 'goals' ? 'goals' : 'other') } })
    Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, writable: true, value(this: Element) { if (this.matches('.main-shell > main')) requests.push('top') } })
    try {
      render(<App />)
      await waitFor(() => expect(simpleHome()).not.toBeNull())
      fireEvent.click(within(tabBar()).getByRole('button', { name: '貯蓄管理' }))
      await waitFor(() => expect(requests.at(-1)).toBe('goals'))
      requests.length = 0

      fireEvent.click(within(tabBar()).getByRole('button', { name: '予算管理' }))
      await new Promise((resolve) => globalThis.setTimeout(resolve, 30))
      expect(requests).toEqual(['top'])
      expect(within(tabBar()).getByRole('button', { name: '予算管理' })).toHaveAttribute('aria-current', 'page')

      // Savings still scrolls to the goals for every new tap.
      fireEvent.click(within(tabBar()).getByRole('button', { name: '貯蓄管理' }))
      await waitFor(() => expect(requests.at(-1)).toBe('goals'))
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView
      delete (Element.prototype as Partial<Element>).scrollTo
    }
  })

  describe('Savings scroll on the desktop runtime', () => {
    const scrolled: Element[] = []
    beforeEach(() => {
      scrolled.length = 0
      Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value(this: Element) { scrolled.push(this) } })
    })
    afterEach(() => { delete (Element.prototype as Partial<Element>).scrollIntoView })
    const GOAL = { id: 'goal-1', householdId: 'family', name: '旅行', targetJpy: 300_000, savedJpy: 100_000, targetDate: '2027-11-01', status: 'ACTIVE', createdAt: '2026-07-01', updatedAt: '2026-07-01' }

    it('scrolls to the goals only after the budgets page has loaded its data', async () => {
      await renderSimpleDesktop()
      let releaseBudgets: () => void = () => undefined
      let releaseGoals: () => void = () => undefined
      const budgetsLoaded = new Promise<void>((resolve) => { releaseBudgets = resolve })
      const goalsLoaded = new Promise<void>((resolve) => { releaseGoals = resolve })
      const budgetsImpl = desktop.listBudgets.getMockImplementation()
      desktop.listBudgets.mockImplementation(async (householdId: string, month: string) => { await budgetsLoaded; return budgetsImpl?.(householdId, month) })
      desktop.listSavingsGoals.mockImplementation(async () => { await goalsLoaded; return [GOAL] })

      fireEvent.click(within(tabBar()).getByRole('button', { name: '貯蓄管理' }))
      expect(await screen.findByRole('heading', { name: '予算・貯蓄目標' })).toBeInTheDocument()
      await new Promise((resolve) => globalThis.setTimeout(resolve, 30))
      expect(scrolled).toEqual([])

      releaseBudgets()
      releaseGoals()
      await waitFor(() => expect(scrolled).toHaveLength(1))
      expect(scrolled[0]).toBe(document.getElementById('goals'))
      expect(within(document.getElementById('goals') as HTMLElement).getByText('旅行')).toBeInTheDocument()
    })

    it('scrolls to the goals when Savings is tapped while the budgets page is already open', async () => {
      await renderSimpleDesktop()
      desktop.listSavingsGoals.mockResolvedValue([GOAL])
      fireEvent.click(within(tabBar()).getByRole('button', { name: '予算管理' }))
      await screen.findByRole('heading', { name: '予算・貯蓄目標' })
      await waitFor(() => expect(desktop.listSavingsGoals).toHaveBeenCalled())
      await new Promise((resolve) => globalThis.setTimeout(resolve, 30))
      expect(scrolled).toEqual([])
      const loadsBefore = desktop.listBudgets.mock.calls.length

      fireEvent.click(within(tabBar()).getByRole('button', { name: '貯蓄管理' }))
      await waitFor(() => expect(scrolled).toHaveLength(1))
      expect(scrolled[0]).toBe(document.getElementById('goals'))
      expect(desktop.listBudgets.mock.calls.length).toBe(loadsBefore)
    })
  })

  it('leaves More for the Full Home when the household switched to is in Full mode', async () => {
    setUpDesktop()
    desktop.listHouseholds.mockResolvedValue([FAMILY, OTHER])
    storeMode({ family: 'simple' })
    render(<App />)
    await waitFor(() => expect(within(screen.getByRole('combobox', { name: '世帯を切り替える' })).getAllByRole('option')).toHaveLength(3))
    await screen.findByRole('heading', { name: '今月あと使える金額' })
    fireEvent.click(within(tabBar()).getByRole('button', { name: 'そのほか' }))
    expect(screen.getByRole('group', { name: '表示モード' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: '世帯を切り替える' }), { target: { value: 'other' } })
    // Checked right after the change: the Simple-only list must not render even for one frame in Full mode.
    expect(document.querySelector('.simple-more')).toBeNull()
    expect(screen.queryByRole('group', { name: '表示モード' })).not.toBeInTheDocument()
    expect(within(sidebar()).getByRole('button', { name: 'ホーム' })).toHaveClass('active')
    expect(await screen.findByRole('button', { name: 'テンプレート: キャッシュフロー' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '表示モード' })).not.toBeInTheDocument()
  })

  it('re-reads the mode when the household changes', async () => {
    setUpDesktop()
    desktop.listHouseholds.mockResolvedValue([FAMILY, OTHER])
    storeMode({ family: 'simple' })
    render(<App />)
    await waitFor(() => expect(within(screen.getByRole('combobox', { name: '世帯を切り替える' })).getAllByRole('option')).toHaveLength(3))
    await waitFor(() => expect(simpleHome()).not.toBeNull())

    fireEvent.change(screen.getByRole('combobox', { name: '世帯を切り替える' }), { target: { value: 'other' } })
    await waitFor(() => expect(simpleHome()).toBeNull())
    expect(screen.queryByRole('navigation', { name: '主なページ' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: '世帯を切り替える' }), { target: { value: 'family' } })
    await waitFor(() => expect(simpleHome()).not.toBeNull())
  })

  it('ignores a saved member scope and account group in Simple mode and applies them again in Full', async () => {
    setUpDesktop()
    storeMode({ family: 'simple' })
    accountGroups.groups = [{ id: 'g1', householdId: 'family', name: '生活費', groupKind: 'FAMILY', sortOrder: 0, accountIds: ['family-bank'], createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z' }]
    localStorage.setItem('kakeflow.attributionScopes', JSON.stringify({ family: { kind: 'MEMBER', memberId: 'taro' } }))
    localStorage.setItem('kakeflow.accountScope', JSON.stringify({ householdId: 'family', groupId: 'g1' }))
    render(<App />)
    await screen.findByRole('heading', { name: '今月あと使える金額' })
    await waitFor(() => expect(nativeInvoke).toHaveBeenCalledWith('account_groups_list', { householdId: 'family' }))
    await waitFor(() => expect(desktop.listHouseholdMembers).toHaveBeenCalled())

    expect(desktop.queryDashboard.mock.calls.length).toBeGreaterThan(0)
    for (const [request] of desktop.queryDashboard.mock.calls) {
      expect(request).toMatchObject({ accountGroupId: null, attributionScope: { kind: 'ALL' } })
    }
    expect(document.querySelector('.attribution-scope-disclosure')).toBeNull()
    expect(JSON.parse(localStorage.getItem('kakeflow.attributionScopes') ?? '{}')).toEqual({ family: { kind: 'MEMBER', memberId: 'taro' } })
    expect(JSON.parse(localStorage.getItem('kakeflow.accountScope') ?? '{}')).toEqual({ householdId: 'family', groupId: 'g1' })

    fireEvent.click(within(tabBar()).getByRole('button', { name: 'そのほか' }))
    fireEvent.click(within(screen.getByRole('group', { name: '表示モード' })).getByRole('button', { name: '詳細' }))
    await waitFor(() => expect(desktop.queryDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ accountGroupId: 'g1', attributionScope: { kind: 'MEMBER', memberId: 'taro' } })))
    expect(document.querySelector('.attribution-scope-disclosure')).not.toBeNull()
  })

  it('skips the Full dashboard reads in Simple mode, keeps the shared ones and runs all of them again in Full', async () => {
    setUpDesktop()
    // Not part of the desktop overrides, so they reach the preview client; spy on them through the mocked module.
    const importSummary = vi.spyOn(platformClient, 'importSummary')
    const listCardSettlements = vi.spyOn(platformClient, 'listCardSettlements')
    storeMode({ family: 'simple' })
    render(<App />)
    await screen.findByRole('heading', { name: '今月あと使える金額' })
    await waitFor(() => expect(importSummary).toHaveBeenCalledWith('family'))
    await waitFor(() => expect(listCardSettlements).toHaveBeenCalledWith('family'))

    // The shell's four recent rows are never read; every dashboard read comes from the Simple Home's own loader,
    // which reads the budgets of the shown month once per load.
    const shownMonth = (desktop.queryDashboard.mock.calls[0][0] as { month: string }).month
    const homeLoads = () => desktop.listBudgets.mock.calls.filter(([, month]) => month === shownMonth).length
    expect(desktop.queryTransactions).not.toHaveBeenCalled()
    expect(desktop.queryDashboard.mock.calls.length).toBe(homeLoads())

    // A change of month reruns the shell batch: still without the Full reads.
    const summaryCalls = importSummary.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '前月' }))
    await screen.findByRole('heading', { name: '残り金額' })
    await waitFor(() => expect(importSummary.mock.calls.length).toBeGreaterThan(summaryCalls))
    expect(desktop.queryTransactions).not.toHaveBeenCalled()

    fireEvent.click(within(tabBar()).getByRole('button', { name: 'そのほか' }))
    fireEvent.click(within(screen.getByRole('group', { name: '表示モード' })).getByRole('button', { name: '詳細' }))
    await waitFor(() => expect(desktop.queryTransactions).toHaveBeenCalledWith(expect.objectContaining({ householdId: 'family', page: 1, pageSize: 4 })))
    await waitFor(() => expect(desktop.queryDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ householdId: 'family', accountingBasis: 'ACCRUAL' })))
    // The Full Home leaves its loading state with the dashboard figures.
    expect(await screen.findByRole('button', { name: 'テンプレート: キャッシュフロー' })).toBeInTheDocument()
    expect(document.querySelector('.dashboard-loading')).toBeNull()
  })

  it('stores simple for a household created through onboarding', async () => {
    setUpDesktop()
    desktop.listHouseholds.mockResolvedValue([])
    render(<App />)
    fireEvent.change(await screen.findByLabelText('世帯名'), { target: { value: '山田家' } })
    fireEvent.click(screen.getByRole('button', { name: '安全な家計簿を作成' }))

    await waitFor(() => expect(desktop.createHousehold).toHaveBeenCalled())
    await waitFor(() => expect(JSON.parse(localStorage.getItem('kakeflow.uiMode') ?? '{}')).toEqual({ 'new-home': 'simple' }))
    expect(await screen.findByRole('navigation', { name: '主なページ' })).toBeInTheDocument()
  })
})
