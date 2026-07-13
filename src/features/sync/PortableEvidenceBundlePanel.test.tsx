import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const exportEvidenceBundle = vi.fn()
const pickAndImportEvidenceBundle = vi.fn()

vi.mock('../../platform', () => ({
  platformClient: {
    runtime: 'tauri',
    exportEvidenceBundle: (...args: unknown[]) => exportEvidenceBundle(...args),
    pickAndImportEvidenceBundle: (...args: unknown[]) => pickAndImportEvidenceBundle(...args),
  },
}))

import { PortableEvidenceBundlePanel } from './PortableEvidenceBundlePanel'

const summary = {
  bundleId: 'bundle-1', householdId: 'family', originInstallationId: 'installation-1',
  documentCount: 3, recordCount: 48, plaintextBytes: 2 * 1024 * 1024,
  importedDocumentCount: 1, deduplicatedDocumentCount: 2,
}

describe('PortableEvidenceBundlePanel', () => {
  beforeEach(() => {
    exportEvidenceBundle.mockReset().mockResolvedValue(summary)
    pickAndImportEvidenceBundle.mockReset().mockResolvedValue(summary)
  })

  it('explains the confirmed-only append-only scope and exports with a passphrase', async () => {
    render(<PortableEvidenceBundlePanel householdId="family" />)
    expect(screen.getByText(/元のCSV・PDF・画像/)).toBeInTheDocument()
    expect(screen.getByText(/Import Inbox の未確定・要確認データは含みません/)).toBeInTheDocument()
    expect(screen.getByText(/読み込みは追加のみ/)).toBeInTheDocument()
    expect(screen.getByText(/先に読み込んでから変更パッケージ/)).toBeInTheDocument()
    expect(screen.getByText('手順 1 / 2')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('パスフレーズ'), { target: { value: 'twelve-chars-passphrase' } })
    fireEvent.click(screen.getByRole('button', { name: '確定済み原本を保存' }))

    await waitFor(() => expect(exportEvidenceBundle).toHaveBeenCalledWith('family', 'twelve-chars-passphrase'))
    expect(await screen.findByText('確定済み原本カプセルを保存しました。')).toBeInTheDocument()
    expect(screen.getByText('48件')).toBeInTheDocument()
    expect(screen.getByText('2.0 MB')).toBeInTheDocument()
  })

  it('imports idempotently and reports reused originals', async () => {
    render(<PortableEvidenceBundlePanel householdId="family" />)
    fireEvent.change(screen.getByLabelText('パスフレーズ'), { target: { value: 'twelve-chars-passphrase' } })
    fireEvent.click(screen.getByRole('button', { name: '原本カプセルを読み込む' }))

    await waitFor(() => expect(pickAndImportEvidenceBundle).toHaveBeenCalledWith('family', 'twelve-chars-passphrase'))
    expect(await screen.findByText(/原本を1件追加しました/)).toBeInTheDocument()
    expect(screen.getByText('既存を再利用')).toBeInTheDocument()
    expect(screen.getByText('2件')).toBeInTheDocument()
  })

  it('rejects short passphrases before invoking the desktop service', () => {
    render(<PortableEvidenceBundlePanel householdId="family" />)
    fireEvent.change(screen.getByLabelText('パスフレーズ'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: '確定済み原本を保存' }))
    expect(screen.getByRole('status')).toHaveTextContent('12文字以上')
    expect(exportEvidenceBundle).not.toHaveBeenCalled()
  })

  it('drops a completed picker response after the household changes', async () => {
    let complete: (value: typeof summary) => void = () => undefined
    pickAndImportEvidenceBundle.mockReturnValue(new Promise((resolve) => { complete = resolve }))
    const view = render(<PortableEvidenceBundlePanel householdId="family" />)
    fireEvent.change(screen.getByLabelText('パスフレーズ'), { target: { value: 'twelve-chars-passphrase' } })
    fireEvent.click(screen.getByRole('button', { name: '原本カプセルを読み込む' }))
    view.rerender(<PortableEvidenceBundlePanel householdId="other" />)
    complete(summary)
    await waitFor(() => expect(screen.getByLabelText('パスフレーズ')).toHaveValue(''))
    expect(screen.queryByText('既存を再利用')).not.toBeInTheDocument()
  })
})
