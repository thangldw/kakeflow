import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { YenInput } from './YenInput'
import { formatYenText, parseYenText } from './yen'

describe('yen text', () => {
  it('accepts full-width digits, separators and yen marks, and rejects fractions and junk', () => {
    expect(parseYenText('1,200,000')).toBe(1_200_000)
    expect(parseYenText('１２００ 円')).toBe(1200)
    expect(parseYenText('¥5,000')).toBe(5000)
    expect(parseYenText('')).toBe(0)
    expect(parseYenText('12.5')).toBeNull()
    expect(parseYenText('abc')).toBeNull()
    expect(parseYenText('-100')).toBeNull()
    expect(parseYenText('-100', true)).toBe(-100)
    expect(parseYenText('9'.repeat(16))).toBeNull()
    expect(formatYenText(1200000)).toBe('1,200,000')
  })
})

function Harness({ initial, onChange }: { initial: number; onChange?: (value: number) => void }) {
  const [value, setValue] = useState(initial)
  return <>
    <label>残高<YenInput value={value} onChange={(next) => { setValue(next); onChange?.(next) }} /></label>
    <output>{value}</output>
    <button type="button" onClick={() => setValue(777)}>外部変更</button>
  </>
}

describe('YenInput', () => {
  it('shows separators at rest, raw digits while focused, and reports whole numbers', () => {
    const onChange = vi.fn()
    render(<Harness initial={1_200_000} onChange={onChange} />)
    const input = screen.getByLabelText('残高') as HTMLInputElement
    expect(input.value).toBe('1,200,000')
    fireEvent.focus(input)
    expect(input.value).toBe('1200000')
    fireEvent.change(input, { target: { value: '2500000' } })
    expect(onChange).toHaveBeenLastCalledWith(2_500_000)
    fireEvent.blur(input)
    expect(input.value).toBe('2,500,000')
  })

  it('flags invalid text without calling the parent and keeps what was typed', () => {
    const onChange = vi.fn()
    render(<Harness initial={100} onChange={onChange} />)
    const input = screen.getByLabelText('残高') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '12.5' } })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(input.value).toBe('12.5')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('follows an outside change while not focused', () => {
    render(<Harness initial={100} />)
    fireEvent.click(screen.getByRole('button', { name: '外部変更' }))
    expect((screen.getByLabelText('残高') as HTMLInputElement).value).toBe('777')
  })

  it('reports whether the typed text is valid when asked', () => {
    const onValidityChange = vi.fn()
    render(<label>金額<YenInput value={0} onChange={() => {}} onValidityChange={onValidityChange} /></label>)
    const field = screen.getByLabelText('金額')
    fireEvent.change(field, { target: { value: '12a' } })
    expect(onValidityChange).toHaveBeenLastCalledWith(false)
    fireEvent.change(field, { target: { value: '12' } })
    expect(onValidityChange).toHaveBeenLastCalledWith(true)
  })
})
