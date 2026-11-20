import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FurusatoPanel } from './FurusatoPanel'

afterEach(cleanup)

describe('FurusatoPanel', () => {
  it('shows nothing until both figures are entered, then an estimate labelled as such', () => {
    render(<FurusatoPanel />)
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.change(screen.getByLabelText('課税所得（所得税）'), { target: { value: '3,000,000' } })
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.change(screen.getByLabelText('住民税の所得割額'), { target: { value: '200000' } })
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('上限額の目安')
    expect(status.textContent).toContain('¥52,')
    expect(status.textContent).toContain('目安であり、確定額ではありません。')
  })

  it('shows what can still be donated and ignores invalid input', () => {
    render(<FurusatoPanel />)
    fireEvent.change(screen.getByLabelText('課税所得（所得税）'), { target: { value: '3000000' } })
    fireEvent.change(screen.getByLabelText('住民税の所得割額'), { target: { value: '200000' } })
    fireEvent.change(screen.getByLabelText('今年すでに寄附した額（任意）'), { target: { value: '20000' } })
    expect(screen.getByRole('status').textContent).toContain('あと寄附できる目安')
    fireEvent.change(screen.getByLabelText('住民税の所得割額'), { target: { value: 'abc' } })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
