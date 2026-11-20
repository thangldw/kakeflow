import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackupIntegrityPanel } from './BackupIntegrityPanel'

afterEach(cleanup)
const row = (status: 'OK' | 'MISSING' | 'CHANGED' | 'UNREADABLE', name: string) => ({ path: `/b/${name}`, fileName: name, recordedAt: '2026-11-01T00:00:00.000Z', byteSize: 10, status })

describe('BackupIntegrityPanel', () => {
  it('lists each remembered file with its status', async () => {
    const check = vi.fn(async () => [row('OK', 'a.kb'), row('MISSING', 'b.kb'), row('CHANGED', 'c.kb'), row('UNREADABLE', 'd.kb')])
    render(<BackupIntegrityPanel check={check} available />)
    fireEvent.click(screen.getByRole('button', { name: '今すぐ点検' }))
    const list = await screen.findByRole('status')
    expect(list.textContent).toContain('a.kb — 変更なし')
    expect(list.textContent).toContain('b.kb — ファイルが見つかりません')
    expect(list.textContent).toContain('c.kb — 作成時から変わっています')
    expect(list.textContent).toContain('d.kb — 読み取れません')
  })

  it('explains when there is nothing to check, reports failure, and is disabled where unavailable', async () => {
    render(<BackupIntegrityPanel check={async () => []} available />)
    fireEvent.click(screen.getByRole('button', { name: '今すぐ点検' }))
    expect((await screen.findByRole('status')).textContent).toContain('まだありません')
    cleanup()
    render(<BackupIntegrityPanel check={async () => { throw new Error('x') }} available />)
    fireEvent.click(screen.getByRole('button', { name: '今すぐ点検' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    cleanup()
    render(<BackupIntegrityPanel check={vi.fn()} available={false} />)
    expect((screen.getByRole('button', { name: '今すぐ点検' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
