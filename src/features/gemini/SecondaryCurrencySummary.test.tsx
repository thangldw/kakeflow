import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SecondaryCurrencySummary } from './GeminiFeatureSuite'

describe('SecondaryCurrencySummary', () => {
  it('states that the conversion uses a fixed reference rate and shows the rate in use', () => {
    render(<SecondaryCurrencySummary netWorth={1_580_000} income={158_000} expense={79_000} />)
    expect(screen.getByText(/参考レート（固定値・実勢とは異なります）/)).toHaveTextContent('1 USD = ¥158.0')
    expect(screen.getByText('$10,000.00')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'EUR' } })
    expect(screen.getByText(/参考レート/)).toHaveTextContent('1 EUR = ¥171.5')
  })
})
