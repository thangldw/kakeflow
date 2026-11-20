import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MedicalCapPanel } from './MedicalCapPanel'

afterEach(cleanup)

describe('MedicalCapPanel', () => {
  it('shows nothing until an amount is typed, then the cap and refund as an estimate', () => {
    render(<MedicalCapPanel />)
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.change(screen.getByLabelText('その月に払った自己負担額'), { target: { value: '300,000' } })
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('¥87,430')
    expect(status.textContent).toContain('¥212,570')
    expect(status.textContent).toContain('確定額ではありません')
  })
  it('follows the income band and the repeat checkbox', () => {
    render(<MedicalCapPanel />)
    fireEvent.change(screen.getByLabelText('その月に払った自己負担額'), { target: { value: '100000' } })
    fireEvent.change(screen.getByLabelText('所得区分'), { target: { value: 'LOW' } })
    expect(screen.getByRole('status').textContent).toContain('¥57,600')
    fireEvent.click(screen.getByLabelText('過去12か月で3回以上、上限に達している'))
    expect(screen.getByRole('status').textContent).toContain('¥44,400')
  })
})
