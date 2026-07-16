import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

async function renderApp() {
  const result = render(<App />)
  await screen.findByText('ブラウザプレビュー')
  return result
}

describe('KakeFlow application shell', () => {
  it('renders the household overview with accounting KPIs', async () => {
    await renderApp()

    expect(screen.getByRole('heading', { name: '田中家の家計' })).toBeInTheDocument()
    expect(screen.getByText('純資産')).toBeInTheDocument()
    expect(screen.getByText('¥51,240,000')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'カード支払い' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'データ品質' })).toBeInTheDocument()
    expect(screen.getByText('ブラウザプレビュー用のサンプル状態')).toBeInTheDocument()
    expect(screen.getByLabelText('ホームの表示テンプレート')).toBeDisabled()
    expect(screen.getByText('表示設定の保存はデスクトップ版で利用できます。')).toBeInTheDocument()
    expect(screen.getByText('PayPayカード 支払期日 07-27')).toBeInTheDocument()
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
    expect(screen.getByText('反映可能')).toBeInTheDocument()
  })

  it('filters transactions without changing accounting totals', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '取引' }))

    const main = screen.getByRole('main')
    const search = within(main).getByPlaceholderText('店舗、カテゴリー、口座を検索')
    fireEvent.change(search, { target: { value: 'LOHACO' } })

    expect(screen.getByText('LOHACO 教材')).toBeInTheDocument()
    expect(screen.queryByText('成城石井')).not.toBeInTheDocument()
    expect(screen.getByText('支出 ¥637,080')).toBeInTheDocument()
  })

  it('switches between accrual expense and cash movement without double counting card payments', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '取引' }))

    expect(screen.getByText('LOHACO 教材')).toBeInTheDocument()
    expect(screen.queryByText('楽天カード支払い')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '資金移動' }))

    expect(screen.getByText('楽天カード支払い')).toBeInTheDocument()
    expect(screen.queryByText('LOHACO 教材')).not.toBeInTheDocument()
    expect(screen.getByText('現金流出 ¥812,237')).toBeInTheDocument()
  })

  it('explains reconciled card payments separately from expenses', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'カード照合' }))

    expect(screen.getByRole('heading', { name: 'カード引落・支払余力' })).toBeInTheDocument()
    expect(screen.getByText(/明示した銀行口座で今後のカード引落を支払えるか確認/)).toBeInTheDocument()
    expect(screen.getByText('Rakuten Card')).toBeInTheDocument()
    expect(screen.getAllByText('¥204,987').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('PayPayカード')).toBeInTheDocument()
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
  })

  it('presents Family Space as local organization rather than access control', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '家族スペース' }))

    expect(screen.getByRole('heading', { name: '家族スペース' })).toBeInTheDocument()
    expect(screen.getByText(/ログイン、閲覧制限、アクセス制御ではありません/)).toBeInTheDocument()
    expect(screen.getByText('家族メンバーの管理はデスクトップ版で利用できます。')).toBeInTheDocument()
    expect(screen.queryByText('TK')).not.toBeInTheDocument()
  })
})
