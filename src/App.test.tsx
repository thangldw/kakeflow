import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { delimitedParserProfilePlatform } from './features/parser-profiles/delimitedParserProfilePlatform'
import { I18nProvider } from './i18n'
import { platformClient } from './platform'

async function renderApp() {
  const result = render(<App />)
  await screen.findByText('ブラウザプレビュー')
  return result
}

describe('KakeFlow application shell', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders the household overview with accounting KPIs', async () => {
    const { container } = await renderApp()

    expect(screen.getByRole('heading', { name: '田中家の家計' })).toBeInTheDocument()
    expect(container.querySelector('.desktop-titlebar')).toBeInTheDocument()
    expect(screen.getByText('純資産')).toBeInTheDocument()
    expect(screen.getByText('¥51,240,000')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'カード支払い' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'データ品質' })).toBeInTheDocument()
    expect(screen.getByText('ブラウザプレビュー用のサンプル状態')).toBeInTheDocument()
    expect(screen.getByLabelText('ホームの表示テンプレート')).toBeEnabled()
    expect(screen.getByRole('combobox', { name: '世帯を切り替える' })).toHaveAttribute('aria-label', '世帯を切り替える')
    expect(screen.getByText('ブラウザでは表示設定を一時的に試せます。保存はデスクトップ版で利用できます。')).toBeInTheDocument()
    expect(screen.getByText('PayPayカード 支払期日 07-27')).toBeInTheDocument()
  })

  it('switches dashboard templates in browser preview without persisting them', async () => {
    await renderApp()
    await screen.findByRole('heading', { name: '田中家の家計' })

    const cashFlowTemplate = screen.getByRole('button', { name: 'テンプレート: キャッシュフロー' })
    await waitFor(() => expect(cashFlowTemplate).toBeEnabled())
    fireEvent.click(cashFlowTemplate)

    await waitFor(() => expect(cashFlowTemplate).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByLabelText('ホームの表示テンプレート')).toHaveValue('CASH_FLOW')
    expect(screen.getByRole('heading', { name: '入出金の推移' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /資金移動を見る/ })).toBeInTheDocument()
  })

  it('identifies the non-persistent browser preview runtime', async () => {
    await renderApp()

    await waitFor(() => expect(screen.getByText('ブラウザプレビュー')).toBeInTheDocument())
    expect(screen.getByText('ローカル · デスクトップ版')).toBeInTheDocument()
  })

  it('navigates to the import inbox', async () => {
    await renderApp()

    fireEvent.click(screen.getByRole('button', { name: 'インポート' }))

    expect(screen.getByRole('heading', { name: 'インポート Inbox' })).toBeInTheDocument()
    expect(screen.getByText('paypay_2026.csv')).toBeInTheDocument()
    expect(screen.getByText(/プレビュー可/)).toBeInTheDocument()
  })

  it('filters transactions without changing accounting totals', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '取引' }))

    const main = screen.getByRole('main')
    const search = within(main).getByPlaceholderText('店舗、カテゴリー、口座を検索')
    fireEvent.change(search, { target: { value: 'LOHACO' } })

    expect(screen.getByText('LOHACO 教材')).toBeInTheDocument()
    expect(screen.queryByText('成城石井')).not.toBeInTheDocument()
    expect(screen.getByText('支出 ¥747,943')).toBeInTheDocument()
  })

  it('switches between accrual expense and cash movement without double counting card payments', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '取引' }))

    expect(screen.getByText('LOHACO 教材')).toBeInTheDocument()
    expect(screen.queryByText('楽天カード支払い')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '資金移動' }))

    expect(screen.getByText('楽天カード支払い')).toBeInTheDocument()
    expect(screen.queryByText('LOHACO 教材')).not.toBeInTheDocument()
    expect(screen.getByText('現金流出 ¥923,100')).toBeInTheDocument()
  })

  it('explains reconciled card payments separately from expenses', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'カード照合' }))

    expect(screen.getByRole('heading', { name: 'カード引落・支払余力' })).toBeInTheDocument()
    expect(screen.getByText(/明示した銀行口座で今後のカード引落を支払えるか確認/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rakuten Card' })).toBeVisible()
    expect(screen.getByText('•••• 8106')).toBeVisible()
    expect(screen.getAllByText('¥204,987').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('heading', { name: 'PayPayカード' })).toBeVisible()
    expect(screen.getByText('•••• 2841')).toBeVisible()
  })

  it('shows the complete 20 million yen investment allocation in browser preview', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '資産・投資' }))

    expect(screen.getAllByText('¥20,000,000').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('楽天証券・株式／投資信託（60%）')).toBeInTheDocument()
    expect(screen.getByText('SBI証券・金銀（20%）')).toBeInTheDocument()
    expect(screen.getByText('みずほ証券・不動産投資（20%）')).toBeInTheDocument()
  })

  it('keeps encrypted backup controls desktop-only in browser preview', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '設定' }))

    expect(screen.getByRole('heading', { name: '設定' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'バックアップを作成' })).toBeDisabled()
    expect(screen.getByText('デスクトップ版で利用できます。')).toBeInTheDocument()
    await waitFor(() => {
      expect(document.querySelectorAll('.drive-state-UNAVAILABLE')).toHaveLength(2)
      expect(Array.from(document.querySelectorAll('.google-drive-settings')).every((panel) => panel.getAttribute('aria-busy') === 'false')).toBe(true)
    })
  })

  it('keeps the manual connector summary read-only when binding management is unavailable in the browser runtime', async () => {
    const listBindings = vi.spyOn(platformClient, 'listConnectorBindings')
    const upsertBinding = vi.spyOn(platformClient, 'upsertConnectorBinding')
    const deleteBinding = vi.spyOn(platformClient, 'deleteConnectorBinding')
    const listAccounts = vi.spyOn(platformClient, 'listAccounts')
    const listProfiles = vi.spyOn(delimitedParserProfilePlatform, 'list')
    await renderApp()
    const accountCallsBeforeSettings = listAccounts.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: '設定' }))

    const card = await screen.findByRole('article', { name: 'Manual import' })
    expect(within(card).getByText(/この実行環境では利用できません/)).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'レビュー範囲を管理' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
    expect(screen.queryByText('コネクタの状態を読み込めませんでした。')).not.toBeInTheDocument()
    expect(listBindings).not.toHaveBeenCalled()
    expect(upsertBinding).not.toHaveBeenCalled()
    expect(deleteBinding).not.toHaveBeenCalled()
    expect(listProfiles).not.toHaveBeenCalled()
    expect(listAccounts).toHaveBeenCalledTimes(accountCallsBeforeSettings)
  })

  it('presents Family Space as local organization rather than access control', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '家族スペース' }))

    expect(screen.getByRole('heading', { name: '家族スペース' })).toBeInTheDocument()
    expect(screen.getByText(/ログイン、閲覧制限、アクセス制御ではありません/)).toBeInTheDocument()
    expect(screen.getByText('家族メンバーの管理はデスクトップ版で利用できます。')).toBeInTheDocument()
    expect(screen.queryByText('TK')).not.toBeInTheDocument()
  })

  it('keeps navigation and investment controls fully Vietnamese after switching language', async () => {
    render(<I18nProvider><App /></I18nProvider>)
    await screen.findByText('ブラウザプレビュー')

    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tiếng Việt' }))

    expect(screen.getByRole('button', { name: 'Định kỳ & chi phí cố định' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kiểm toán & chứng từ' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tài sản & đầu tư' }))

    expect(await screen.findByRole('tab', { name: 'Ảnh chụp tài sản' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Lãi/lỗ đã thực hiện (FIFO)' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Diễn biến & định giá' })).toBeVisible()
    expect(screen.getByText('Ảnh chụp tài sản đang hiển thị')).toBeVisible()
    expect(screen.queryByText('スナップショット')).not.toBeInTheDocument()
    expect(screen.queryByText('表示するスナップショット')).not.toBeInTheDocument()
  })
})
