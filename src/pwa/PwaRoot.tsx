import { useCallback, useEffect, useRef, useState } from 'react'

import {
  ManualConnectorControlCenter,
  type ManualConnectorControlCopy,
} from '../features/connectors/ManualConnectorControlCenter'
import type { ExtractedDocumentDto } from '../platform'
import type { ConnectorSummaryDto } from '../platform/types'
import { parseReceiptText, type ReceiptTextFields } from '../features/import/receiptText'
import { UiModeSwitch } from '../features/simple/SimpleMorePage'
import { readUiMode, writeUiMode, type UiMode } from '../features/simple/uiMode'
import { I18nProvider, localize, useI18n, type AppLocale } from '../i18n'
import { PwaLedgerClient } from '../platform/pwa/client'
import { browserPasskeyAuthenticator, passkeyAvailable, type PasskeyAuthenticator } from '../platform/pwa/passkey'
import type {
  Account,
  DashboardSummary,
  Household,
  ReceiptCandidate,
  ReceiptFieldProvenance,
  SourceEvidence,
  Transaction,
  TransactionDetail,
} from '../platform/pwa/types'
import { addDefaultChart } from './defaultChart'
import { formatJpy } from './formatJpy'
import { LanguageSwitch } from './LanguageSwitch'
import { PostedLedgerList } from './PostedLedgerList'
import { canActivatePwaUpdate, usePwaServiceWorker } from './serviceWorker'
import { SimpleShell, type PwaPage } from './SimpleShell'
import { isPwaClientOperationSuperseded, usePwaClient } from './usePwaClient'
import '../features/simple/simpleMode.css'
import './simple-tokens.css'
import './pwa.css'

export type PwaOcrDocument = (
  fileBytes: Uint8Array,
  mediaType: string,
) => Promise<ExtractedDocumentDto>

interface PwaRootProps {
  readonly databaseName?: string
  readonly ocrDocument?: PwaOcrDocument
  /** The WebAuthn adapter for the passkey unlock; tests inject a fake, the app uses the browser one. */
  readonly passkeyAuthenticator?: PasskeyAuthenticator
}

type Screen = 'overview' | 'sources' | 'import' | 'review' | 'ledger' | 'evidence' | 'backup'

interface ReceiptDraft {
  readonly filename: string
  readonly mediaType: string
  readonly bytes: Uint8Array
  readonly extracted: ExtractedDocumentDto
  readonly fields: ReceiptTextFields
  readonly candidate: ReceiptCandidate | null
}

const navigation: readonly { id: Screen; label: string; step: string }[] = [
  { id: 'overview', label: 'Overview', step: '01' },
  { id: 'sources', label: 'Sources', step: '02' },
  { id: 'import', label: 'Import', step: '03' },
  { id: 'review', label: 'Review', step: '04' },
  { id: 'ledger', label: 'Ledger', step: '05' },
  { id: 'evidence', label: 'Evidence', step: '06' },
  { id: 'backup', label: 'Backup', step: '07' },
]

const pwaDateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short' })

const pwaConnectorCopy: ManualConnectorControlCopy = {
  frame: {
    title: 'Connector control center',
    description: 'Review the local source and pending items in one place.',
    reviewNote: 'Imports create review candidates. Nothing is posted automatically.',
    connected: 'Connected',
    stale: 'Stale',
    running: 'Running',
    needsAction: 'Needs action',
  },
  manualState: 'Manual',
  configure: 'Open settings',
  lastSuccessLabel: 'Last successful refresh',
  noLastSuccess: 'No successful refresh yet',
  nextDueLabel: 'Next scheduled refresh',
  noNextDue: 'Not scheduled',
  pendingReviewLabel: 'Pending review',
  pendingReview: (count) => `${count.toLocaleString('en-US')} ${count === 1 ? 'item' : 'items'}`,
  bindingLabel: 'Review scope',
  unboundBinding: 'Not configured',
  bindingSummary: (count, parserConfigured, version) => `${count.toLocaleString('en-US')} accounts · ${parserConfigured ? 'parser profile set' : 'no parser profile'} · revision ${version.toLocaleString('en-US')}`,
  formatDate: (value) => pwaDateFormatter.format(new Date(value)),
}

const defaultOcrDocument: PwaOcrDocument = async (bytes, mediaType) => {
  const { paddleOcrDocument } = await import('../features/import/paddleOcr')
  return paddleOcrDocument(bytes, mediaType)
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}

function randomId(prefix: string) {
  const token = globalThis.crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${token}`
}

/**
 * The Simple/Full entry of one vault's household. Every PWA vault's household id is `household`, so the entry is
 * prefixed with the vault's database name: vaults on one device keep their own mode.
 */
/** The `lang` value for a locale, as I18nProvider sets it on the root element. */
function htmlLang(locale: string) {
  return locale === 'ja' ? 'ja' : locale === 'vi' ? 'vi' : 'en'
}

function uiModeKey(databaseName: string, householdId: string) {
  return `${databaseName}:${householdId}`
}

/** The language a first run starts in: the browser's when it is Vietnamese or Japanese, English otherwise. */
function browserLocale(): AppLocale {
  const language = (globalThis.navigator?.language ?? '').toLowerCase()
  return language.startsWith('vi') ? 'vi' : language.startsWith('ja') ? 'ja' : 'en'
}

async function readFileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer())
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(new Uint8Array(reader.result as ArrayBuffer)))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Could not read receipt')))
    reader.readAsArrayBuffer(file)
  })
}

function receiptProvenance(
  extracted: ExtractedDocumentDto,
  fields: ReceiptTextFields,
): ReceiptFieldProvenance[] {
  const matches = [
    { field: 'payee', match: fields.merchant },
    { field: 'occurredOn', match: fields.occurredOn?.replaceAll('-', '/') ?? null },
    { field: 'amountJpy', match: fields.amountJpy === null ? null : String(fields.amountJpy) },
  ]
  return matches.flatMap(({ field, match }) => {
    const normalizedMatch = match?.replaceAll(',', '')
    const region = extracted.regions?.find((item) => (
      normalizedMatch && item.text.replaceAll(',', '').includes(normalizedMatch)
    ))
    if (!region) return []
    const box = region.boundingBox
    return [{
      field,
      page: region.pageNumber,
      region: box
        ? [box.left, box.top, box.width, box.height] as const
        : [0, 0, 0, 0] as const,
    }]
  })
}

interface VaultEntry { id: string; name: string }
interface VaultDirectory { active: string; vaults: VaultEntry[] }

export default function PwaRoot(props: PwaRootProps) {
  const base = props.databaseName ?? 'kakeflow-pwa-v1'
  const registryKey = `kakeflow.pwa.directory.${base}`
  function readDirectory(): VaultDirectory {
    const original = { id: base, name: 'Original vault' }
    try {
      const saved = JSON.parse(localStorage.getItem(registryKey) ?? 'null') as VaultDirectory | null
      if (saved && Array.isArray(saved.vaults)) {
        const vaults = [original, ...saved.vaults.filter(v =>
          typeof v?.id === 'string' && v.id.startsWith(`${base}-vault-`) && typeof v.name === 'string')]
        if (vaults.some(v => v.id === saved.active)) return { active: saved.active, vaults }
      }
    } catch { /* A missing or invalid directory must not hide the original vault. */ }
    return { active: base, vaults: [original] }
  }
  const [directory, setDirectory] = useState<VaultDirectory>(readDirectory)
  const [directoryError, setDirectoryError] = useState('')
  useEffect(() => {
    function syncDirectory(event: StorageEvent) {
      if (event.key !== registryKey || event.storageArea !== localStorage) return
      const latest = readDirectory()
      // Other tabs may add vaults, but must not switch this tab's active session.
      setDirectory(current => ({ ...current, vaults: [...new Map([...current.vaults, ...latest.vaults].map(v => [v.id, v])).values()] }))
    }
    window.addEventListener('storage', syncDirectory)
    return () => window.removeEventListener('storage', syncDirectory)
  }, [registryKey, base])
  async function selectDirectory(next: VaultDirectory) {
    try {
      if (!navigator.locks) {
        setDirectoryError(localize("このブラウザはタブ間で保管庫の変更を安全に調整できません。Web Locks に対応したブラウザを使ってください。"))
        return
      }
      const saved = await navigator.locks.request(registryKey, () => {
        const latest = readDirectory()
        const merged = { active: next.active, vaults: [...new Map([...latest.vaults, ...next.vaults].map(v => [v.id, v])).values()] }
        localStorage.setItem(registryKey, JSON.stringify(merged))
        return merged
      })
      setDirectory(current => ({ ...saved, vaults: [...new Map([...current.vaults, ...saved.vaults].map(v => [v.id, v])).values()] }))
      setDirectoryError('')
    } catch {
      setDirectoryError(localize("保管庫の選択を保存できませんでした。ブラウザのストレージを確認して、もう一度お試しください。"))
    }
  }
  return <I18nProvider fallbackLocale={browserLocale()}>
    <PwaVaultRoot {...props} key={directory.active} databaseName={directory.active}
      vaults={directory.vaults} directoryError={directoryError}
      onSelectVault={active => selectDirectory({ ...directory, active })}
      onCreateNewVault={() => {
        const id = crypto.randomUUID()
        const entry = { id: `${base}-vault-${id}`, name: `Vault ${directory.vaults.length + 1} · ${id.slice(0, 8)}` }
        selectDirectory({ active: entry.id, vaults: [...directory.vaults, entry] })
      }} />
  </I18nProvider>
}

function PwaVaultRoot({
  databaseName = 'kakeflow-pwa-v1',
  ocrDocument = defaultOcrDocument,
  passkeyAuthenticator,
  vaults, directoryError, onSelectVault, onCreateNewVault,
}: PwaRootProps & {
  vaults: VaultEntry[]; directoryError: string;
  onSelectVault: (id: string) => void; onCreateNewVault: () => void;
}) {
  const session = usePwaClient(databaseName)
  // Subscribes to the language, so the setup form and the Simple shell follow a change at once.
  const { text, locale } = useI18n()
  // The classic receipt, ledger, evidence and backup screens are English only; their few localized controls keep the page language.
  const pageLang = htmlLang(locale)
  // Per device and household (every PWA vault's household id is `household`); absent means the classic screens.
  const [uiMode, setUiMode] = useState<UiMode>('full')
  // In Simple mode, a classic page opened from More is shown with the classic navigation and a way back.
  const [classicVisit, setClassicVisit] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  // Whether a locked vault has a stored passkey and this browser can run the ceremony; the button shows only then.
  const [passkeyReady, setPasskeyReady] = useState(false)
  const [passkeyFailed, setPasskeyFailed] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [screen, setScreen] = useState<Screen>('overview')
  const [household, setHousehold] = useState<Household | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [connectorSummaries, setConnectorSummaries] = useState<readonly ConnectorSummaryDto[]>([])
  const [draft, setDraft] = useState<ReceiptDraft | null>(null)
  const [approved, setApproved] = useState(false)
  const [posted, setPosted] = useState<Transaction | null>(null)
  const [detail, setDetail] = useState<TransactionDetail | null>(null)
  const [evidence, setEvidence] = useState<SourceEvidence | null>(null)
  const [debitAccountId, setDebitAccountId] = useState('')
  const [creditAccountId, setCreditAccountId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const vaultLoadGeneration = useRef(0)
  const serviceWorker = usePwaServiceWorker()

  const loadVault = useCallback(async (client: PwaLedgerClient): Promise<boolean> => {
    const generation = ++vaultLoadGeneration.current
    try {
      const households = await client.listHouseholds()
      if (generation !== vaultLoadGeneration.current) return false
      const active = households[0] ?? null
      if (!active) {
        setHousehold(null)
        setAccounts([])
        setSummary(null)
        setTransactions([])
        setConnectorSummaries([])
        return true
      }
      const [nextAccounts, nextSummary, nextTransactions, nextConnectorSummaries] = await Promise.all([
        client.listAccounts(active.id),
        client.dashboard(active.id),
        client.listTransactions(active.id),
        client.listConnectorSummaries(active.id),
      ])
      if (generation !== vaultLoadGeneration.current) return false
      setUiMode(readUiMode(uiModeKey(databaseName, active.id)))
      setHousehold(active)
      setAccounts(nextAccounts)
      setSummary(nextSummary)
      setTransactions(nextTransactions)
      setConnectorSummaries(nextConnectorSummaries)
      setDebitAccountId(nextAccounts.find((account) => account.kind === 'EXPENSE')?.id ?? '')
      setCreditAccountId(nextAccounts.find((account) => account.kind === 'ASSET')?.id ?? '')
      return true
    } catch (cause) {
      if (generation !== vaultLoadGeneration.current) return false
      throw cause
    }
  }, [databaseName])

  const locked = session.mode === 'locked'
  useEffect(() => {
    if (!locked) {
      setPasskeyReady(false)
      return
    }
    let current = true
    Promise.all([PwaLedgerClient.readPasskeyCount(databaseName), passkeyAvailable()])
      .then(([count, available]) => { if (current) setPasskeyReady(count > 0 && available) })
      .catch(() => { if (current) setPasskeyReady(false) })
    return () => { current = false }
  }, [locked, databaseName])

  const submitVault = async (create: boolean) => {
    setError(null)
    setPasskeyFailed(false)
    if (passphrase.length < 12) {
      setError(localize("パスフレーズは12文字以上にしてください"))
      return
    }
    if (create && passphrase !== confirmation) {
      setError(localize("確認用のパスフレーズが違います"))
      return
    }
    try {
      const client = create
        ? await session.createVault(passphrase)
        : await session.unlockVault(passphrase)
      setPassphrase('')
      setConfirmation('')
      setScreen('overview')
      await loadVault(client)
    } catch (cause) {
      if (!isPwaClientOperationSuperseded(cause)) setError(messageOf(cause))
    }
  }

  // A cancelled prompt and every other failure show the same plain message; the passphrase form stays usable.
  const unlockWithPasskey = async () => {
    setError(null)
    setPasskeyFailed(false)
    let client: PwaLedgerClient
    try {
      client = await session.unlockVaultWithPasskey(passkeyAuthenticator ?? browserPasskeyAuthenticator())
    } catch (cause) {
      if (!isPwaClientOperationSuperseded(cause)) setPasskeyFailed(true)
      return
    }
    try {
      setPassphrase('')
      setScreen('overview')
      await loadVault(client)
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  const setupHousehold = async (form: HTMLFormElement) => {
    if (!session.client) return
    const data = new FormData(form)
    setBusy(true)
    setError(null)
    try {
      const nextHousehold = await session.client.createHousehold({
        id: 'household',
        name: String(data.get('householdName') ?? ''),
      })
      await session.client.createAccount({
        id: 'asset',
        householdId: nextHousehold.id,
        name: String(data.get('assetName') ?? ''),
        kind: 'ASSET',
      })
      await session.client.createAccount({
        id: 'expense',
        householdId: nextHousehold.id,
        name: String(data.get('expenseName') ?? ''),
        kind: 'EXPENSE',
      })
      // Vaults set up from here on start in Simple mode with the starter accounts, named in the current language.
      writeUiMode(uiModeKey(databaseName, nextHousehold.id), 'simple')
      try {
        await addDefaultChart(session.client, nextHousehold.id, text)
      } catch {
        setError(localize("既定の口座を追加できませんでした"))
      }
      await loadVault(session.client)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const importReceipt = async (file: File) => {
    if (!session.client || !household) return
    setBusy(true)
    setError(null)
    setApproved(false)
    setPosted(null)
    try {
      const bytes = await readFileBytes(file)
      const extracted = await ocrDocument(bytes, file.type)
      const fields = parseReceiptText(extracted.text)
      const isComplete = Boolean(fields.merchant && fields.occurredOn && fields.amountJpy)
      const candidate = isComplete
        ? await session.client.stageReceipt({
            householdId: household.id,
            originalFilename: file.name,
            mediaType: file.type,
            bytes,
            occurredOn: fields.occurredOn!,
            payee: fields.merchant!,
            amountJpy: fields.amountJpy!,
            ocrConfidenceBps: Math.min(extracted.confidenceBps, fields.confidenceBps),
            provenance: receiptProvenance(extracted, fields),
          })
        : null
      setDraft({ filename: file.name, mediaType: file.type, bytes, extracted, fields, candidate })
      if (candidate) {
        try {
          setConnectorSummaries(await session.client.listConnectorSummaries(household.id))
        } catch {
          setError('Receipt staged, but source status could not be refreshed.')
        }
      }
      setScreen('review')
    } catch (cause) {
      setError(`Local OCR failed: ${messageOf(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  const approveCandidate = async () => {
    if (!session.client || !draft?.candidate || !approved) return
    setBusy(true)
    setError(null)
    try {
      const transaction = await session.client.approveCandidate({
        candidateId: draft.candidate.id,
        transactionId: randomId('transaction'),
        transactionType: 'EXPENSE',
        entries: [
          { id: randomId('debit'), accountId: debitAccountId, side: 'DEBIT', amountJpy: draft.candidate.amountJpy },
          { id: randomId('credit'), accountId: creditAccountId, side: 'CREDIT', amountJpy: draft.candidate.amountJpy },
        ],
      })
      try {
        if (!await loadVault(session.client)) return
      } catch {
        setError('Transaction posted, but the refreshed vault status could not be loaded.')
      }
      setPosted(transaction)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const showProvenance = async (transactionId: string) => {
    if (!session.client) return
    setBusy(true)
    setError(null)
    try {
      const [nextDetail, nextEvidence] = await Promise.all([
        session.client.transactionDetail(transactionId),
        session.client.sourceEvidence(transactionId),
      ])
      setDetail(nextDetail)
      setEvidence(nextEvidence)
      setScreen('evidence')
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const restoreArchive = async (archive: Uint8Array, archivePassphrase: string) => {
    setBusy(true)
    setError(null)
    try {
      const client = await session.restoreVault(archive, archivePassphrase)
      setDraft(null)
      setPosted(null)
      setDetail(null)
      setEvidence(null)
      setApproved(false)
      setScreen('overview')
      await loadVault(client)
    } catch (cause) {
      if (isPwaClientOperationSuperseded(cause)) return
      setError(messageOf(cause))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  const lockVault = () => {
    vaultLoadGeneration.current += 1
    session.lockVault()
    setClassicVisit(false)
    setBusy(false)
    setError(null)
    setPasskeyFailed(false)
    setPassphrase('')
    setDraft(null)
    setPosted(null)
    setDetail(null)
    setEvidence(null)
    setHousehold(null)
    setAccounts([])
    setTransactions([])
    setSummary(null)
    setConnectorSummaries([])
  }

  // The Simple shell may have written to the vault, so the classic screens reload their copy before they show.
  const refreshClassic = async () => {
    if (!session.client) return
    try {
      await loadVault(session.client)
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  const switchUiMode = async (mode: UiMode) => {
    if (!household) return
    writeUiMode(uiModeKey(databaseName, household.id), mode)
    setError(null)
    setClassicVisit(false)
    setScreen('overview')
    if (mode === 'full') await refreshClassic()
    setUiMode(mode)
  }

  const openClassicPage = async (page: PwaPage) => {
    setError(null)
    await refreshClassic()
    setScreen(page)
    setClassicVisit(true)
  }

  const status = session.mode === 'unlocked' ? localize("解錠中") : localize("施錠中")
  const showSimple = session.mode === 'unlocked' && household !== null && uiMode === 'simple' && !classicVisit
  // The passkey failure message replaces the raw session error, so no detail of the failed step reaches the screen.
  const effectiveError = passkeyFailed
    ? localize("パスキーを使えませんでした。パスフレーズで開いてください。")
    : error ?? session.error
  const canActivateUpdate = canActivatePwaUpdate({
    vaultUnlocked: session.mode === 'unlocked',
    activeOperation: busy || Boolean(draft?.candidate && !posted),
  })

  // The vault chrome (status pills, Lock vault, the create/unlock card, the household setup) follows the language. The receipt-flow, ledger, evidence and
  // backup/restore screens stay English in this phase (see the PWA Simple spec).
  return <div className={`pwa-shell${showSimple ? ' pwa-shell--simple' : ''}`}>
    <header className="pwa-header">
      <a className="pwa-brand" href="/kakeflow/" aria-label="KakeFlow home">
        <span className="pwa-mark" aria-hidden="true">K</span>
        <span>KakeFlow <small>Local Ledger</small></span>
      </a>
      <div className="pwa-state" aria-label={localize("保管庫の状態")}>
        <span>{localize("ローカル保存中")}</span><span>{status}</span><span>{localize("オフラインで利用可")}</span>
      </div>
      {session.mode === 'unlocked' && <button className="pwa-quiet" type="button" onClick={lockVault}>{localize("保管庫に鍵をかける")}</button>}
    </header>
    {serviceWorker.updateAvailable && <aside className="pwa-update" role="status" lang="en">
      <span><strong>Update ready</strong> The new app shell will activate only at a safe boundary.</span>
      <button className="pwa-primary" type="button" disabled={!canActivateUpdate || serviceWorker.activating} onClick={serviceWorker.activateUpdate}>{serviceWorker.activating ? 'Activating…' : 'Apply update'}</button>
      <button className="pwa-quiet" type="button" onClick={serviceWorker.dismissUpdate}>Later</button>
      {!canActivateUpdate && <small>Finish or leave the active receipt review, or lock the vault.</small>}
    </aside>}

    {session.mode !== 'unlocked' && <main className="pwa-auth">
      <section className="pwa-auth-card">
        <p className="pwa-eyebrow">{localize("アカウント不要・端末内保存")}</p>
        <h1>{session.mode === 'new' ? localize("家計の記録を自分の手元に") : localize("この端末の保管庫を開く")}</h1>
        <p>{localize("暗号鍵はパスフレーズからこのブラウザ内で作られます。パスフレーズは保存も送信もされません。")}</p>
        {vaults.length > 1 && <label>{localize("使用する保管庫")}<select aria-label={localize("使用する保管庫")} value={databaseName} disabled={session.busy} onChange={event => onSelectVault(event.target.value)}>
          {vaults.map(vault => <option key={vault.id} value={vault.id}>{vault.name}</option>)}
        </select></label>}
        {vaults.length > 1 && <p>{localize("保管庫ごとにパスフレーズが異なります。ほかの保管庫とそのデータはこの端末に残ります。")}</p>}
        {directoryError && <p className="pwa-error" role="alert">{directoryError}</p>}
        {session.mode === 'locked' && passkeyReady && <button className="pwa-primary pwa-passkey-unlock" type="button" disabled={session.busy} onClick={() => void unlockWithPasskey()}>{localize("パスキーで開く")}</button>}
        <label>{localize("保管庫用パスフレーズ")}<input type="password" autoComplete="current-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label>
        {session.mode === 'new' && <label>{localize("パスフレーズを確認")}<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>}
        {effectiveError && <p className="pwa-error" role="alert">{effectiveError}</p>}
        <button className="pwa-primary" type="button" disabled={session.busy} onClick={() => void submitVault(session.mode === 'new')}>
          {session.mode === 'new' ? localize("暗号化した保管庫を作成") : localize("ロックを解除する")}
        </button>
        {session.mode === 'locked' && <>
          <button className="pwa-quiet pwa-new-vault" type="button" disabled={session.busy} onClick={onCreateNewVault}>{localize("新しい保管庫を作る")}</button>
          <p>{localize("新しいパスフレーズで別の保管庫を作ります。今の保管庫のロック解除や削除は行いません。")}</p>
        </>}
      </section>
    </main>}

    {session.mode === 'unlocked' && !household && <main className="pwa-auth">
      <form className="pwa-auth-card" onSubmit={(event) => { event.preventDefault(); void setupHousehold(event.currentTarget) }}>
        <p className="pwa-eyebrow">{localize("初回のローカル設定")}</p>
        <h1>{localize("世帯を設定する")}</h1>
        <p>{localize("この端末だけに保存されます。入力した口座に加えて、現金・クレジットカード・給与と、よく使う支出カテゴリーも用意するので、すぐに予算を立てられます。")}</p>
        <div className="pwa-setup-language"><LanguageSwitch /></div>
        <label>{localize("世帯の名前")}<input name="householdName" required /></label>
        <label>{localize("お金の口座")}<input name="assetName" required /></label>
        <label>{localize("支出の口座")}<input name="expenseName" required /></label>
        {effectiveError && <p className="pwa-error" role="alert">{effectiveError}</p>}
        <button className="pwa-primary" type="submit" disabled={busy}>{localize("ローカル設定を保存")}</button>
      </form>
    </main>}

    {showSimple && session.client && household && <>
      {effectiveError && <p className="pwa-error pwa-simple-error" role="alert">{effectiveError}</p>}
      <SimpleShell client={session.client} household={household} usageKey={uiModeKey(databaseName, household.id)} onOpenPage={(page) => { void openClassicPage(page) }} onSwitchToClassic={() => { void switchUiMode('full') }}
        onActivity={() => setError(null)} />
    </>}

    {session.mode === 'unlocked' && household && !showSimple && <div className="pwa-workspace" lang="en">
      <nav className="pwa-navigation" aria-label="PWA workflow">
        {navigation.map((item) => <button key={item.id} type="button" aria-current={screen === item.id ? 'page' : undefined} onClick={() => setScreen(item.id)}>
          <span aria-hidden="true">{item.step}</span>{item.label}
        </button>)}
      </nav>
      <main className="pwa-content">
        {classicVisit && <button className="pwa-quiet pwa-back-to-simple" type="button" lang={pageLang} onClick={() => setClassicVisit(false)}><span aria-hidden="true">← </span>{localize("かんたん表示に戻る")}</button>}
        {effectiveError && <p className="pwa-error" role="alert">{effectiveError}</p>}
        {screen === 'overview' && <Overview household={household} summary={summary} transactions={transactions} onImport={() => setScreen('import')}
          uiMode={uiMode} onUiModeChange={(mode) => { void switchUiMode(mode) }} pageLang={pageLang} />}
        {screen === 'sources' && connectorSummaries[0] && <div className="pwa-sources"><ManualConnectorControlCenter
          summary={connectorSummaries[0]}
          copy={pwaConnectorCopy}
          onConfigure={() => setScreen('import')}
        /></div>}
        {screen === 'import' && <ImportScreen busy={busy} onFile={importReceipt} />}
        {screen === 'review' && <ReviewScreen
          draft={draft}
          accounts={accounts}
          debitAccountId={debitAccountId}
          creditAccountId={creditAccountId}
          explicitlyApproved={approved}
          posted={posted}
          busy={busy}
          onDebit={setDebitAccountId}
          onCredit={setCreditAccountId}
          onApproval={setApproved}
          onPost={approveCandidate}
        />}
        {screen === 'ledger' && <LedgerScreen transactions={transactions} onProvenance={showProvenance} />}
        {screen === 'evidence' && <EvidenceScreen detail={detail} evidence={evidence} />}
        {screen === 'backup' && session.client && <BackupScreen
          client={session.client}
          busy={busy || session.busy}
          onRestore={restoreArchive}
        />}
      </main>
    </div>}
  </div>
}

function Overview({ household, summary, transactions, onImport, uiMode, onUiModeChange, pageLang }: {
  readonly household: Household
  readonly summary: DashboardSummary | null
  readonly transactions: readonly Transaction[]
  readonly onImport: () => void
  readonly uiMode: UiMode
  readonly onUiModeChange: (mode: UiMode) => void
  /** The page language, for the localized mode switch inside this English screen. */
  readonly pageLang: string
}) {
  return <section>
    <div className="pwa-page-head"><div><p className="pwa-eyebrow">{household.name} · JPY</p><h1>Household overview</h1></div><button className="pwa-primary" type="button" onClick={onImport}>Import receipt</button></div>
    <div className="pwa-metrics">
      <article><span>Posted expenses</span><strong>{formatJpy(summary?.expenseJpy ?? 0)}</strong></article>
      <article><span>Net</span><strong>{formatJpy(summary?.netJpy ?? 0)}</strong></article>
      <article><span>Ledger entries</span><strong>{summary?.transactionCount ?? 0}</strong></article>
    </div>
    <section className="pwa-panel"><h2>Recent postings</h2>{transactions.length === 0 ? <p>No postings yet. Import a receipt to start.</p> : transactions.slice(-4).reverse().map((transaction) => <div className="pwa-row" key={transaction.id}><span>{transaction.occurredOn} · {transaction.payee}</span><strong>{formatJpy(transaction.amountJpy)}</strong></div>)}</section>
    <section className="pwa-panel pwa-mode-panel" lang={pageLang}><UiModeSwitch mode={uiMode} onChange={onUiModeChange} /></section>
  </section>
}

function ImportScreen({ busy, onFile }: {
  readonly busy: boolean
  readonly onFile: (file: File) => Promise<void>
}) {
  return <section>
    <div className="pwa-page-head"><div><p className="pwa-eyebrow">STEP 03 · LOCAL OCR</p><h1>Import a receipt</h1></div></div>
    <label className="pwa-dropzone">
      <strong>{busy ? 'Reading locally…' : 'Choose a receipt image'}</strong>
      <span>PP-OCRv5 runs on this device. The original is encrypted before persistence.</span>
      <input aria-label="Receipt image" type="file" accept="image/*" disabled={busy} onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) void onFile(file)
        event.target.value = ''
      }} />
    </label>
  </section>
}

function ReviewScreen({
  draft,
  accounts,
  debitAccountId,
  creditAccountId,
  explicitlyApproved,
  posted,
  busy,
  onDebit,
  onCredit,
  onApproval,
  onPost,
}: {
  readonly draft: ReceiptDraft | null
  readonly accounts: readonly Account[]
  readonly debitAccountId: string
  readonly creditAccountId: string
  readonly explicitlyApproved: boolean
  readonly posted: Transaction | null
  readonly busy: boolean
  readonly onDebit: (value: string) => void
  readonly onCredit: (value: string) => void
  readonly onApproval: (value: boolean) => void
  readonly onPost: () => Promise<void>
}) {
  if (!draft) return <section><div className="pwa-page-head"><div><p className="pwa-eyebrow">STEP 04</p><h1>Review candidate</h1></div></div><p>Import a receipt before approval.</p></section>
  const candidate = draft.candidate
  if (!candidate) return <section>
    <div className="pwa-page-head"><div><p className="pwa-eyebrow">CANDIDATE · INCOMPLETE</p><h1>Candidate needs more information</h1></div></div>
    <div className="pwa-compare"><article className="pwa-panel"><h2>Local OCR result</h2>{draft.extracted.text.split(/\r?\n/u).map((line, index) => <span className="pwa-ocr-line" key={`${index}-${line}`}>{line}</span>)}</article><article className="pwa-panel"><h2>Missing required fields</h2><ul>{draft.fields.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul><p>This candidate remains in the current review and cannot be posted.</p></article></div>
  </section>
  const canPost = Boolean(debitAccountId && creditAccountId && debitAccountId !== creditAccountId && explicitlyApproved && !posted)
  return <section>
    <div className="pwa-page-head"><div><p className="pwa-eyebrow">CANDIDATE · SOURCE ENCRYPTED</p><h1>Compare source and candidate</h1></div><span className="pwa-chip">CANDIDATE</span></div>
    <div className="pwa-compare">
      <article className="pwa-panel"><h2>Source · {draft.filename}</h2><ReceiptPreview draft={draft} /><details className="pwa-ocr-details"><summary>Show local OCR text</summary>{draft.extracted.text.split(/\r?\n/u).map((line, index) => <span className="pwa-ocr-line" key={`${index}-${line}`}>{line}</span>)}</details></article>
      <article className="pwa-panel"><h2>OCR candidate</h2><dl className="pwa-facts"><div><dt>Date</dt><dd>{candidate.occurredOn}</dd></div><div><dt>Payee</dt><dd>{candidate.payee}</dd></div><div><dt>Total</dt><dd>{formatJpy(candidate.amountJpy)}</dd></div><div><dt>Confidence</dt><dd>{(candidate.ocrConfidenceBps / 100).toFixed(1)}%</dd></div></dl></article>
    </div>
    <article className="pwa-panel pwa-posting"><div className="pwa-panel-head"><div><p className="pwa-eyebrow">BALANCED POSTING</p><h2>Approval decision</h2></div><strong>difference ¥0</strong></div>
      <div className="pwa-account-grid"><label>Debit account<select value={debitAccountId} onChange={(event) => onDebit(event.target.value)}><option value="">Select</option>{accounts.filter((account) => account.kind === 'EXPENSE').map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Credit account<select value={creditAccountId} onChange={(event) => onCredit(event.target.value)}><option value="">Select</option>{accounts.filter((account) => account.kind === 'ASSET' || account.kind === 'LIABILITY').map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></div>
      <div className="pwa-balance"><span>Debit {formatJpy(candidate.amountJpy)}</span><span>Credit {formatJpy(candidate.amountJpy)}</span></div>
      {!posted && <><label className="pwa-approval"><input type="checkbox" checked={explicitlyApproved} onChange={(event) => onApproval(event.target.checked)} />I compared the receipt and approve this posting</label><button className="pwa-primary" type="button" disabled={!canPost || busy} onClick={() => void onPost()}>Approve and post</button></>}
      {posted && <div className="pwa-success" role="status"><span>APPROVED</span><span>POSTED</span><p>Canonical posting hash</p><code>{posted.canonicalPostingHash}</code></div>}
    </article>
  </section>
}

function ReceiptPreview({ draft }: { readonly draft: ReceiptDraft }) {
  const [source, setSource] = useState<string | null>(null)
  useEffect(() => {
    const blob = new Blob([Uint8Array.from(draft.bytes).buffer], { type: draft.mediaType })
    if (typeof URL.createObjectURL === 'function') {
      const objectUrl = URL.createObjectURL(blob)
      setSource(objectUrl)
      return () => URL.revokeObjectURL(objectUrl)
    }
    const reader = new FileReader()
    reader.addEventListener('load', () => setSource(String(reader.result)))
    reader.readAsDataURL(blob)
    return () => reader.abort()
  }, [draft.bytes, draft.mediaType])
  return source
    ? <img className="pwa-receipt-preview" src={source} alt={`Original receipt ${draft.filename}`} />
    : <div className="pwa-receipt-preview" aria-label="Loading original receipt" />
}

function LedgerScreen({ transactions, onProvenance }: {
  readonly transactions: readonly Transaction[]
  readonly onProvenance: (id: string) => Promise<void>
}) {
  return <section><div className="pwa-page-head"><div><p className="pwa-eyebrow">STEP 05 · APPEND-ONLY</p><h1>Posted ledger</h1></div></div><PostedLedgerList transactions={transactions} onProvenance={onProvenance} /></section>
}

function EvidenceScreen({ detail, evidence }: {
  readonly detail: TransactionDetail | null
  readonly evidence: SourceEvidence | null
}) {
  if (!detail || !evidence) return <section><div className="pwa-page-head"><div><p className="pwa-eyebrow">STEP 06</p><h1>Evidence</h1></div></div><p>Open a ledger posting to inspect its source chain.</p></section>
  return <section><div className="pwa-page-head"><div><p className="pwa-eyebrow">SOURCE → CANDIDATE → POSTING</p><h1>Transaction provenance</h1></div><span className="pwa-chip">VERIFIED LOCAL</span></div><div className="pwa-provenance"><article className="pwa-panel"><span>01 · encrypted source</span><h2>{evidence.source.originalFilename}</h2><p>{evidence.source.mediaType} · {evidence.source.byteSize} bytes</p><code>SHA-256 {evidence.source.sha256}</code></article><article className="pwa-panel"><span>02 · approved candidate</span><h2>{detail.payee}</h2><p>{detail.occurredOn} · {formatJpy(detail.amountJpy)}</p><code>{detail.candidateId}</code></article><article className="pwa-panel"><span>03 · balanced posting</span><h2>{detail.entries.length} ledger entries</h2>{detail.entries.map((entry) => <p key={entry.id}>{entry.side} · {formatJpy(entry.amountJpy)}</p>)}<code>{detail.canonicalPostingHash}</code></article></div></section>
}

export function BackupScreen({ client, busy, onRestore }: {
  readonly client: PwaLedgerClient
  readonly busy: boolean
  readonly onRestore: (archive: Uint8Array, passphrase: string) => Promise<void>
}) {
  const [status, setStatus] = useState<string | null>(null)
  const [archiveFile, setArchiveFile] = useState<File | null>(null)
  const [archivePassphrase, setArchivePassphrase] = useState('')
  const [working, setWorking] = useState(false)

  const downloadArchive = async () => {
    setWorking(true)
    setStatus('Preparing encrypted archive…')
    try {
      const archive = await client.exportVault()
      const blob = new Blob([Uint8Array.from(archive).buffer], {
        type: 'application/vnd.kakeflow.encrypted+zip',
      })
      const url = URL.createObjectURL(blob)
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'kakeflow-encrypted-vault.kakeflow.zip'
        link.click()
      } finally {
        URL.revokeObjectURL(url)
      }
      setStatus('Encrypted archive downloaded')
    } catch (cause) {
      setStatus(`Export failed: ${messageOf(cause)}`)
    } finally {
      setWorking(false)
    }
  }

  const restore = async () => {
    if (!archiveFile || !archivePassphrase) return
    setWorking(true)
    setStatus('Validating the complete archive before activation…')
    try {
      await onRestore(await readFileBytes(archiveFile), archivePassphrase)
    } catch {
      setStatus('Restore rejected; the active vault was not changed')
    } finally {
      setWorking(false)
    }
  }

  return <section>
    <div className="pwa-page-head"><div><p className="pwa-eyebrow">STEP 07 · ENCRYPTED</p><h1>Backup and recovery</h1></div></div>
    <div className="pwa-compare">
      <article className="pwa-panel">
        <h2>Export encrypted archive</h2>
        <p>Download authenticated encrypted records and source evidence. The archive passphrase is your current vault passphrase.</p>
        <button className="pwa-primary" type="button" disabled={busy || working} onClick={() => void downloadArchive()}>Download encrypted archive</button>
      </article>
      <article className="pwa-panel">
        <h2>Validate and restore</h2>
        <p>Restore writes a new vault and switches the active pointer only after every manifest hash and encrypted envelope passes.</p>
        <label>Encrypted archive file<input aria-label="Encrypted archive file" type="file" accept=".zip,.kakeflow.zip,application/zip,application/vnd.kakeflow.encrypted+zip" disabled={busy || working} onChange={(event) => setArchiveFile(event.target.files?.[0] ?? null)} /></label>
        <label>Archive passphrase<input aria-label="Archive passphrase" type="password" autoComplete="current-password" value={archivePassphrase} disabled={busy || working} onChange={(event) => setArchivePassphrase(event.target.value)} /></label>
        <button className="pwa-primary" type="button" disabled={busy || working || !archiveFile || !archivePassphrase} onClick={() => void restore()}>Validate and restore</button>
      </article>
    </div>
    {status && <p role="status">{status}</p>}
  </section>
}
