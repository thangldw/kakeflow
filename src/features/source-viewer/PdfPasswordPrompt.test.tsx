import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PdfPasswordPrompt } from './PdfPasswordPrompt'

describe('PDF password prompt', () => {
  it('submits once, clears the password immediately, and explains ephemeral use', async () => {
    let finish!: () => void
    const onSubmit = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    render(<PdfPasswordPrompt filename="statement.pdf" status="PASSWORD_REQUIRED" onSubmit={onSubmit} />)
    const input = screen.getByLabelText('PDFパスワード')
    fireEvent.change(input, { target: { value: 'one-time-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'ロックを解除' }))

    expect(onSubmit).toHaveBeenCalledWith('one-time-password')
    expect(input).toHaveValue('')
    expect(screen.getByText(/保存しません/)).toBeInTheDocument()
    finish()
    await waitFor(() => expect(screen.getByRole('button', { name: 'ロックを解除' })).toBeDisabled())
  })

  it('shows actionable guidance for unsupported encryption without a password field', () => {
    render(<PdfPasswordPrompt status="PASSWORD_UNSUPPORTED" onSubmit={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('パスワード保護を解除したコピー')
    expect(screen.queryByLabelText('PDFパスワード')).not.toBeInTheDocument()
  })
})
