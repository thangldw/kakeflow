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

    expect(screen.getByRole('heading', { name: 'こんにちは、田中さん' })).toBeInTheDocument()
    expect(screen.getByText('純資産')).toBeInTheDocument()
    expect(screen.getByText('¥8,246,320')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'カード支払い' })).toBeInTheDocument()
  })

  it('identifies the non-persistent browser preview runtime', async () => {
    await renderApp()

    await waitFor(() => expect(screen.getByText('ブラウザプレビュー')).toBeInTheDocument())
    expect(screen.getByText('デスクトップ版で安全に保存')).toBeInTheDocument()
  })

  it('navigates to the import inbox', async () => {
    await renderApp()

    fireEvent.click(screen.getByRole('button', { name: /インポート/ }))

    expect(screen.getByRole('heading', { name: 'インポート Inbox' })).toBeInTheDocument()
    expect(screen.getByText('paypay_2026.csv')).toBeInTheDocument()
    expect(screen.getByText('反映可能')).toBeInTheDocument()
  })

  it('filters transactions without changing accounting totals', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '取引' }))

    const main = screen.getByRole('main')
    const search = within(main).getByPlaceholderText('店舗、カテゴリー、口座を検索')
    fireEvent.change(search, { target: { value: 'Netflix' } })

    expect(screen.getByText('Netflix.com')).toBeInTheDocument()
    expect(screen.queryByText('成城石井')).not.toBeInTheDocument()
    expect(screen.getByText('支出 ¥267,990')).toBeInTheDocument()
  })

  it('switches between accrual expense and cash movement without double counting card payments', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '取引' }))

    expect(screen.getByText('JR EAST')).toBeInTheDocument()
    expect(screen.queryByText('楽天カード支払い')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '資金移動' }))

    expect(screen.getByText('楽天カード支払い')).toBeInTheDocument()
    expect(screen.queryByText('JR EAST')).not.toBeInTheDocument()
    expect(screen.getByText('現金流出 ¥386,000')).toBeInTheDocument()
  })

  it('explains reconciled card payments separately from expenses', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'カード照合 1' }))

    expect(screen.getByRole('heading', { name: '請求・口座引落の照合' })).toBeInTheDocument()
    expect(screen.getByText(/カード利用は支出、銀行引落は負債の返済/)).toBeInTheDocument()
    expect(screen.getByText(/Rakuten Card ¥204,987 と MUFG/)).toBeInTheDocument()
  })

  it('keeps encrypted backup controls desktop-only in browser preview', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '設定' }))

    expect(screen.getByRole('heading', { name: '設定' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'バックアップを作成' })).toBeDisabled()
    expect(screen.getByText('デスクトップ版で利用できます。')).toBeInTheDocument()
  })
})
