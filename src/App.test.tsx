import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('KakeFlow application shell', () => {
  it('renders the household overview with accounting KPIs', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'こんにちは、田中さん' })).toBeInTheDocument()
    expect(screen.getByText('純資産')).toBeInTheDocument()
    expect(screen.getByText('¥8,246,320')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'カード支払い' })).toBeInTheDocument()
  })

  it('navigates to the import inbox', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /インポート/ }))

    expect(screen.getByRole('heading', { name: 'インポート Inbox' })).toBeInTheDocument()
    expect(screen.getByText('paypay_2026.csv')).toBeInTheDocument()
    expect(screen.getByText('反映可能')).toBeInTheDocument()
  })

  it('filters transactions without changing accounting totals', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '取引' }))

    const main = screen.getByRole('main')
    const search = within(main).getByPlaceholderText('店舗、カテゴリー、口座を検索')
    fireEvent.change(search, { target: { value: 'Netflix' } })

    expect(screen.getByText('Netflix.com')).toBeInTheDocument()
    expect(screen.queryByText('成城石井')).not.toBeInTheDocument()
    expect(screen.getByText('支出 ¥268,890')).toBeInTheDocument()
  })

  it('explains reconciled card payments separately from expenses', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /カード照合/ }))

    expect(screen.getByRole('heading', { name: '請求・口座引落の照合' })).toBeInTheDocument()
    expect(screen.getByText(/カード利用は支出、銀行引落は負債の返済/)).toBeInTheDocument()
    expect(screen.getByText(/Rakuten Card ¥204,987 と MUFG/)).toBeInTheDocument()
  })
})
