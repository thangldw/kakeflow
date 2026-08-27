import 'fake-indexeddb/auto'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const argonMock = vi.hoisted(() => ({
  derive: vi.fn(async (passphrase: Uint8Array, salt: Uint8Array) => {
    const output = new Uint8Array(32)
    for (let index = 0; index < output.length; index += 1) {
      output[index] = passphrase[index % passphrase.length] ^ salt[index % salt.length] ^ index
    }
    return output
  }),
}))
const updateMock = vi.hoisted(() => ({
  updateAvailable: false,
  activating: false,
  activateUpdate: vi.fn(),
  dismissUpdate: vi.fn(),
}))

vi.mock('../platform/pwa/argonWorker', () => ({ deriveArgon2idInWorker: argonMock.derive }))
vi.mock('./serviceWorker', () => ({
  canActivatePwaUpdate: ({ vaultUnlocked, activeOperation }: { vaultUnlocked: boolean; activeOperation: boolean }) => !vaultUnlocked || !activeOperation,
  usePwaServiceWorker: () => ({ ...updateMock, offlineReady: true }),
}))

import { PwaLedgerClient } from '../platform/pwa/client'
import type { Household } from '../platform/pwa/types'
import type { PwaOcrDocument } from './PwaRoot'
import PwaRoot, { BackupScreen } from './PwaRoot'

const originalFetch = globalThis.fetch
const passphrase = 'correct horse battery staple'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

const recognizedReceipt: Awaited<ReturnType<PwaOcrDocument>> = {
  method: 'OCR',
  text: 'Sakura Test Market\n2026/08/24\nRice 1,200\nTOTAL ¥1,200',
  confidenceBps: 9_800,
  issues: [],
  pageCount: 1,
  pages: [{ pageNumber: 1, widthPixels: 800, heightPixels: 1200, confidenceBps: 9_800, issues: [] }],
  regions: [
    {
      pageNumber: 1,
      coordinateSpace: 'PIXELS',
      boundingBox: { left: 20, top: 30, width: 300, height: 40 },
      text: 'Sakura Test Market',
      confidenceBps: 9_900,
      provenance: 'PADDLEOCR_V5_LINE',
    },
    {
      pageNumber: 1,
      coordinateSpace: 'PIXELS',
      boundingBox: { left: 20, top: 100, width: 260, height: 40 },
      text: '2026/08/24',
      confidenceBps: 9_700,
      provenance: 'PADDLEOCR_V5_LINE',
    },
    {
      pageNumber: 1,
      coordinateSpace: 'PIXELS',
      boundingBox: { left: 420, top: 920, width: 300, height: 50 },
      text: 'TOTAL ¥1,200',
      confidenceBps: 9_800,
      provenance: 'PADDLEOCR_V5_LINE',
    },
  ],
}

async function createConfiguredVault(databaseName: string, ocrDocument: PwaOcrDocument) {
  render(<PwaRoot databaseName={databaseName} ocrDocument={ocrDocument} />)

  expect(screen.getByText('LOCAL')).toBeInTheDocument()
  expect(screen.getByText('LOCKED')).toBeInTheDocument()
  expect(screen.getByText('OFFLINE READY')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Vault passphrase'), { target: { value: passphrase } })
  fireEvent.change(screen.getByLabelText('Confirm passphrase'), { target: { value: passphrase } })
  fireEvent.click(screen.getByRole('button', { name: 'Create encrypted vault' }))

  await screen.findByRole('heading', { name: 'Set up your household' })
  fireEvent.change(screen.getByLabelText('Household name'), { target: { value: 'Home' } })
  fireEvent.change(screen.getByLabelText('Money account'), { target: { value: 'Cash' } })
  fireEvent.change(screen.getByLabelText('Expense account'), { target: { value: 'Food' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save local setup' }))
  await screen.findByRole('heading', { name: 'Household overview' })
}

describe('PWA receipt-to-provenance journey', () => {
  beforeEach(() => {
    updateMock.updateAvailable = false
    updateMock.activating = false
    updateMock.activateUpdate.mockReset()
    updateMock.dismissUpdate.mockReset()
  })

  beforeAll(() => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      if (String(input).endsWith('kakeflow_core_bg.wasm')) {
        const bytes = await readFile(resolve('src/platform/pwa/core-wasm/kakeflow_core_bg.wasm'))
        return new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } })
      }
      return originalFetch(input)
    })
  })

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('creates a vault, reviews source, explicitly approves, posts, and retains provenance', async () => {
    const ocrDocument = vi.fn<PwaOcrDocument>().mockResolvedValue(recognizedReceipt)
    await createConfiguredVault('pwa-ui-complete', ocrDocument)

    const navigation = screen.getByRole('navigation', { name: 'PWA workflow' })
    expect(within(navigation).getAllByRole('button')).toHaveLength(7)
    fireEvent.click(within(navigation).getByRole('button', { name: 'Import' }))

    const receipt = new File(['synthetic receipt bytes'], 'synthetic-receipt.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Receipt image'), { target: { files: [receipt] } })

    await screen.findByText('CANDIDATE')
    expect(ocrDocument).toHaveBeenCalledWith(expect.any(Uint8Array), 'image/png')
    expect(screen.getByRole('heading', { name: 'Compare source and candidate' })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'Original receipt synthetic-receipt.png' })).toBeInTheDocument()
    expect(screen.getAllByText('Sakura Test Market')).toHaveLength(2)
    expect(screen.getByText('TOTAL ¥1,200')).toBeInTheDocument()
    expect(screen.getAllByText('¥1,200').length).toBeGreaterThan(0)
    expect(screen.getByText('difference ¥0')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Debit account'), { target: { value: 'expense' } })
    fireEvent.change(screen.getByLabelText('Credit account'), { target: { value: 'asset' } })
    const approve = screen.getByRole('button', { name: 'Approve and post' })
    expect(approve).toBeDisabled()
    fireEvent.click(screen.getByLabelText('I compared the receipt and approve this posting'))
    expect(approve).toBeEnabled()
    fireEvent.click(approve)

    await screen.findByText('APPROVED')
    expect(screen.getByText('POSTED')).toBeInTheDocument()
    expect(screen.getByText('Debit ¥1,200')).toBeInTheDocument()
    expect(screen.getByText('Credit ¥1,200')).toBeInTheDocument()

    fireEvent.click(within(navigation).getByRole('button', { name: 'Ledger' }))
    expect(await screen.findByRole('heading', { name: 'Posted ledger' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View provenance' }))
    expect(await screen.findByRole('heading', { name: 'Transaction provenance' })).toBeInTheDocument()
    expect(screen.getByText('synthetic-receipt.png')).toBeInTheDocument()
    expect(screen.getByText(/SHA-256/u)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Lock vault' }))
    expect(await screen.findByText('LOCKED')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Vault passphrase'), { target: { value: passphrase } })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock vault' }))
    await screen.findByRole('heading', { name: 'Household overview' })
    fireEvent.click(screen.getByRole('button', { name: 'Ledger' }))
    expect(await screen.findByText('Sakura Test Market')).toBeInTheDocument()

    expect(screen.queryByText(/Money Forward|Gmail|Connect bank/u)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Tanaka')
  })

  it('renders English without overwriting the shared saved locale', () => {
    localStorage.setItem('kakeflow.locale', 'vi')

    render(<PwaRoot databaseName="pwa-ui-locale-boundary" />)

    expect(screen.getByRole('heading', { name: 'Own your financial record' })).toBeInTheDocument()
    expect(localStorage.getItem('kakeflow.locale')).toBe('vi')
  })

  it('shows only the local manual source and routes Configure to Import with live pending review count', async () => {
    await createConfiguredVault(
      'pwa-ui-manual-source',
      vi.fn<PwaOcrDocument>().mockResolvedValue(recognizedReceipt),
    )
    const navigation = screen.getByRole('navigation', { name: 'PWA workflow' })
    expect(within(navigation).getAllByRole('button')).toHaveLength(7)
    fireEvent.click(within(navigation).getByRole('button', { name: 'Sources' }))

    const source = await screen.findByRole('article', { name: 'Manual import' })
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Connector control center' })).toBeInTheDocument()
    expect(within(source).getByText('Manual')).toBeInTheDocument()
    expect(within(source).getByText('Pending review').closest('div')).toHaveTextContent('Pending review0 items')
    expect(within(source).getAllByRole('button')).toHaveLength(1)
    expect(within(source).queryByRole('button', { name: /Refresh|Retry|Disconnect|Schedule/u })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Google|Gmail|OAuth|Keychain|\/Users\/|Connect bank|bank account|account required/iu)

    fireEvent.click(within(source).getByRole('button', { name: 'Open settings' }))
    expect(await screen.findByRole('heading', { name: 'Import a receipt' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Receipt image'), {
      target: { files: [new File(['manual source receipt'], 'manual-source.png', { type: 'image/png' })] },
    })
    await screen.findByText('CANDIDATE')
    fireEvent.click(within(navigation).getByRole('button', { name: 'Sources' }))

    const updatedSource = await screen.findByRole('article', { name: 'Manual import' })
    expect(within(updatedSource).getByText('Pending review').closest('div')).toHaveTextContent('Pending review1 item')

    fireEvent.click(within(navigation).getByRole('button', { name: 'Review' }))
    fireEvent.click(screen.getByLabelText('I compared the receipt and approve this posting'))
    fireEvent.click(screen.getByRole('button', { name: 'Approve and post' }))
    await screen.findByText('APPROVED')
    fireEvent.click(within(navigation).getByRole('button', { name: 'Sources' }))
    expect(within(await screen.findByRole('article', { name: 'Manual import' })).getByText('Pending review').closest('div')).toHaveTextContent('Pending review0 items')
  })

  it('keeps a durably staged candidate in Review when its source summary cannot reload', async () => {
    await createConfiguredVault(
      'pwa-ui-stage-summary-failure',
      vi.fn<PwaOcrDocument>().mockResolvedValue(recognizedReceipt),
    )
    vi.spyOn(PwaLedgerClient.prototype, 'listConnectorSummaries')
      .mockRejectedValueOnce(new Error('projection unavailable'))

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    fireEvent.change(screen.getByLabelText('Receipt image'), {
      target: { files: [new File(['staged receipt'], 'staged.png', { type: 'image/png' })] },
    })

    expect(await screen.findByRole('heading', { name: 'Compare source and candidate' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Receipt staged, but source status could not be refreshed.')
    expect(screen.queryByText(/Local OCR failed/u)).not.toBeInTheDocument()
  })

  it('keeps a durably posted transaction visible when the vault summary cannot reload', async () => {
    await createConfiguredVault(
      'pwa-ui-post-summary-failure',
      vi.fn<PwaOcrDocument>().mockResolvedValue(recognizedReceipt),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    fireEvent.change(screen.getByLabelText('Receipt image'), {
      target: { files: [new File(['posted receipt'], 'posted.png', { type: 'image/png' })] },
    })
    await screen.findByText('CANDIDATE')
    vi.spyOn(PwaLedgerClient.prototype, 'listConnectorSummaries')
      .mockRejectedValueOnce(new Error('projection unavailable'))

    fireEvent.click(screen.getByLabelText('I compared the receipt and approve this posting'))
    fireEvent.click(screen.getByRole('button', { name: 'Approve and post' }))

    expect(await screen.findByText('APPROVED')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Transaction posted, but the refreshed vault status could not be loaded.')
  })

  it('does not repopulate a locked screen from a stale vault load', async () => {
    await createConfiguredVault(
      'pwa-ui-load-fence',
      vi.fn<PwaOcrDocument>().mockResolvedValue(recognizedReceipt),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    fireEvent.change(screen.getByLabelText('Receipt image'), {
      target: { files: [new File(['load fence'], 'load-fence.png', { type: 'image/png' })] },
    })
    await screen.findByText('CANDIDATE')

    const staleLoad = deferred<Household[]>()
    const currentLoad = deferred<Household[]>()
    const listHouseholds = vi.spyOn(PwaLedgerClient.prototype, 'listHouseholds')
      .mockReturnValueOnce(staleLoad.promise)
      .mockReturnValueOnce(currentLoad.promise)
    fireEvent.click(screen.getByLabelText('I compared the receipt and approve this posting'))
    fireEvent.click(screen.getByRole('button', { name: 'Approve and post' }))
    await waitFor(() => expect(listHouseholds).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Lock vault' }))
    await screen.findByRole('heading', { name: 'Unlock local vault' })
    await act(async () => {
      staleLoad.resolve([{ id: 'stale-household', name: 'Stale household', baseCurrency: 'JPY' }])
      await Promise.resolve()
    })

    fireEvent.change(screen.getByLabelText('Vault passphrase'), { target: { value: passphrase } })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock vault' }))
    await waitFor(() => expect(listHouseholds).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('heading', { name: 'Set up your household' })).toBeInTheDocument()
    expect(screen.queryByText('Stale household')).not.toBeInTheDocument()

    await act(async () => {
      currentLoad.resolve([{ id: 'household', name: 'Home', baseCurrency: 'JPY' }])
    })
    await screen.findByRole('heading', { name: 'Household overview' })
  })

  it('keeps incomplete OCR visible and prevents posting', async () => {
    const incomplete = {
      ...recognizedReceipt,
      text: 'Synthetic Corner Shop\nTOTAL unreadable',
      confidenceBps: 4_000,
      regions: [],
    }
    await createConfiguredVault(
      'pwa-ui-incomplete',
      vi.fn<PwaOcrDocument>().mockResolvedValue(incomplete),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    fireEvent.change(screen.getByLabelText('Receipt image'), {
      target: { files: [new File(['incomplete'], 'incomplete.png', { type: 'image/png' })] },
    })

    expect(await screen.findByText('Candidate needs more information')).toBeInTheDocument()
    expect(screen.getByText('Synthetic Corner Shop')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve and post' })).not.toBeInTheDocument()
  })

  it('defers an available update during an active receipt review and enables it when locked', async () => {
    updateMock.updateAvailable = true
    await createConfiguredVault(
      'pwa-ui-update-boundary',
      vi.fn<PwaOcrDocument>().mockResolvedValue(recognizedReceipt),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    fireEvent.change(screen.getByLabelText('Receipt image'), {
      target: { files: [new File(['synthetic'], 'update-review.png', { type: 'image/png' })] },
    })

    await screen.findByText('CANDIDATE')
    expect(screen.getByRole('button', { name: 'Apply update' })).toBeDisabled()
    expect(screen.getByText(/Finish or leave the active receipt review/u)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Lock vault' }))
    expect(screen.getByRole('button', { name: 'Apply update' })).toBeEnabled()
  })

  it('downloads an encrypted archive and restores it through the recovery screen', async () => {
    let downloaded: Blob | undefined
    const client = {
      exportVault: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4])),
    } as unknown as PwaLedgerClient
    const onRestore = vi.fn().mockResolvedValue(undefined)
    render(<BackupScreen client={client} busy={false} onRestore={onRestore} />)
    Object.defineProperties(URL, {
      createObjectURL: {
        configurable: true,
        value: vi.fn((blob: Blob) => {
          downloaded = blob
          return 'blob:kakeflow-archive'
        }),
      },
      revokeObjectURL: { configurable: true, value: vi.fn() },
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Download encrypted archive' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Encrypted archive downloaded')
    await waitFor(() => expect(downloaded).toBeDefined())
    expect(downloaded?.type).toBe('application/vnd.kakeflow.encrypted+zip')
    fireEvent.change(screen.getByLabelText('Encrypted archive file'), {
      target: {
        files: [new File([downloaded!], 'kakeflow-vault.kakeflow.zip', {
          type: 'application/vnd.kakeflow.encrypted+zip',
        })],
      },
    })
    fireEvent.change(screen.getByLabelText('Archive passphrase'), {
      target: { value: passphrase },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Validate and restore' }))

    await waitFor(() => expect(onRestore).toHaveBeenCalledOnce())
    expect([...onRestore.mock.calls[0][0]]).toEqual([1, 2, 3, 4])
    expect(onRestore.mock.calls[0][1]).toBe(passphrase)
  })
})
