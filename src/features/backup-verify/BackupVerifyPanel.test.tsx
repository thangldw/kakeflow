import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BackupVerificationDto } from '../../platform/types'
import { BackupVerifyPanel } from './BackupVerifyPanel'

afterEach(cleanup)

const good: BackupVerificationDto = { entryCount: 7, plaintextBytes: 2_097_152, schemaVersion: 74, householdCount: 1, documentsChecked: 5, postedTransactions: 120, journalEntries: 260, ledgerFindings: 0, ok: true }
const type = (value: string) => fireEvent.change(screen.getByLabelText('バックアップ作成時のパスフレーズ'), { target: { value } })
const run = () => fireEvent.click(screen.getByRole('button', { name: 'バックアップを選んで検証' }))

describe('BackupVerifyPanel', () => {
  it('rejects a short passphrase without opening the file picker', () => {
    const verify = vi.fn(async () => good)
    render(<BackupVerifyPanel verify={verify} available />)
    type('short'); run()
    expect(verify).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('reports a restorable backup with its counts and clears the passphrase', async () => {
    const verify = vi.fn(async () => good)
    render(<BackupVerifyPanel verify={verify} available />)
    type('correct horse battery'); run()
    expect(await screen.findByText('このバックアップは復元できます。')).toBeTruthy()
    expect(verify).toHaveBeenCalledWith('correct horse battery')
    expect(screen.getByText(/120 取引/)).toBeTruthy()
    expect((screen.getByLabelText('バックアップ作成時のパスフレーズ') as HTMLInputElement).value).toBe('')
  })

  it('warns when the backup restores but the books have findings', async () => {
    render(<BackupVerifyPanel verify={async () => ({ ...good, ledgerFindings: 2, ok: false })} available />)
    type('correct horse battery'); run()
    expect(await screen.findByText('復元はできますが、帳簿に確認が必要な取引があります。')).toBeTruthy()
  })

  it('stays quiet when the file picker is cancelled and shows an error on failure', async () => {
    const verify = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('x'))
    render(<BackupVerifyPanel verify={verify} available />)
    type('correct horse battery'); run()
    await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(1))
    await screen.findByRole('button', { name: 'バックアップを選んで検証' })
    expect(screen.queryByRole('alert')).toBeNull()
    run()
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('is disabled where the native picker is unavailable', () => {
    render(<BackupVerifyPanel verify={async () => good} available={false} />)
    expect((screen.getByRole('button', { name: 'バックアップを選んで検証' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
