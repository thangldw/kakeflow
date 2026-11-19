import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlanningTools } from './GeminiFeatureSuite'

describe('PlanningTools yen fields', () => {
  it('shows readable thousands separators and recomputes from typed whole yen', () => {
    render(<PlanningTools />)
    const spend = screen.getByLabelText('現在の月間支出') as HTMLInputElement
    expect(spend.value).toBe('620,000')
    expect((screen.getByLabelText('現在の残高') as HTMLInputElement).value).toBe('1,200,000')
    fireEvent.focus(spend)
    fireEvent.change(spend, { target: { value: '500000' } })
    fireEvent.blur(spend)
    expect(spend.value).toBe('500,000')
    expect(screen.getByText(/¥450,000/)).toBeInTheDocument()
  })

  it('flags a fractional amount instead of silently using it', () => {
    render(<PlanningTools />)
    const payment = screen.getByLabelText('毎月返済額') as HTMLInputElement
    fireEvent.focus(payment)
    fireEvent.change(payment, { target: { value: '60000.5' } })
    expect(payment).toHaveAttribute('aria-invalid', 'true')
  })
})
