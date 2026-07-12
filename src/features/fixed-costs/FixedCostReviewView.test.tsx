import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FixedCostReviewView } from './FixedCostReviewView'
import { fixedCostReviewFixture } from './testFixture'
import type { FixedCostReviewDto } from './platform'

describe('FixedCostReviewView', () => {
  it('shows the six-month comparison, limitations and transaction drill-down', () => {
    const open = vi.fn()
    render(<FixedCostReviewView data={fixedCostReviewFixture as FixedCostReviewDto} onOpenTransactions={open} />)
    expect(screen.getByText('直近3か月平均')).toBeInTheDocument()
    expect(screen.getAllByText('+¥3,000 (+30.0%)')).toHaveLength(2)
    expect(screen.getByText('¥156,000')).toBeInTheDocument()
    expect(screen.getByText(/現在の未完了月は除外/)).toBeInTheDocument()
    expect(screen.getByText(/市場相場に基づく節約可能額は算出していません/)).toBeInTheDocument()
    expect(screen.getAllByText(/Mobile Co/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /Mobile Co/ }))
    expect(open).toHaveBeenCalledOnce()
  })
})
