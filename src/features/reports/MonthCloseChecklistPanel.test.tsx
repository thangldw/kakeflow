import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MonthCloseChecklistPanel } from './MonthCloseChecklistPanel'

afterEach(cleanup)

const quality = { totalImports: 5, postedImports: 3, reviewRequiredImports: 2, failedImports: 0, inProgressImports: 0, importCompletionBps: 6000, latestImportedAt: '2026-11-18', staleDays: 1, hasUnresolvedImports: true }
const budget = { budgetJpy: 200000, actualJpy: 150000, remainingJpy: 50000, utilizationBps: 7500, categoryCount: 6, overBudgetCount: 0 }

describe('MonthCloseChecklistPanel', () => {
  it('shows progress and an Open action for outstanding items that routes to the right page', () => {
    const onOpen = vi.fn()
    render(<MonthCloseChecklistPanel calendar={{ dataQuality: quality, budget }} onOpen={onOpen} />)
    expect(screen.getByText('5 / 6')).toBeTruthy()
    expect(screen.getByText('確認待ちの取り込みがあります: 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '開く' }))
    expect(onOpen).toHaveBeenCalledWith('import')
  })

  it('says everything is done when nothing is outstanding', () => {
    render(<MonthCloseChecklistPanel calendar={{ dataQuality: { ...quality, reviewRequiredImports: 0, hasUnresolvedImports: false }, budget }} />)
    expect(screen.getByText('すべて完了しています。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '開く' })).toBeNull()
  })
})
