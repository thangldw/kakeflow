import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

import { I18nProvider } from '../i18n'
import { readUiMode, writeUiMode } from '../features/simple/uiMode'
import { PwaLedgerClient } from '../platform/pwa/client'
import type { Household } from '../platform/pwa/types'
import type { PwaOcrDocument } from './PwaRoot'
import PwaRoot, { BackupScreen } from './PwaRoot'

const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')
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
  // A new vault starts in Simple mode; the receipt journeys below run on the classic screens, reached from More.
  fireEvent.click(await screen.findByRole('button', { name: 'More' }))
  fireEvent.click(screen.getByRole('button', { name: 'Full' }))
  await screen.findByRole('heading', { name: 'Household overview' })
}

describe('PWA receipt-to-provenance journey', () => {
  beforeEach(() => {
    let queue = Promise.resolve()
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: (_name: string, callback: () => unknown) => {
        const result = queue.then(callback)
        queue = result.then(() => undefined, () => undefined)
        return result
      },
    } })
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
    if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks)
    else Reflect.deleteProperty(navigator, 'locks')
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
    expect(within(source).getByText('Review scope').closest('div')).toHaveTextContent('Review scopeNot configured')
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

  it('merges two stale tab snapshots and syncs entries without switching active vaults', async () => {
    const base = 'pwa-ui-two-tabs'
    localStorage.setItem(`kakeflow.pwa.vault.${base}`, '1')
    const first = render(<PwaRoot databaseName={base} />)
    const second = render(<PwaRoot databaseName={base} />)
    fireEvent.click(within(first.container).getByRole('button', { name: 'Create new vault' }))
    fireEvent.click(within(second.container).getByRole('button', { name: 'Create new vault' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(`kakeflow.pwa.directory.${base}`)!).vaults).toHaveLength(3))
    const firstSelection = within(first.container).getByLabelText('Local vault') as HTMLSelectElement
    const secondSelection = within(second.container).getByLabelText('Local vault') as HTMLSelectElement
    const firstId = firstSelection.value
    const secondId = secondSelection.value
    expect(firstId).not.toBe(secondId)
    fireEvent(window, new StorageEvent('storage', { key: `kakeflow.pwa.directory.${base}`, storageArea: localStorage }))
    await waitFor(() => expect(firstSelection.options).toHaveLength(3))
    expect(secondSelection.options).toHaveLength(3)
    expect(firstSelection.value).toBe(firstId)
    expect(secondSelection.value).toBe(secondId)
    expect(JSON.parse(localStorage.getItem(`kakeflow.pwa.directory.${base}`)!).vaults.map((v: {id: string}) => v.id)).toEqual(expect.arrayContaining([base, firstId, secondId]))
  })

  it('keeps the original vault selected when cross-tab locking is unavailable', async () => {
    const base = 'pwa-ui-no-locks'
    localStorage.setItem(`kakeflow.pwa.vault.${base}`, '1')
    Reflect.deleteProperty(navigator, 'locks')
    render(<PwaRoot databaseName={base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create new vault' }))
    await screen.findByText(/cannot safely coordinate vault changes/)
    expect(screen.getByRole('heading', { name: 'Unlock local vault' })).toBeInTheDocument()
    expect(localStorage.getItem(`kakeflow.pwa.directory.${base}`)).toBeNull()
  })

  it('creates a separate vault and can unlock the preserved original vault', async () => {
    await createConfiguredVault('pwa-ui-new-vault', vi.fn<PwaOcrDocument>().mockResolvedValue(recognizedReceipt))
    fireEvent.click(screen.getByRole('button', { name: 'Lock vault' }))
    fireEvent.change(screen.getByLabelText('Vault passphrase'), { target: { value: 'forgotten attempt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create new vault' }))
    await screen.findByRole('heading', { name: 'Own your financial record' })
    expect(screen.getByLabelText('Vault passphrase')).toHaveValue('')
    const newPassphrase = 'a different vault passphrase'
    fireEvent.change(screen.getByLabelText('Vault passphrase'), { target: { value: newPassphrase } })
    fireEvent.change(screen.getByLabelText('Confirm passphrase'), { target: { value: newPassphrase } })
    fireEvent.click(screen.getByRole('button', { name: 'Create encrypted vault' }))
    await screen.findByRole('heading', { name: 'Set up your household' })
    fireEvent.click(screen.getByRole('button', { name: 'Lock vault' }))
    fireEvent.change(screen.getByLabelText('Local vault'), { target: { value: 'pwa-ui-new-vault' } })
    await waitFor(() => expect(screen.getByLabelText('Local vault')).toHaveValue('pwa-ui-new-vault'))
    fireEvent.change(screen.getByLabelText('Vault passphrase'), { target: { value: passphrase } })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock vault' }))
    await screen.findByRole('heading', { name: 'Household overview' })
    expect(screen.getByText('Home · JPY')).toBeInTheDocument()
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

describe('PWA Simple mode and language', () => {
  const originalLanguage = Object.getOwnPropertyDescriptor(navigator, 'language')

  beforeEach(() => {
    let queue = Promise.resolve()
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: (_name: string, callback: () => unknown) => {
        const result = queue.then(callback)
        queue = result.then(() => undefined, () => undefined)
        return result
      },
    } })
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
    cleanup()
    if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks)
    else Reflect.deleteProperty(navigator, 'locks')
    if (originalLanguage) Object.defineProperty(navigator, 'language', originalLanguage)
    else Reflect.deleteProperty(navigator, 'language')
    localStorage.clear()
    vi.restoreAllMocks()
    // The active locale is module state; render once in Japanese so later files start from the default.
    render(<I18nProvider>{null}</I18nProvider>)
    cleanup()
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  function browserLanguage(language: string) {
    Object.defineProperty(navigator, 'language', { configurable: true, get: () => language })
  }

  async function createVault(databaseName: string) {
    render(<PwaRoot databaseName={databaseName} ocrDocument={vi.fn<PwaOcrDocument>().mockResolvedValue(recognizedReceipt)} />)
    fireEvent.change(screen.getByLabelText('Vault passphrase'), { target: { value: passphrase } })
    fireEvent.change(screen.getByLabelText('Confirm passphrase'), { target: { value: passphrase } })
    fireEvent.click(screen.getByRole('button', { name: 'Create encrypted vault' }))
  }

  async function setUpHousehold(labels = { title: 'Set up your household', household: 'Household name', money: 'Money account', expense: 'Expense account', save: 'Save local setup' }) {
    await screen.findByRole('heading', { name: labels.title })
    fireEvent.change(screen.getByLabelText(labels.household), { target: { value: 'Home' } })
    fireEvent.change(screen.getByLabelText(labels.money), { target: { value: 'Cash' } })
    fireEvent.change(screen.getByLabelText(labels.expense), { target: { value: 'Food' } })
    fireEvent.click(screen.getByRole('button', { name: labels.save }))
  }

  function unlock() {
    fireEvent.change(screen.getByLabelText('Vault passphrase'), { target: { value: passphrase } })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock vault' }))
  }

  it('starts a new vault in Simple mode with the default chart', async () => {
    browserLanguage('en-US')
    const database = 'pwa-simple-new-vault'
    await createVault(database)
    await setUpHousehold()

    const tabs = await screen.findByRole('navigation', { name: 'Main pages' })
    expect(screen.queryByRole('navigation', { name: 'PWA workflow' })).not.toBeInTheDocument()
    expect(readUiMode(`${database}:household`)).toBe('simple')
    expect(await screen.findByRole('button', { name: 'Set a monthly limit' })).toBeInTheDocument()

    fireEvent.click(within(tabs).getByRole('button', { name: 'Budget' }))
    for (const name of ['Food', 'Groceries', 'Utilities', 'Transport', 'Entertainment', 'Other']) {
      expect(await screen.findByRole('form', { name })).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('button', { name: '+ Add spending' }))
    const sheet = await screen.findByRole('dialog', { name: 'Add spending' })
    // The setup form's "Cash" stands in for the starter cash account, so it is not listed twice.
    fireEvent.click(within(sheet).getByRole('button', { name: /^Paid with/u }))
    expect(within(sheet).getAllByRole('option').map((option) => option.textContent)).toEqual(['Cash', 'Credit card'])
  })

  it('keeps the classic screens for an existing vault with no stored mode, and switches to Simple and back', async () => {
    browserLanguage('en-US')
    const database = 'pwa-simple-existing-vault'
    await createVault(database)
    await setUpHousehold()
    await screen.findByRole('navigation', { name: 'Main pages' })
    // A vault set up before Simple mode existed has no stored mode.
    writeUiMode(`${database}:household`, 'full')
    fireEvent.click(screen.getByRole('button', { name: 'Lock vault' }))
    unlock()
    expect(await screen.findByRole('heading', { name: 'Household overview' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main pages' })).not.toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('group', { name: 'Display mode' })).getByRole('button', { name: 'Simple' }))
    const tabs = await screen.findByRole('navigation', { name: 'Main pages' })
    expect(readUiMode(`${database}:household`)).toBe('simple')

    // More opens the classic pages, and Back to Simple returns.
    fireEvent.click(within(tabs).getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('button', { name: 'Import a receipt' }))
    expect(await screen.findByRole('heading', { name: 'Import a receipt' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'PWA workflow' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Simple' }))
    expect(await screen.findByRole('navigation', { name: 'Main pages' })).toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main pages' })).getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('button', { name: 'Full' }))
    expect(await screen.findByRole('heading', { name: 'Household overview' })).toBeInTheDocument()
    expect(readUiMode(`${database}:household`)).toBe('full')
  })

  it('keeps each vault on the device in its own mode', async () => {
    browserLanguage('en-US')
    // Vault A is classic (no stored mode).
    await createVault('pwa-simple-vault-a')
    await setUpHousehold()
    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Main pages' })).getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('button', { name: 'Full' }))
    await screen.findByRole('heading', { name: 'Household overview' })
    expect(localStorage.getItem('kakeflow.uiMode')).toBeNull()
    cleanup()

    // Vault B is new, so it starts in Simple.
    await createVault('pwa-simple-vault-b')
    await setUpHousehold()
    await screen.findByRole('navigation', { name: 'Main pages' })
    expect(readUiMode('pwa-simple-vault-b:household')).toBe('simple')
    cleanup()

    render(<PwaRoot databaseName="pwa-simple-vault-a" />)
    unlock()
    expect(await screen.findByRole('heading', { name: 'Household overview' })).toBeInTheDocument()
    expect(readUiMode('pwa-simple-vault-a:household')).toBe('full')
  })

  it('clears a starter-account alert once the user moves on in Simple', async () => {
    browserLanguage('en-US')
    const createAccount = PwaLedgerClient.prototype.createAccount
    vi.spyOn(PwaLedgerClient.prototype, 'createAccount').mockImplementation(function (this: PwaLedgerClient, input) {
      return input.id === 'liability-card' ? Promise.reject(new Error('disk full')) : createAccount.call(this, input)
    })
    await createVault('pwa-simple-setup-alert')
    await setUpHousehold()
    const tabs = await screen.findByRole('navigation', { name: 'Main pages' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not add the starter accounts')
    fireEvent.click(within(tabs).getByRole('button', { name: 'Budget' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('picks Vietnamese from navigator.language and names the default chart in it', async () => {
    browserLanguage('vi-VN')
    await createVault('pwa-simple-vietnamese')
    await setUpHousehold({ title: 'Thiết lập hộ gia đình', household: 'Tên hộ gia đình', money: 'Tài khoản tiền', expense: 'Tài khoản chi tiêu', save: 'Lưu thiết lập cục bộ' })
    const tabs = await screen.findByRole('navigation', { name: 'Trang chính' })
    expect(within(tabs).getByRole('button', { name: 'Hôm nay' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(within(tabs).getByRole('button', { name: 'Ngân sách' }))
    expect(await screen.findByRole('form', { name: 'Thực phẩm' })).toBeInTheDocument()
    // Detection does not store a choice.
    expect(localStorage.getItem('kakeflow.locale')).toBeNull()
  })

  it('remembers the language chosen on the setup screen', async () => {
    browserLanguage('en-US')
    await createVault('pwa-simple-language-switch')
    await screen.findByRole('heading', { name: 'Set up your household' })
    fireEvent.click(within(screen.getByRole('group', { name: 'Language' })).getByRole('button', { name: 'Tiếng Việt' }))
    expect(await screen.findByRole('heading', { name: 'Thiết lập hộ gia đình' })).toBeInTheDocument()
    expect(localStorage.getItem('kakeflow.locale')).toBe('vi')

    cleanup()
    render(<PwaRoot databaseName="pwa-simple-language-switch" />)
    unlock()
    expect(await screen.findByRole('heading', { name: 'Thiết lập hộ gia đình' })).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Ngôn ngữ' })).getByRole('button', { name: 'Tiếng Việt' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows the vault status pills and Lock vault in Vietnamese', async () => {
    browserLanguage('vi-VN')
    await createVault('pwa-simple-vietnamese-chrome')
    expect(screen.getByText('ĐÃ KHÓA')).toBeInTheDocument()
    await setUpHousehold({ title: 'Thiết lập hộ gia đình', household: 'Tên hộ gia đình', money: 'Tài khoản tiền', expense: 'Tài khoản chi tiêu', save: 'Lưu thiết lập cục bộ' })
    await screen.findByRole('navigation', { name: 'Trang chính' })
    expect([...screen.getByLabelText('Trạng thái kho dữ liệu').children].map((pill) => pill.textContent)).toEqual(['CỤC BỘ', 'ĐÃ MỞ KHÓA', 'DÙNG NGOẠI TUYẾN'])
    fireEvent.click(screen.getByRole('button', { name: 'Khóa kho dữ liệu' }))
    expect(await screen.findByText('ĐÃ KHÓA')).toBeInTheDocument()
    expect(screen.queryByText('LOCKED')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lock vault' })).not.toBeInTheDocument()
  })

  it('keeps the English vault status pills and Lock vault text', async () => {
    browserLanguage('en-US')
    await createVault('pwa-simple-english-chrome')
    await setUpHousehold()
    await screen.findByRole('navigation', { name: 'Main pages' })
    expect([...screen.getByLabelText('Runtime state').children].map((pill) => pill.textContent)).toEqual(['LOCAL', 'UNLOCKED', 'OFFLINE READY'])
    expect(screen.getByRole('button', { name: 'Lock vault' })).toBeInTheDocument()
  })
})
