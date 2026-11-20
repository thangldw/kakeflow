import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmergencySheetPanel } from './EmergencySheetPanel'

afterEach(cleanup)

describe('EmergencySheetPanel', () => {
  it('saves the sheet and shows the file name', async () => {
    const save = vi.fn(async () => 'kakeflow-emergency-sheet-2026-11-20.pdf')
    render(<EmergencySheetPanel save={save} available />)
    fireEvent.click(screen.getByRole('button', { name: '緊急時シートをPDFで保存' }))
    expect((await screen.findByRole('status')).textContent).toContain('kakeflow-emergency-sheet-2026-11-20.pdf')
  })

  it('stays quiet when the save dialog is cancelled', async () => {
    const save = vi.fn(async () => null)
    render(<EmergencySheetPanel save={save} available />)
    fireEvent.click(screen.getByRole('button', { name: '緊急時シートをPDFで保存' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows an error when saving fails and disables the button where unavailable', async () => {
    render(<EmergencySheetPanel save={async () => { throw new Error('x') }} available />)
    fireEvent.click(screen.getByRole('button', { name: '緊急時シートをPDFで保存' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    cleanup()
    render(<EmergencySheetPanel save={vi.fn()} available={false} />)
    expect((screen.getByRole('button', { name: '緊急時シートをPDFで保存' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
